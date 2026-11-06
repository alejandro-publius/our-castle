import test from 'node:test';
import assert from 'node:assert/strict';
import { createPayPalClient, PayPalError } from '../../server/payments/paypal-client.mjs';
import { createContributionService } from '../../server/payments/contributions.mjs';
import { DEMO_GOAL_ID, DEMO_HOUSEHOLD_ID } from '../../server/household.mjs';
import { contribution, setupDomain } from '../helpers/setup.mjs';
import { webhookHeaders } from '../helpers/fake-paypal.mjs';

// Webinar follow-ups (W1 webhooks, W2 resilience, W4 missed refunds), checked against the stateful fake sandbox and
// a recording fetch. These prove what this server does with PayPal's answers; they are not a live sandbox run.
const owner = { householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID };
const progress = (env) => env.db.prepare('SELECT COALESCE(SUM(effect * amount_cents), 0) AS p FROM ledger_entries WHERE goal_id = ?').get(DEMO_GOAL_ID).p;
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

async function captured(env, amountCents = 1500) {
  const { orderId } = await env.service.createPayPalOrder(contribution({ amountCents }));
  const res = await env.service.capturePayPalOrder({ providerOrderId: orderId, ...owner });
  assert.equal(res.outcome, 'completed');
  return { orderId, captureId: res.contribution.captures[0].captureId, contributionId: res.contribution.id };
}

test('webhook verification sends the delivered body byte-for-byte, not a re-serialization', async () => {
  const sent = [];
  const fetch = async (url, init) => {
    const { pathname } = new URL(url);
    if (pathname === '/v1/oauth2/token') return json({ access_token: 'tok', expires_in: 32400 });
    sent.push(init.body);
    return json({ verification_status: 'SUCCESS' });
  };
  const client = createPayPalClient({ clientId: 'id', clientSecret: 'secret', fetch });
  // Odd spacing, a trailing newline, a number with a trailing zero and an escaped character: all things JSON.stringify
  // would normalise away, and all things PayPal's signature covers.
  const rawBody = '{"id": "WH-EVT-RAW",\n  "event_type": "PAYMENT.CAPTURE.COMPLETED",\n  "resource": {"amount": {"value": "15.10"}, "note": "caf\\u00e9", "n": 1.0}}\n';
  const event = JSON.parse(rawBody);
  assert.equal(await client.verifyWebhookSignature({ headers: webhookHeaders, rawBody, event, webhookId: 'WH-TEST' }), true);

  const [body] = sent;
  assert.ok(body.endsWith(`,"webhook_event":${rawBody.trim()}}`), 'the event is embedded exactly as delivered');
  const parsed = JSON.parse(body);
  assert.equal(parsed.webhook_id, 'WH-TEST');
  assert.equal(parsed.transmission_id, webhookHeaders['paypal-transmission-id']);
  assert.deepEqual(parsed.webhook_event, event);
  assert.notEqual(body, JSON.stringify(parsed), 're-serialising would have changed the bytes');

  // Without a raw body (older callers) the parsed event is sent, and missing headers never reach PayPal.
  await client.verifyWebhookSignature({ headers: webhookHeaders, event, webhookId: 'WH-TEST' });
  assert.equal(JSON.parse(sent[1]).webhook_event.resource.n, 1);
  assert.equal(await client.verifyWebhookSignature({ headers: {}, rawBody, event, webhookId: 'WH-TEST' }), false);
  assert.equal(sent.length, 2);
});

test('a REST call that never answers is bounded, and a capture that times out becomes "not known yet", never failed', async () => {
  const env = setupDomain({ mode: 'sandbox' });
  let hung = 0;
  const fetch = (url, init) => {
    if (!/\/capture$/.test(new URL(url).pathname)) return env.fake.fetch(url, init);
    hung++;
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  };
  const paypal = createPayPalClient({ clientId: 'test-client-id', clientSecret: 'test-client-secret', fetch, timeoutMs: 25 });
  const service = createContributionService({ db: env.db, clock: env.clock, mode: 'sandbox', paypal, webhookId: 'WH-TEST' });
  const before = progress(env);
  const { orderId } = await service.createPayPalOrder(contribution({ amountCents: 1500 }));
  const started = Date.now();
  const res = await service.capturePayPalOrder({ providerOrderId: orderId, ...owner });
  assert.ok(Date.now() - started < 2000, 'the wait was bounded by timeoutMs');
  assert.equal(hung, 1);
  assert.equal(res.outcome, 'unknown');
  assert.equal(res.contribution.status, 'pending');
  assert.match(res.contribution.statusDetail, /not known yet/);
  assert.equal(progress(env), before);

  // The two no-answer cases are distinguishable but both lack an HTTP status, which is what "unknown outcome" keys on.
  const timedOut = createPayPalClient({ clientId: 'a', clientSecret: 'b', timeoutMs: 5, fetch: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))) });
  await assert.rejects(timedOut.getOrder('ORDER1'), (e) => e instanceof PayPalError && e.status === null && e.paypalName === 'TIMEOUT' && /did not answer in time/.test(e.message));
  const unreachable = createPayPalClient({ clientId: 'a', clientSecret: 'b', fetch: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(unreachable.getOrder('ORDER1'), (e) => e instanceof PayPalError && e.status === null && e.paypalName === 'NETWORK_ERROR' && /Could not reach/.test(e.message));
  const bug = createPayPalClient({ clientId: 'a', clientSecret: 'b', fetch: async () => { throw new RangeError('programming error'); } });
  await assert.rejects(bug.getOrder('ORDER1'), RangeError, 'other errors are not disguised as PayPal outages');
});

test('a refund made in the PayPal dashboard is picked up from get_order once, and its late webhook is a duplicate', async () => {
  const env = setupDomain({ mode: 'sandbox' });
  const before = progress(env);
  const { orderId, captureId } = await captured(env, 1500);
  assert.equal(progress(env) - before, 1500);

  // The merchant refunds from the dashboard. No webhook reaches this server; PayPal's order record now lists the refund.
  const unit = env.fake.orders.get(orderId).purchase_units[0];
  unit.payments.captures[0].status = 'REFUNDED';
  unit.payments.refunds = [{ id: 'REFUNDDASH0001TEST', status: 'COMPLETED', amount: { currency_code: 'USD', value: '15.00' },
    links: [{ rel: 'up', href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}` }] }];

  const refreshed = await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner });
  assert.equal(refreshed.outcome, 'refunded');
  assert.equal(refreshed.contribution.status, 'refunded');
  assert.equal(progress(env), before, 'progress fell by exactly the refunded amount');

  const again = await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner });
  assert.equal(again.outcome, 'already_completed', 'a second read applies nothing');
  assert.equal(progress(env), before);

  const event = { id: 'WH-EVT-LATE', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'REFUNDDASH0001TEST', status: 'COMPLETED', amount: { currency_code: 'USD', value: '15.00' }, links: unit.payments.refunds[0].links } };
  const late = await env.service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify(event) });
  assert.equal(late.outcome, 'duplicate_refund');
  assert.equal(progress(env), before);
});

test('a capture first seen as REFUNDED is never credited and says so', async () => {
  const env = setupDomain({ mode: 'sandbox' });
  const before = progress(env);
  const { orderId, contribution: row } = await env.service.createPayPalOrder(contribution({ amountCents: 1500 }));
  const order = env.fake.orders.get(orderId);
  const unit = order.purchase_units[0];
  order.status = 'COMPLETED';
  unit.payments = { captures: [{ id: 'CAPTUREGONE001TEST', status: 'REFUNDED', amount: { ...unit.amount }, custom_id: row.id }] };
  const res = await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner });
  assert.equal(res.outcome, 'not_credited');
  assert.equal(res.contribution.status, 'failed');
  assert.match(res.contribution.statusDetail, /refunded in PayPal before any progress was recorded/);
  assert.equal(progress(env), before);
});

test('a second refund is refused while the first is still pending in PayPal', async () => {
  const env = setupDomain({ mode: 'sandbox', paypalOptions: { refundStatus: 'PENDING' } });
  const before = progress(env);
  const { captureId } = await captured(env, 1500);
  const approval = { captureId, householdId: DEMO_HOUSEHOLD_ID, approverId: 'm_rowan', approvalConfirmed: true };
  const first = await env.service.refundPayPalCapture(approval);
  assert.equal(first.outcome, 'refund_pending');
  assert.equal(progress(env) - before, 1500, 'a pending refund changes nothing yet');
  const refundCalls = () => env.fake.requests.filter((r) => /\/refund$/.test(r.pathname)).length;
  assert.equal(refundCalls(), 1);
  await assert.rejects(env.service.refundPayPalCapture(approval), { code: 'refund_pending' });
  assert.equal(refundCalls(), 1, 'PayPal was not asked for the same money twice');

  // PayPal completes it (as a webhook would report): the same refund id is credited once.
  const event = { id: 'WH-EVT-REFUND-DONE', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: first.contribution.captures[0].refunds?.[0]?.refundId ?? env.db.prepare('SELECT refund_id FROM payment_refunds WHERE capture_id = ?').get(captureId).refund_id, status: 'COMPLETED', amount: { currency_code: 'USD', value: '15.00' }, links: [{ rel: 'up', href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}` }] } };
  const done = await env.service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify(event) });
  assert.equal(done.outcome, 'refunded');
  assert.equal(progress(env), before);
  await assert.rejects(env.service.refundPayPalCapture(approval), { code: 'already_refunded' });
});
