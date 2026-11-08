import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEMO_GOAL_ID, DEMO_HOUSEHOLD_ID, progressFor } from '../../server/household.mjs';
import { createFakePayPal } from '../helpers/fake-paypal.mjs';
import { WAIT, startApp, within } from '../helpers/payment-app-process.mjs';
import { setupDomain } from '../helpers/setup.mjs';

// Abrupt process death at the payment windows. The app runs in a child process (test/helpers/payment-app-child.mjs) on a
// disposable database. The stateful fake PayPal runs here, in the parent, so what "PayPal" recorded survives the app.
// Children are killed with SIGKILL, so no shutdown code runs. This is not power-loss, real PayPal or device evidence.
// Starting and ending children is shared with the two-server test (test/helpers/payment-app-process.mjs).
const SANDBOX = 'https://api-m.sandbox.paypal.com';
const owner = { householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID };

// The fake PayPal on loopback. `hold` lets the fake process the next matching request, then withholds its answer.
async function servePayPal() {
  const fake = createFakePayPal();
  let gate = null;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const reply = await fake.fetch(SANDBOX + req.url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined });
    const text = await reply.text();
    const pathname = new URL(req.url, SANDBOX).pathname;
    if (gate && req.method === gate.method && pathname === gate.pathname) { const reached = gate.reached; gate = null; reached(); return; }
    res.writeHead(reply.status, { 'Content-Type': 'application/json', 'paypal-debug-id': 'debug-fake' });
    res.end(text);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    fake,
    base: `http://127.0.0.1:${server.address().port}`,
    hold: (method, pathname) => within(new Promise((reached) => { gate = { method, pathname, reached }; }), WAIT, `${method} ${pathname}`),
    captureRequests: (orderId) => fake.requests.filter((r) => r.method === 'POST' && r.pathname === `/v2/checkout/orders/${orderId}/capture`),
    providerCaptures: (orderId) => fake.orders.get(orderId).purchase_units[0].payments?.captures ?? [],
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}

// What the disposable database holds for one order, read without changing it.
function records(file, orderId) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const order = db.prepare('SELECT id, status FROM payment_orders WHERE provider_order_id = ?').get(orderId);
    return {
      status: order.status,
      captures: db.prepare('SELECT status, credited, refunded_cents FROM payment_captures WHERE order_id = ?').all(order.id).map((r) => ({ ...r })),
      entries: db.prepare("SELECT kind, amount_cents FROM ledger_entries WHERE kind IN ('contribution', 'refund') ORDER BY rowid").all().map((r) => ({ ...r })),
      checks: db.prepare('SELECT verdict, outcome FROM order_checks WHERE order_id = ? ORDER BY id').all(order.id).map((r) => ({ ...r })),
      progressCents: progressFor(db, DEMO_GOAL_ID).progressCents,
    };
  } finally { db.close(); }
}

async function scenario(body) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'our-castle-restart-')));
  const file = path.join(dir, 'our-castle-sandbox.sqlite');
  setupDomain({ file, mode: 'sandbox' }).db.close(); // the example household and goal, $60.00 starting progress
  const paypal = await servePayPal();
  const apps = [];
  try {
    await body({ file, paypal, start: async (withheld) => { const app = await startApp(file, paypal.base, withheld); apps.push(app); return app; } });
  } finally {
    for (const app of apps) await app.kill();
    await paypal.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
const createOrder = async (app, requestId) => {
  const created = await app.call('/api/paypal/orders', { ...owner, amountCents: 1500, approverId: 'm_rowan', approvalConfirmed: true, requestId });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  return created.json.orderId;
};
const captureEvent = (paypal, orderId, id) => ({ id, event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource: { ...structuredClone(paypal.providerCaptures(orderId)[0]), supplementary_data: { related_ids: { order_id: orderId } } } });

// The fake's own record of what it was asked, for the evidence line each scenario prints.
function counters(paypal, orderId) {
  const count = (method, pathname) => paypal.fake.requests.filter((r) => r.method === method && r.pathname === pathname).length;
  return { tokens: count('POST', '/v1/oauth2/token'), orderCreates: count('POST', '/v2/checkout/orders'), captureRequests: count('POST', `/v2/checkout/orders/${orderId}/capture`),
    orderReads: count('GET', `/v2/checkout/orders/${orderId}`), webhookVerifications: count('POST', '/v1/notifications/verify-webhook-signature'), providerCaptures: paypal.providerCaptures(orderId).length };
}
const evidence = (t, paypal, orderId, after) => t.diagnostic(`fake PayPal ${JSON.stringify(counters(paypal, orderId))} · recovered ${JSON.stringify(after)}`);

test('the app dies while PayPal answers a capture: nothing is credited, and the same order recovers once on request', { timeout: 120_000 }, (t) => scenario(async ({ file, paypal, start }) => {
  let app = await start();
  const orderId = await createOrder(app, 'restart-held-capture-0001');
  // PayPal completes the capture, but its answer is held until the app process is gone.
  const reached = paypal.hold('POST', `/v2/checkout/orders/${orderId}/capture`);
  const attempt = app.call(`/api/paypal/orders/${orderId}/capture`, owner).then(() => 'answered', () => 'no answer');
  await reached;
  await app.kill();
  assert.equal(await attempt, 'no answer');
  assert.equal(paypal.providerCaptures(orderId).length, 1, 'PayPal recorded one completed capture');
  assert.deepEqual(records(file, orderId), { status: 'created', captures: [], entries: [], checks: [], progressCents: 6000 }, 'no credit was invented');

  // A new process on the same database does nothing by itself: no capture, check or provider call at startup.
  const requestsBefore = paypal.fake.requests.length;
  app = await start();
  assert.equal(paypal.fake.requests.length, requestsBefore);
  assert.equal(records(file, orderId).progressCents, 6000);

  // The existing explicit retry for this same order sends the same PayPal-Request-Id, so PayPal replays its first answer.
  const retried = await app.call(`/api/paypal/orders/${orderId}/capture`, owner);
  assert.equal(retried.json.outcome, 'completed', JSON.stringify(retried.json));
  const sent = paypal.captureRequests(orderId);
  assert.equal(sent.length, 2);
  assert.equal(new Set(sent.map((r) => r.headers['paypal-request-id'])).size, 1, 'one PayPal-Request-Id for the order');
  assert.equal(paypal.providerCaptures(orderId).length, 1, 'still one provider capture');

  // The explicit check saves its result with the receipt.
  const checked = await app.call(`/api/paypal/orders/${orderId}/refresh`, owner);
  assert.equal(checked.status, 200, JSON.stringify(checked.json));
  const after = records(file, orderId);
  assert.equal(after.status, 'completed');
  assert.deepEqual(after.captures, [{ status: 'COMPLETED', credited: 1, refunded_cents: 0 }]);
  assert.deepEqual(after.entries, [{ kind: 'contribution', amount_cents: 1500 }]);
  assert.equal(after.checks.length, 1);
  assert.equal(after.checks[0].verdict, 'match');
  assert.equal(after.progressCents, 7500);
  evidence(t, paypal, orderId, after);
}));

test('the app dies after crediting but before answering: a retry and late deliveries add nothing', { timeout: 120_000 }, (t) => scenario(async ({ file, paypal, start }) => {
  let app = await start('/capture');
  const orderId = await createOrder(app, 'restart-unanswered-0001');
  const attempt = app.call(`/api/paypal/orders/${orderId}/capture`, owner).then(() => 'answered', () => 'no answer');
  const withheld = await app.message('withheld');
  assert.equal(withheld.status, 200);
  const credited = records(file, orderId);
  assert.deepEqual(credited.entries, [{ kind: 'contribution', amount_cents: 1500 }], 'the credit was committed before the answer');
  assert.equal(credited.progressCents, 7500);
  await app.kill();
  assert.equal(await attempt, 'no answer');

  app = await start();
  const requestsBefore = paypal.fake.requests.length;
  const retried = await app.call(`/api/paypal/orders/${orderId}/capture`, owner);
  assert.equal(retried.json.outcome, 'already_completed', JSON.stringify(retried.json));
  assert.equal(paypal.fake.requests.length, requestsBefore, 'the settled order is answered without calling PayPal');

  const event = captureEvent(paypal, orderId, 'WH-RESTART-CAPTURE-1');
  assert.equal((await app.deliver(event)).json.outcome, 'already_completed');
  assert.equal((await app.deliver(event)).json.outcome, 'duplicate_event');
  assert.equal((await app.deliver({ ...event, id: 'WH-RESTART-CAPTURE-2' })).json.outcome, 'already_completed');

  assert.equal(paypal.captureRequests(orderId).length, 1, 'no second external capture');
  assert.equal(paypal.providerCaptures(orderId).length, 1);
  const after = records(file, orderId);
  assert.equal(after.status, 'completed');
  assert.deepEqual(after.captures, [{ status: 'COMPLETED', credited: 1, refunded_cents: 0 }]);
  assert.deepEqual(after.entries, [{ kind: 'contribution', amount_cents: 1500 }]);
  assert.equal(after.progressCents, 7500);
  evidence(t, paypal, orderId, after);
}));

test('a refund made while the app is down is recorded once by the explicit check after restart; late deliveries do not debit again', { timeout: 120_000 }, (t) => scenario(async ({ file, paypal, start }) => {
  let app = await start();
  const orderId = await createOrder(app, 'restart-missed-refund-0001');
  assert.equal((await app.call(`/api/paypal/orders/${orderId}/capture`, owner)).json.outcome, 'completed');
  await app.kill();

  // While no app runs, the merchant refunds in the PayPal dashboard. No webhook reaches the app.
  const capture = paypal.providerCaptures(orderId)[0];
  const unit = paypal.fake.orders.get(orderId).purchase_units[0];
  capture.status = 'REFUNDED';
  unit.payments.refunds = [{ id: 'REFUNDRESTART01TEST', status: 'COMPLETED', amount: { currency_code: 'USD', value: '15.00' },
    links: [{ rel: 'up', href: `${SANDBOX}/v2/payments/captures/${capture.id}` }] }];

  const requestsBefore = paypal.fake.requests.length;
  app = await start();
  assert.equal(paypal.fake.requests.length, requestsBefore, 'nothing is reconciled at startup');
  assert.equal(records(file, orderId).progressCents, 7500);

  const refreshed = await app.call(`/api/paypal/orders/${orderId}/refresh`, owner);
  assert.equal(refreshed.json.outcome, 'refunded', JSON.stringify(refreshed.json));
  assert.equal((await app.call(`/api/paypal/orders/${orderId}/refresh`, owner)).json.outcome, 'already_completed');
  const refund = { id: 'WH-RESTART-REFUND-1', event_type: 'PAYMENT.CAPTURE.REFUNDED',
    resource: { id: 'REFUNDRESTART01TEST', status: 'COMPLETED', amount: { currency_code: 'USD', value: '15.00' }, links: unit.payments.refunds[0].links } };
  assert.equal((await app.deliver(refund)).json.outcome, 'duplicate_refund');
  assert.equal((await app.deliver(refund)).json.outcome, 'duplicate_event');

  const after = records(file, orderId);
  assert.equal(after.status, 'refunded');
  assert.deepEqual(after.entries, [{ kind: 'contribution', amount_cents: 1500 }, { kind: 'refund', amount_cents: 1500 }]);
  assert.equal(after.captures.length, 1);
  assert.equal(after.captures[0].refunded_cents, 1500);
  assert.equal(after.progressCents, 6000, 'debited exactly once');
  assert.equal(paypal.captureRequests(orderId).length, 1);
  evidence(t, paypal, orderId, after);
}));

test('a child that never becomes ready, or ends before it is ready, is ended by the helper itself', { timeout: 60_000 }, async () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'our-castle-restart-startup-')));
  try {
    const silent = path.join(dir, 'never-ready.mjs');
    writeFileSync(silent, 'setInterval(() => {}, 1000);\n'); // keeps running, never says it is ready
    const quitter = path.join(dir, 'ends-early.mjs');
    writeFileSync(quitter, 'process.exit(3);\n');
    for (const [script, reason] of [[silent, /Timed out waiting for the app process to start/], [quitter, /The app process ended \(3\) before it was ready/]]) {
      let child;
      await assert.rejects(startApp(path.join(dir, 'unused.sqlite'), 'http://127.0.0.1:9', '', { script, wait: 300, onSpawn: (c) => { child = c; } }), reason);
      assert.ok(child.exitCode !== null || child.signalCode !== null, 'its own child has ended');
      assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' }, 'and no longer exists');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
