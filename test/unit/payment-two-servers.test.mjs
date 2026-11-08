import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEMO_GOAL_ID, DEMO_HOUSEHOLD_ID } from '../../server/household.mjs';
import { createFakePayPal } from '../helpers/fake-paypal.mjs';
import { startApp, within } from '../helpers/payment-app-process.mjs';
import { setupDomain } from '../helpers/setup.mjs';

// Two app servers on one database. Two separate processes (test/helpers/payment-app-child.mjs, each running the real
// server, payment service and PayPal SDK transport) share one fresh disposable SQLite file. The stateful fake PayPal
// runs here in the parent, on loopback, and outlives them. Every start is checked to make no provider request.
//
// Controlled windows, never sleeps:
// - Provider: a request reaches the fake, which processes it at once, and its answer is held until the test releases
//   it, either as is or as a 503 (an answer lost after PayPal acted).
// - Commit: the harness's own connection holds the SQLite write lock while both servers announce their next write
//   transaction (payment-app-child.mjs trace). The lock is then released, and SQLite decides which server writes first.
// - Process death: SIGKILL of one owned child while the other keeps serving.
// A process runs its code between awaits without interruption, so windows inside one synchronous step (between two
// SQLite statements) are not exercised here.
//
// The oracle is the small integer-and-identity model below. It never calls production payment, progress or milestone
// code; rows are read directly from the database. This is not deterministic simulation, load, power-loss or real-PayPal
// evidence. TWO_SERVER_EVIDENCE_DIR=<folder> also writes each scenario's trace, observations and provider log there.
const SANDBOX = 'https://api-m.sandbox.paypal.com';
const VERIFY = '/v1/notifications/verify-webhook-signature';
const owner = { householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID };
const GATE = 5_000; // the longest any gate is waited for
const LOCK_WAIT = 2_000; // shorter than the servers' 3 s SQLite busy timeout
const LOST = JSON.stringify({ name: 'SERVICE_UNAVAILABLE', message: 'The test harness lost this answer after the fake processed the request.', debug_id: 'debug-fake' });

// ---- The oracle ----
// The example goal is $300.00 with $60.00 reported at the start. Deeds are earned at 10, 25, 40, 60, 80 and 100 percent
// of it and kept after a refund. They are decided when a server starts (on the net then; the $60.00 already reaches the
// 10% porch) and once per credit (on the net after any refund already held for that capture).
const START_CENTS = 6000;
const TARGET_CENTS = 30000;
const DEEDS = [['estate:porch', 10], ['tier:1', 25], ['estate:market', 40], ['tier:2', 60], ['estate:ramparts', 80], ['tier:3', 100]];
const byKey = (key) => (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);

function moneyModel() {
  const ledger = [];
  const captures = new Map();
  const refunds = new Map();
  const held = new Map();
  const deeds = new Set();
  const net = () => ledger.reduce((sum, e) => sum + e.effect * e.amount_cents, START_CENTS);
  const award = () => { for (const [key, percent] of DEEDS) if (net() * 100 >= TARGET_CENTS * percent) deeds.add(key); };
  const reverse = (refundId, captureId, cents) => {
    captures.get(captureId).refunded += cents;
    refunds.set(refundId, { captureId, cents });
    ledger.push({ kind: 'refund', effect: -1, amount_cents: cents, source_ref: `paypal-refund:${refundId}` });
  };
  return {
    credit(captureId, cents) {
      captures.set(captureId, { cents, refunded: 0 });
      ledger.push({ kind: 'contribution', effect: 1, amount_cents: cents, source_ref: `paypal-capture:${captureId}` });
      for (const [refundId, h] of [...held]) if (h.captureId === captureId) { held.delete(refundId); reverse(refundId, captureId, h.cents); }
      award();
    },
    started() { award(); },
    hold(refundId, captureId, cents) { held.set(refundId, { captureId, cents }); },
    refund(refundId, captureId, cents) { reverse(refundId, captureId, cents); },
    expected: () => ({
      money: ledger.map((e) => ({ ...e })),
      netCents: net(),
      captures: [...captures].map(([id, c]) => ({ capture_id: id, credited: 1, amount_cents: c.cents, refunded_cents: c.refunded })).sort(byKey('capture_id')),
      refunds: [...refunds].map(([id, r]) => ({ refund_id: id, capture_id: r.captureId, amount_cents: r.cents, credited: 1 })).sort(byKey('refund_id')),
      held: [...held].map(([id, h]) => ({ refund_id: id, capture_id: h.captureId, amount_cents: h.cents })).sort(byKey('refund_id')),
      deeds: [...deeds].sort(),
    }),
  };
}

// What the disposable database holds, through a read-only connection of the test's own. Every result is checked to be
// an array of complete rows before anything in it is counted.
function observe(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = (sql, ...params) => {
      const found = db.prepare(sql).all(...params);
      assert.ok(Array.isArray(found), `an array of rows for ${sql}`);
      return found.map((row) => {
        const plain = { ...row };
        assert.ok(Object.values(plain).every((v) => v !== null && v !== undefined), `a complete row for ${sql}: ${JSON.stringify(plain)}`);
        return plain;
      });
    };
    const ledger = rows('SELECT kind, effect, amount_cents, source_ref FROM ledger_entries WHERE goal_id = ? ORDER BY rowid', DEMO_GOAL_ID);
    for (const e of ledger) assert.ok(Number.isSafeInteger(e.amount_cents) && [1, -1].includes(e.effect), `a ledger amount and direction: ${JSON.stringify(e)}`);
    return {
      starting: ledger.filter((e) => e.kind === 'starting_progress').map(({ kind, effect, amount_cents }) => ({ kind, effect, amount_cents })),
      money: ledger.filter((e) => e.kind !== 'starting_progress'),
      netCents: ledger.reduce((sum, e) => sum + e.effect * e.amount_cents, 0),
      statuses: Object.fromEntries(rows('SELECT provider_order_id, status FROM payment_orders WHERE provider_order_id IS NOT NULL ORDER BY rowid').map((o) => [o.provider_order_id, o.status])),
      captures: rows('SELECT capture_id, credited, amount_cents, refunded_cents FROM payment_captures ORDER BY capture_id'),
      refunds: rows('SELECT refund_id, capture_id, amount_cents, credited FROM payment_refunds ORDER BY refund_id'),
      held: rows('SELECT refund_id, capture_id, amount_cents FROM deferred_refunds ORDER BY refund_id'),
      deeds: rows('SELECT key FROM achievements WHERE goal_id = ? ORDER BY key', DEMO_GOAL_ID).map((r) => r.key),
      events: rows('SELECT event_id, outcome FROM webhook_events ORDER BY event_id'),
    };
  } finally { db.close(); }
}

// ---- The parent's loopback fake PayPal ----
// PayPal lists a capture's refunds on its order and marks the capture refunded; the fake's refund route does not, so
// the harness does, for refunds made through the app and for one made in the PayPal dashboard.
function showRefund(fake, captureId, refund) {
  for (const order of fake.orders.values()) {
    const unit = order.purchase_units[0];
    const capture = unit.payments?.captures?.find((c) => c.id === captureId);
    if (!capture) continue;
    unit.payments.refunds = [...(unit.payments.refunds ?? []), structuredClone(refund)];
    const cents = (value) => Math.round(Number(value) * 100);
    capture.status = unit.payments.refunds.reduce((sum, r) => sum + cents(r.amount.value), 0) >= cents(capture.amount.value) ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  }
}

// Every request is processed by the stateful fake the moment it arrives, so provider truth changes then. `hold` keeps
// back the answers to the next matching requests until the test releases each one (`release`), or loses it (`lose`:
// a 503 after the fake acted). Only this server's own sockets are tracked and closed.
async function servePayPal() {
  const fake = createFakePayPal();
  const log = [];
  const holds = [];
  const parked = new Set();
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const reply = await fake.fetch(SANDBOX + req.url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined });
    const text = await reply.text();
    const pathname = new URL(req.url, SANDBOX).pathname;
    const entry = { n: log.length + 1, method: req.method, pathname, requestId: req.headers['paypal-request-id'] ?? null, fakeStatus: reply.status, held: false, answered: null };
    log.push(entry);
    const refundOf = /^\/v2\/payments\/captures\/([^/]+)\/refund$/.exec(pathname)?.[1];
    if (refundOf && reply.status === 201) { entry.refund = JSON.parse(text); showRefund(fake, refundOf, entry.refund); }
    const held = { entry, res };
    const answer = (lost) => {
      parked.delete(held);
      entry.answered = lost ? 503 : reply.status;
      res.writeHead(entry.answered, { 'Content-Type': 'application/json', 'paypal-debug-id': 'debug-fake' });
      res.end(lost ? LOST : text);
    };
    held.release = () => answer(false);
    held.lose = () => answer(true);
    const hold = holds.find((h) => h.method === req.method && h.pathname === pathname && h.held.length < h.count);
    if (!hold) return answer(false);
    entry.held = true;
    parked.add(held);
    hold.held.push(held);
    if (hold.held.length === hold.count) hold.arrived(hold.held);
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    fake,
    log,
    base: `http://127.0.0.1:${server.address().port}`,
    hold(method, pathname, count = 1) {
      const hold = { method, pathname, count, held: [] };
      const arrived = new Promise((resolve) => { hold.arrived = resolve; });
      holds.push(hold);
      const reached = within(arrived, GATE, `${count} × ${method} ${pathname} to reach the fake PayPal`);
      reached.catch(() => {}); // awaited by the scenario; a scenario that has already failed must not leave it unhandled
      return reached;
    },
    async close() {
      const heldAnswersDestroyed = parked.size;
      for (const held of parked) held.res.destroy();
      parked.clear();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      // Node counts a destroyed socket out of the server (and marks it closed) before the socket emits 'close', which is
      // what removes it from `sockets`. Wait, bounded, for that event from every socket still listed.
      await within(Promise.all([...sockets].map((socket) => new Promise((resolve) => socket.once('close', resolve)))), GATE, 'the fake PayPal sockets to close');
      return { heldAnswersDestroyed, openSockets: sockets.size, listening: server.listening };
    },
  };
}

const capturePath = (orderId) => `/v2/checkout/orders/${orderId}/capture`;
const refundPath = (captureId) => `/v2/payments/captures/${captureId}/refund`;
const providerCaptures = (paypal, orderId) => paypal.fake.orders.get(orderId).purchase_units[0].payments?.captures ?? [];
// The fake's own record: HTTP attempts, the keys they carried and the money effects PayPal made.
function attempts(paypal, pathname) {
  const sent = paypal.log.filter((e) => e.method === 'POST' && e.pathname === pathname);
  return { attempts: sent.length, requestIds: [...new Set(sent.map((e) => e.requestId))], effects: sent.filter((e) => e.fakeStatus === 201).length };
}
const completion = (paypal, orderId, id) => ({ id, event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource: { ...structuredClone(providerCaptures(paypal, orderId)[0]), supplementary_data: { related_ids: { order_id: orderId } } } });
const refundEvent = (refund, id) => ({ id, event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: structuredClone(refund) });

// ---- The servers' API, as a family's browser or PayPal would call it ----
async function createOrder(server, requestId) {
  const created = await server.call('/api/paypal/orders', { ...owner, amountCents: 1500, approverId: 'm_rowan', approvalConfirmed: true, requestId });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  return { orderId: created.json.orderId, captureKey: `capture-${created.json.contribution.id}` };
}
const capture = (server, orderId) => server.call(`/api/paypal/orders/${orderId}/capture`, owner);
const refresh = (server, orderId) => server.call(`/api/paypal/orders/${orderId}/refresh`, owner);
const refund = (server, captureId) => server.call(`/api/paypal/captures/${captureId}/refund`, { ...owner, approverId: 'm_rowan', approvalConfirmed: true });
// A request whose answer is still outstanding. `settled` says whether it has answered (or failed) yet.
function inflight(promise) {
  const call = { settled: false };
  call.done = promise.finally(() => { call.settled = true; });
  call.done.catch(() => {});
  return call;
}
// An answer's status and outcome, and the progress it reports, against the model.
function answered(res, outcome, model, label) {
  assert.equal(res.status, 200, `${label}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.outcome, outcome, `${label}: outcome`);
  if ('progress' in res.json) assert.equal(res.json.progress.progressCents, model.expected().netCents, `${label}: progress in the answer`);
}

// The commit window. With the harness holding the write lock, `release` lets the held work continue; both servers then
// announce their next write transaction, neither has answered, and `during` finds nothing committed yet. Only then is
// the lock released.
async function commitRace({ lock, note, servers, calls, release, during }) {
  const marks = servers.map((s) => s.begins);
  const held = lock();
  try {
    release();
    const deadline = Date.now() + LOCK_WAIT;
    for (const [i, server] of servers.entries()) await server.begun(marks[i] + 1, Math.max(1, deadline - Date.now()));
    assert.ok(calls.every((c) => !c.settled), 'neither server answered while the harness held the write lock');
    during();
    note('commit barrier', { proof: 'both servers announced BEGIN IMMEDIATE while the harness held the write lock; neither had answered and nothing was committed', begins: servers.map((s) => s.begins) });
  } finally { held.release(); }
}

// The harness's own connection takes the SQLite write lock; the servers' next write transactions wait for it.
function writeLock(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 2000');
  db.exec('BEGIN IMMEDIATE');
  return {
    release() { if (db.isOpen) { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); } },
    get open() { return db.isOpen; },
  };
}

const gone = (pid) => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } };

// One fresh disposable database, one fake PayPal and the servers the scenario starts. Whether the scenario passes or
// fails, every lock, server and socket it owns is released or ended, and the cleanup is recorded and then checked.
async function campaign(t, name, body, { onCleanup } = {}) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'our-castle-two-servers-')));
  const file = path.join(dir, 'our-castle-sandbox.sqlite');
  setupDomain({ file, mode: 'sandbox' }).db.close(); // the example household and goal: $60.00 of $300.00
  const paypal = await servePayPal();
  const began = Date.now();
  const record = { name, schedules: [], trace: [] };
  const model = moneyModel();
  const note = (step, detail = {}) => record.trace.push({ ms: Date.now() - began, step, ...detail });
  const servers = [];
  const locks = [];
  const start = async (label) => {
    const before = paypal.log.length;
    const server = await startApp(file, paypal.base, '', { trace: true });
    server.label = label;
    servers.push(server);
    model.started();
    note(`start ${label}`, { pid: server.child.pid, providerRequestsAtStartup: paypal.log.length - before });
    assert.equal(paypal.log.length, before, `starting ${label} makes no provider request`);
    return server;
  };
  const check = (label, statuses = {}) => {
    const seen = observe(file);
    const want = model.expected();
    note(`observe: ${label}`, { seen, want, statuses });
    assert.deepEqual(seen.starting, [{ kind: 'starting_progress', effect: 1, amount_cents: START_CENTS }], `${label}: starting progress`);
    for (const [orderId, status] of Object.entries(statuses)) assert.equal(seen.statuses[orderId], status, `${label}: status of ${orderId}`);
    assert.deepEqual(seen.money, want.money, `${label}: ledger rows and their identities`);
    assert.equal(seen.netCents, want.netCents, `${label}: net cents`);
    assert.deepEqual(seen.captures, want.captures, `${label}: capture records`);
    assert.deepEqual(seen.refunds, want.refunds, `${label}: refund records`);
    assert.deepEqual(seen.held, want.held, `${label}: refunds held for a capture not yet known`);
    assert.deepEqual(seen.deeds, want.deeds, `${label}: deeds`);
    return seen;
  };
  let failure = null;
  try {
    await body({ model, paypal, start, note, check, record, lock: () => { const held = writeLock(file); locks.push(held); return held; } });
  } catch (error) { failure = error; }
  const problems = [];
  for (const held of locks) { try { held.release(); } catch (error) { problems.push(error); } }
  for (const server of servers) { try { await server.kill(); } catch (error) { problems.push(error); } }
  let closed = { heldAnswersDestroyed: null, openSockets: null, listening: null };
  try { closed = await paypal.close(); } catch (error) { problems.push(error); }
  record.cleanup = {
    children: servers.map((s) => ({ label: s.label, pid: s.child.pid, exitCode: s.child.exitCode, signal: s.child.signalCode, gone: gone(s.child.pid) })),
    ...closed,
    locksOpen: locks.filter((held) => held.open).length,
    problems: problems.map(String),
  };
  record.provider = paypal.log;
  rmSync(dir, { recursive: true, force: true });
  onCleanup?.(record.cleanup);
  if (process.env.TWO_SERVER_EVIDENCE_DIR) {
    mkdirSync(process.env.TWO_SERVER_EVIDENCE_DIR, { recursive: true });
    writeFileSync(path.join(process.env.TWO_SERVER_EVIDENCE_DIR, `${name}.json`), `${JSON.stringify({ ...record, failure: failure ? String(failure.stack) : null }, null, 2)}\n`);
  }
  if (failure) throw failure;
  const { cleanup } = record;
  assert.ok(cleanup.children.every((c) => (c.exitCode !== null || c.signal !== null) && c.gone), `every owned server ended: ${JSON.stringify(cleanup.children)}`);
  assert.deepEqual([cleanup.openSockets, cleanup.listening, cleanup.locksOpen, cleanup.problems], [0, false, 0, []]);
  for (const s of record.schedules) t.diagnostic(`${s.id} ${JSON.stringify(s)}`);
  t.diagnostic(`cleanup ${JSON.stringify(cleanup)}`);
}

// ---- Schedules ----

test('two servers capture one order: one request id, one provider capture and one credit, in each order (S1–S3)', { timeout: 120_000 }, (t) => campaign(t, 'same-order-captures', async ({ model, paypal, start, note, check, record, lock }) => {
  const A = await start('A');
  const B = await start('B');
  // S1: A's attempt reaches PayPal first and is held; B's attempt for the same order follows and is held; B's answer is
  // released first. S2: the same, A's answer first. S3: both released while the harness holds the write lock.
  for (const [id, first, creator] of [['S1', 'B', A], ['S2', 'A', B], ['S3', 'SQLite', A]]) {
    const { orderId, captureKey } = await createOrder(creator, `two-server-${id}-capture`);
    const reachedA = paypal.hold('POST', capturePath(orderId));
    const a = inflight(capture(A, orderId));
    const [heldA] = await reachedA;
    const reachedB = paypal.hold('POST', capturePath(orderId));
    const b = inflight(capture(B, orderId));
    const [heldB] = await reachedB;
    // Both attempts are at the fake and unanswered: A's was processed, B's was replayed under the same key.
    assert.deepEqual([heldA.entry.requestId, heldB.entry.requestId], [captureKey, captureKey]);
    assert.deepEqual([heldA.entry.fakeStatus, heldB.entry.fakeStatus], [201, 200]);
    assert.ok(!a.settled && !b.settled, 'neither server has answered');
    const captureId = providerCaptures(paypal, orderId)[0].id;
    note(`${id} barrier`, { proof: 'both capture attempts at the fake, answers held', requests: [heldA.entry.n, heldB.entry.n] });
    check(`${id} both attempts in flight`, { [orderId]: 'created' });
    const outcomes = {};
    if (first === 'SQLite') {
      await commitRace({ lock, note, servers: [A, B], calls: [a, b], release: () => { heldA.release(); heldB.release(); },
        during: () => check(`${id} both waiting for the write lock`, { [orderId]: 'created' }) });
      const answers = { A: await a.done, B: await b.done };
      model.credit(captureId, 1500);
      const credited = Object.keys(answers).filter((k) => answers[k].json.outcome === 'completed');
      assert.equal(credited.length, 1, `exactly one server credited: ${JSON.stringify(Object.values(answers).map((r) => r.json.outcome))}`);
      for (const [k, res] of Object.entries(answers)) { answered(res, k === credited[0] ? 'completed' : 'already_completed', model, `${id} ${k}`); outcomes[k] = res.json.outcome; }
    } else {
      const order = first === 'B' ? [['B', heldB, b], ['A', heldA, a]] : [['A', heldA, a], ['B', heldB, b]];
      for (const [i, [k, held, call]] of order.entries()) {
        held.release();
        const res = await call.done;
        if (i === 0) model.credit(captureId, 1500);
        answered(res, i === 0 ? 'completed' : 'already_completed', model, `${id} ${k}`);
        outcomes[k] = res.json.outcome;
        check(`${id} after ${k} answered`, { [orderId]: 'completed' });
      }
    }
    check(`${id} settled`, { [orderId]: 'completed' });
    const provider = attempts(paypal, capturePath(orderId));
    assert.deepEqual(provider, { attempts: 2, requestIds: [captureKey], effects: 1 });
    assert.equal(providerCaptures(paypal, orderId).length, 1);
    record.schedules.push({ id, controlled: 'A and B capture attempts for one order both held at the fake', released: first === 'SQLite' ? 'both, under the write lock; SQLite chose the writer' : `${first} first`, outcomes, provider });
  }
}));

test('one server loses its capture answer while the other captures the same order: one credit, and a settled order stays settled (S4–S5)', { timeout: 120_000 }, (t) => campaign(t, 'lost-capture-answer', async ({ model, paypal, start, check, record }) => {
  const A = await start('A');
  const B = await start('B');

  // S4: PayPal captures but A's answer is lost (503). A marks the order unresolved and re-reads it; that read is held
  // while B captures the same order.
  {
    const { orderId, captureKey } = await createOrder(A, 'two-server-S4-unknown');
    const reached = paypal.hold('POST', capturePath(orderId));
    const a = inflight(capture(A, orderId));
    const [held] = await reached;
    const reading = paypal.hold('GET', `/v2/checkout/orders/${orderId}`);
    held.lose();
    const [read] = await reading; // A sends this read only after marking the order unresolved
    assert.ok(!a.settled);
    check('S4 A unresolved, its read held', { [orderId]: 'pending' });
    const rb = await capture(B, orderId);
    const captureId = providerCaptures(paypal, orderId)[0].id;
    model.credit(captureId, 1500);
    answered(rb, 'completed', model, 'S4 B');
    check('S4 after B', { [orderId]: 'completed' });
    read.release();
    answered(await a.done, 'already_completed', model, 'S4 A after its read');
    check('S4 settled', { [orderId]: 'completed' });
    const provider = attempts(paypal, capturePath(orderId));
    assert.deepEqual(provider, { attempts: 2, requestIds: [captureKey], effects: 1 });
    record.schedules.push({ id: 'S4', controlled: "A's capture answer lost (503) after PayPal captured; A's follow-up read held", released: "B's capture, then A's read", outcomes: { A: 'already_completed', B: 'completed' }, provider });
  }

  // S5: A's attempt is held; B captures and credits; then A's answer is lost. A finds the order settled and keeps it.
  {
    const { orderId, captureKey } = await createOrder(B, 'two-server-S5-unknown');
    const reached = paypal.hold('POST', capturePath(orderId));
    const a = inflight(capture(A, orderId));
    const [held] = await reached;
    const rb = await capture(B, orderId);
    const captureId = providerCaptures(paypal, orderId)[0].id;
    model.credit(captureId, 1500);
    answered(rb, 'completed', model, 'S5 B');
    check('S5 after B', { [orderId]: 'completed' });
    held.lose();
    answered(await a.done, 'already_completed', model, 'S5 A');
    check('S5 settled, never reopened as unresolved', { [orderId]: 'completed' });
    const provider = attempts(paypal, capturePath(orderId));
    assert.deepEqual(provider, { attempts: 2, requestIds: [captureKey], effects: 1 });
    record.schedules.push({ id: 'S5', controlled: "A's capture held at the fake", released: "B's capture first, then A's answer as a 503", outcomes: { A: 'already_completed', B: 'completed' }, provider });
  }
}));

// S6 and S7: PayPal refuses A's attempt and the refusal is held on its way back. The buyer then approves (or picks
// another funding source). The fake keeps no refusal under the request id, the model behind the app's own "try again"
// answers, so B's attempt with the same key captures and credits. Then A's refusal arrives.
for (const [id, issue] of [['S6', 'ORDER_NOT_APPROVED'], ['S7', 'INSTRUMENT_DECLINED']]) {
  test(`a ${issue} refusal that reaches one server after the other captured the same order leaves it completed (${id})`, { timeout: 120_000 }, (t) => campaign(t, `late-refusal-${id}`, async ({ model, paypal, start, check, record }) => {
    const A = await start('A');
    const B = await start('B');
    const { orderId, captureKey } = await createOrder(A, `two-server-${id}-refusal`);
    paypal.fake.behavior.captureError = { status: 422, issue };
    const reached = paypal.hold('POST', capturePath(orderId));
    const a = inflight(capture(A, orderId));
    const [held] = await reached;
    assert.equal(held.entry.fakeStatus, 422, 'PayPal refused A and the refusal is held');
    paypal.fake.behavior.captureError = null;
    const rb = await capture(B, orderId);
    const captureId = providerCaptures(paypal, orderId)[0].id;
    model.credit(captureId, 1500);
    answered(rb, 'completed', model, `${id} B`);
    check(`${id} after B`, { [orderId]: 'completed' });
    held.release();
    const ra = await a.done;
    record.schedules.push({ id, controlled: `A's capture refused (${issue}) and the refusal held at the fake`, released: "after B's attempt with the same key captured and credited", outcomes: { B: 'completed', A: ra.json.outcome } });
    check(`${id} after A's late refusal`, { [orderId]: 'completed' });
    answered(ra, 'already_completed', model, `${id} A's late refusal`);
    // A later explicit check keeps the order completed.
    answered(await refresh(A, orderId), 'already_completed', model, `${id} check`);
    check(`${id} after a check`, { [orderId]: 'completed' });
    const provider = attempts(paypal, capturePath(orderId));
    assert.deepEqual(provider, { attempts: 2, requestIds: [captureKey], effects: 1 });
    record.schedules.at(-1).provider = provider;
  }));
}

test('one completion delivered to both servers while the capture answer is held: one credit (S8)', { timeout: 120_000 }, (t) => campaign(t, 'duplicate-completion', async ({ model, paypal, start, note, check, record, lock }) => {
  const A = await start('A');
  const B = await start('B');
  const { orderId, captureKey } = await createOrder(A, 'two-server-S8-deliveries');
  const reached = paypal.hold('POST', capturePath(orderId));
  const a = inflight(capture(A, orderId));
  const [held] = await reached; // PayPal captured; A's answer is held
  const captureId = providerCaptures(paypal, orderId)[0].id;
  const event = completion(paypal, orderId, 'WH-TWO-SERVER-S8');
  const verifying = paypal.hold('POST', VERIFY, 2);
  const da = inflight(A.deliver(event));
  const db = inflight(B.deliver(event));
  const checks = await verifying; // both deliveries are at PayPal's signature check, unanswered
  note('S8 barrier', { proof: 'both deliveries of one event at the signature check, answers held', requests: checks.map((c) => c.entry.n) });
  check('S8 both deliveries in flight', { [orderId]: 'created' });
  // Both signature checks pass while the harness holds the write lock; SQLite chooses which delivery credits.
  await commitRace({ lock, note, servers: [A, B], calls: [da, db], release: () => { for (const c of checks) c.release(); },
    during: () => check('S8 both waiting for the write lock', { [orderId]: 'created' }) });
  const [ra, rb] = [await da.done, await db.done];
  assert.deepEqual([ra.status, rb.status], [200, 200], JSON.stringify([ra.json, rb.json]));
  const deliveries = { A: ra.json.outcome, B: rb.json.outcome };
  model.credit(captureId, 1500);
  assert.deepEqual(Object.values(deliveries).sort(), ['already_completed', 'completed'], JSON.stringify(deliveries));
  const seen = check('S8 after both deliveries', { [orderId]: 'completed' });
  const recorded = seen.events.filter((e) => e.event_id === event.id);
  assert.equal(recorded.length, 1, 'the event is recorded once');
  assert.ok(['completed', 'already_completed'].includes(recorded[0].outcome));
  held.release();
  answered(await a.done, 'already_completed', model, 'S8 A capture answer');
  assert.equal((await B.deliver(event)).json.outcome, 'duplicate_event');
  assert.equal((await A.deliver({ ...event, id: 'WH-TWO-SERVER-S8-AGAIN' })).json.outcome, 'already_completed');
  check('S8 settled', { [orderId]: 'completed' });
  const provider = attempts(paypal, capturePath(orderId));
  assert.deepEqual(provider, { attempts: 1, requestIds: [captureKey], effects: 1 });
  record.schedules.push({ id: 'S8', controlled: "A's capture answer held; the same completion's signature checks on A and B held", released: 'both checks under the write lock (SQLite chose the writer), then the capture answer', outcomes: { deliveries, capture: 'already_completed', redelivery: 'duplicate_event' }, provider });
}));

test('a refund delivered to one server before the other learns of the capture is held, then applied once with the credit (S9)', { timeout: 120_000 }, (t) => campaign(t, 'refund-before-completion', async ({ model, paypal, start, check, record }) => {
  const A = await start('A');
  const B = await start('B');
  const { orderId, captureKey } = await createOrder(A, 'two-server-S9-deferred');
  const reached = paypal.hold('POST', capturePath(orderId));
  const a = inflight(capture(A, orderId));
  const [held] = await reached; // PayPal captured; A's answer (showing COMPLETED) is held
  const captureId = providerCaptures(paypal, orderId)[0].id;
  const earlier = completion(paypal, orderId, 'WH-TWO-SERVER-S9-COMPLETED');
  // The merchant refunds in the PayPal dashboard. The event reaches B, which has no record of this capture yet.
  const dashboard = { id: 'REFUNDTWOSRV9TEST', status: 'COMPLETED', amount: { currency_code: 'USD', value: '15.00' }, links: [{ rel: 'up', href: `${SANDBOX}/v2/payments/captures/${captureId}` }] };
  showRefund(paypal.fake, captureId, dashboard);
  const refunded = refundEvent(dashboard, 'WH-TWO-SERVER-S9-REFUNDED');
  assert.equal((await B.deliver(refunded)).json.outcome, 'ignored_unknown_capture');
  model.hold(dashboard.id, captureId, 1500);
  check('S9 refund held for an unknown capture', { [orderId]: 'created' });
  held.release();
  const ra = await a.done;
  model.credit(captureId, 1500); // the credit and the held reversal in one transaction, so no deed
  answered(ra, 'refunded', model, 'S9 A');
  check('S9 credited with its held refund', { [orderId]: 'refunded' });
  assert.equal((await B.deliver(earlier)).json.outcome, 'already_completed');
  assert.equal((await A.deliver({ ...refunded, id: 'WH-TWO-SERVER-S9-REFUNDED-AGAIN' })).json.outcome, 'duplicate_refund');
  assert.equal((await A.deliver(refunded)).json.outcome, 'duplicate_event');
  check('S9 settled', { [orderId]: 'refunded' });
  const provider = attempts(paypal, capturePath(orderId));
  assert.deepEqual(provider, { attempts: 1, requestIds: [captureKey], effects: 1 });
  record.schedules.push({ id: 'S9', controlled: "A's capture answer held while a dashboard refund's event reached B", released: "A's capture answer after B held the refund", outcomes: { B_refund: 'ignored_unknown_capture', A: 'refunded', late_completion: 'already_completed', refund_again: 'duplicate_refund' }, provider });
}));

test('a stale read and a stale completion arriving after a known refund change nothing, and the earned deed stays (S10–S11)', { timeout: 120_000 }, (t) => campaign(t, 'stale-after-refund', async ({ model, paypal, start, check, record }) => {
  const A = await start('A');
  const B = await start('B');
  const { orderId } = await createOrder(A, 'two-server-S10-stale');
  const rc = await capture(A, orderId);
  const captureId = providerCaptures(paypal, orderId)[0].id;
  model.credit(captureId, 1500);
  answered(rc, 'completed', model, 'credit');
  check('credited, deed earned', { [orderId]: 'completed' });
  const earlier = completion(paypal, orderId, 'WH-TWO-SERVER-S11-STALE');
  // S10: A's explicit check reads the order before the refund; the answer is held.
  const reading = paypal.hold('GET', `/v2/checkout/orders/${orderId}`);
  const checking = inflight(refresh(A, orderId));
  const [read] = await reading;
  // S11: B's copy of the earlier completion is at the signature check, held.
  const verifying = paypal.hold('POST', VERIFY);
  const late = inflight(B.deliver(earlier));
  const [verification] = await verifying;
  // The adult refunds through A while both stale arrivals are held.
  const rr = await refund(A, captureId);
  const made = paypal.log.find((e) => e.pathname === refundPath(captureId) && e.refund);
  model.refund(made.refund.id, captureId, 1500);
  answered(rr, 'refunded', model, 'refund');
  check('refunded, deed kept', { [orderId]: 'refunded' });
  read.release();
  answered(await checking.done, 'already_completed', model, 'S10 stale read');
  check('S10 after the stale read', { [orderId]: 'refunded' });
  verification.release();
  assert.equal((await late.done).json.outcome, 'already_completed');
  check('S11 after the stale completion', { [orderId]: 'refunded' });
  const provider = attempts(paypal, refundPath(captureId));
  assert.deepEqual(provider, { attempts: 1, requestIds: [`refund-${captureId}-1`], effects: 1 });
  record.schedules.push({ id: 'S10', controlled: "A's check read held from before the refund", released: 'after the refund was recorded', outcomes: { check: 'already_completed' }, provider });
  record.schedules.push({ id: 'S11', controlled: "B's signature check of an earlier completion held", released: 'after the refund was recorded', outcomes: { delivery: 'already_completed' }, provider });
}));

test('two servers refund one capture: one request id, one provider refund and one reversal, and the deed stays (S12)', { timeout: 120_000 }, (t) => campaign(t, 'same-capture-refunds', async ({ model, paypal, start, note, check, record, lock }) => {
  const A = await start('A');
  const B = await start('B');
  const { orderId } = await createOrder(A, 'two-server-S12-refunds');
  const rc = await capture(A, orderId);
  const captureId = providerCaptures(paypal, orderId)[0].id;
  model.credit(captureId, 1500);
  answered(rc, 'completed', model, 'credit');
  const key = `refund-${captureId}-1`;
  const reachedA = paypal.hold('POST', refundPath(captureId));
  const a = inflight(refund(A, captureId));
  const [heldA] = await reachedA; // PayPal refunded; A's answer is held
  const reachedB = paypal.hold('POST', refundPath(captureId));
  const b = inflight(refund(B, captureId));
  const [heldB] = await reachedB; // B's attempt carries the same key and is replayed
  assert.deepEqual([heldA.entry.requestId, heldB.entry.requestId], [key, key]);
  assert.deepEqual([heldA.entry.fakeStatus, heldB.entry.fakeStatus], [201, 200]);
  note('S12 barrier', { proof: 'both refund attempts at the fake, answers held', requests: [heldA.entry.n, heldB.entry.n] });
  check('S12 both refunds in flight', { [orderId]: 'completed' });
  await commitRace({ lock, note, servers: [A, B], calls: [a, b], release: () => { heldA.release(); heldB.release(); },
    during: () => check('S12 both waiting for the write lock', { [orderId]: 'completed' }) });
  const answers = { A: await a.done, B: await b.done };
  model.refund(heldA.entry.refund.id, captureId, 1500);
  const reversed = Object.keys(answers).filter((k) => answers[k].json.outcome === 'refunded');
  assert.equal(reversed.length, 1, `exactly one server reversed: ${JSON.stringify(Object.values(answers).map((r) => r.json.outcome))}`);
  for (const [k, res] of Object.entries(answers)) answered(res, k === reversed[0] ? 'refunded' : 'duplicate_refund', model, `S12 ${k}`);
  check('S12 settled, deed kept', { [orderId]: 'refunded' });
  const provider = attempts(paypal, refundPath(captureId));
  assert.deepEqual(provider, { attempts: 2, requestIds: [key], effects: 1 });
  record.schedules.push({ id: 'S12', controlled: 'A and B refund attempts for one capture both held at the fake', released: 'both, under the write lock; SQLite chose the writer', outcomes: Object.fromEntries(Object.entries(answers).map(([k, r]) => [k, r.json.outcome])), provider });
}));

test('one server dies mid-capture and mid-refund while the other keeps serving: one credit and one reversal (S13–S14)', { timeout: 120_000 }, (t) => campaign(t, 'restart-with-live-peer', async ({ model, paypal, start, check, record }) => {
  let A = await start('A');
  const B = await start('B');
  const unanswered = (call) => call.done.then(() => 'answered', () => 'no answer');

  // S13: PayPal captures while A's answer is held; A is killed. B captures the same order itself; A restarts.
  const { orderId, captureKey } = await createOrder(A, 'two-server-S13-restart');
  const reached = paypal.hold('POST', capturePath(orderId));
  const a = inflight(capture(A, orderId));
  await reached;
  await A.kill();
  assert.equal(await unanswered(a), 'no answer');
  check('S13 A killed, nothing credited', { [orderId]: 'created' });
  const rb = await capture(B, orderId);
  const captureId = providerCaptures(paypal, orderId)[0].id;
  model.credit(captureId, 1500);
  answered(rb, 'completed', model, 'S13 B');
  check('S13 B credited', { [orderId]: 'completed' });
  A = await start('A2');
  let before = paypal.log.length;
  answered(await capture(A, orderId), 'already_completed', model, 'S13 A2 retry');
  assert.equal(paypal.log.length, before, 'a settled order is answered without calling PayPal');
  const event = completion(paypal, orderId, 'WH-TWO-SERVER-S13');
  assert.equal((await A.deliver(event)).json.outcome, 'already_completed');
  assert.equal((await B.deliver(event)).json.outcome, 'duplicate_event');
  check('S13 settled', { [orderId]: 'completed' });
  const captures = attempts(paypal, capturePath(orderId));
  assert.deepEqual(captures, { attempts: 2, requestIds: [captureKey], effects: 1 });
  record.schedules.push({ id: 'S13', controlled: "A's capture answer held at the fake, then A killed with SIGKILL", released: 'never (A gone); B captured; A restarted', outcomes: { A: 'no answer', B: 'completed', A2: 'already_completed' }, provider: captures });

  // S14: PayPal refunds while A2's answer is held; A2 is killed. The refund event reaches B; A restarts and the adult
  // asks again.
  const refunding = paypal.hold('POST', refundPath(captureId));
  const r = inflight(refund(A, captureId));
  const [held] = await refunding;
  await A.kill();
  assert.equal(await unanswered(r), 'no answer');
  check('S14 A2 killed, nothing reversed', { [orderId]: 'completed' });
  const delivered = await B.deliver(refundEvent(held.entry.refund, 'WH-TWO-SERVER-S14'));
  model.refund(held.entry.refund.id, captureId, 1500);
  assert.equal(delivered.json.outcome, 'refunded');
  check('S14 B recorded the refund, deed kept', { [orderId]: 'refunded' });
  A = await start('A3');
  before = paypal.log.length;
  const again = await refund(A, captureId);
  assert.deepEqual([again.status, again.json.error?.code], [409, 'already_refunded']);
  assert.equal(paypal.log.length, before, 'the refused request makes no provider request');
  check('S14 settled', { [orderId]: 'refunded' });
  const refunds = attempts(paypal, refundPath(captureId));
  assert.deepEqual(refunds, { attempts: 1, requestIds: [`refund-${captureId}-1`], effects: 1 });
  record.schedules.push({ id: 'S14', controlled: "A2's refund answer held at the fake, then A2 killed with SIGKILL", released: 'never (A2 gone); the refund event reached B; A restarted', outcomes: { A2: 'no answer', B_event: 'refunded', A3: '409 already_refunded' }, provider: refunds });
}));

test('a failing scenario still ends both servers, destroys held answers, closes the fake PayPal and releases the write lock', { timeout: 60_000 }, async (t) => {
  let cleanup;
  await assert.rejects(campaign(t, 'cleanup-on-failure', async ({ paypal, start, lock }) => {
    const A = await start('A');
    const B = await start('B');
    const { orderId } = await createOrder(A, 'two-server-cleanup-check');
    const reached = paypal.hold('POST', capturePath(orderId));
    inflight(capture(B, orderId));
    await reached;
    lock();
    throw new Error('deliberate failure while an answer is held and the harness holds the write lock');
  }, { onCleanup: (c) => { cleanup = c; } }), /deliberate failure/);
  assert.equal(cleanup.children.length, 2);
  for (const c of cleanup.children) assert.ok((c.exitCode !== null || c.signal !== null) && c.gone, JSON.stringify(c));
  assert.deepEqual([cleanup.heldAnswersDestroyed, cleanup.openSockets, cleanup.listening, cleanup.locksOpen, cleanup.problems], [1, 0, false, 0, []]);
  t.diagnostic(`cleanup ${JSON.stringify(cleanup)}`);
});
