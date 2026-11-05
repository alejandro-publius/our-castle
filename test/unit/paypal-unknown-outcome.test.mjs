import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_GOAL_ID, DEMO_HOUSEHOLD_ID } from '../../server/household.mjs';
import { contribution, setupDomain } from '../helpers/setup.mjs';
import { webhookHeaders } from '../helpers/fake-paypal.mjs';

// Unknown outcomes on PayPal writes, through the official Server SDK adapter (as production uses) and the stateful fake
// sandbox. A capture or refund whose answer is lost may still have happened at PayPal: it must be settled from PayPal's
// own record for the same order/request, never reported as failed, and never credited twice. Fakes only; no live call.
const dropped = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
const owner = { householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID };
const progress = (s) => s.db.prepare('SELECT COALESCE(SUM(effect * amount_cents), 0) AS p FROM ledger_entries WHERE goal_id = ?').get(DEMO_GOAL_ID).p;
const calls = (s, name) => s.controllers.sdkCalls.filter((c) => c.name === name);

test('a capture whose answer is lost is settled from the same PayPal order and credited exactly once', async () => {
  const s = setupDomain({ mode: 'sandbox', adapter: 'sdk' });
  const before = progress(s);
  const created = await s.service.createPayPalOrder(contribution({ amountCents: 1500 }));
  const real = s.controllers.orders.captureOrder;
  s.controllers.orders.captureOrder = async (args) => { await real.call(s.controllers.orders, args); throw dropped(); }; // PayPal captured; the reply was lost
  const res = await s.service.capturePayPalOrder({ providerOrderId: created.orderId, ...owner });
  assert.equal(res.outcome, 'completed');
  assert.equal(res.contribution.status, 'completed');
  assert.equal(progress(s) - before, 1500);
  // It re-read the same order after the failed capture rather than guessing.
  const names = s.controllers.sdkCalls.map((c) => c.name);
  assert.ok(names.lastIndexOf('getOrder') > names.lastIndexOf('captureOrder'));
  assert.deepEqual(calls(s, 'getOrder').at(-1).args, { id: created.orderId });
  // A second capture attempt does not credit again.
  s.controllers.orders.captureOrder = real;
  const again = await s.service.capturePayPalOrder({ providerOrderId: created.orderId, ...owner });
  assert.equal(again.outcome, 'already_completed');
  assert.equal(progress(s) - before, 1500);
});

test('when PayPal cannot be reached at all, the payment is "not known yet", never failed, and settles once later', async () => {
  const s = setupDomain({ mode: 'sandbox', adapter: 'sdk' });
  const before = progress(s);
  const created = await s.service.createPayPalOrder(contribution({ amountCents: 2000 }));
  const { captureOrder: realCapture, getOrder: realGet } = s.controllers.orders;
  s.controllers.orders.captureOrder = async (args) => { s.controllers.sdkCalls.push({ name: 'captureOrder', args }); throw dropped(); };
  s.controllers.orders.getOrder = async (args) => { s.controllers.sdkCalls.push({ name: 'getOrder', args }); throw dropped(); };
  const res = await s.service.capturePayPalOrder({ providerOrderId: created.orderId, ...owner });
  assert.equal(res.outcome, 'unknown');
  assert.equal(res.contribution.status, 'pending'); // shown as pending with "Check with PayPal", not failed
  assert.match(res.contribution.statusDetail, /outcome is not known yet\. Nothing was credited/);
  assert.equal(progress(s), before);
  assert.equal(calls(s, 'getOrder').length, 1, 'it tried to read the order before answering');

  // PayPal is reachable again. The capture never happened there, so a retry captures it, with the SAME request id, once.
  s.controllers.orders.captureOrder = realCapture;
  s.controllers.orders.getOrder = realGet;
  const retry = await s.service.capturePayPalOrder({ providerOrderId: created.orderId, ...owner });
  assert.equal(retry.outcome, 'completed');
  assert.equal(progress(s) - before, 2000);
  const ids = calls(s, 'captureOrder').map((c) => c.args.paypalRequestId);
  assert.equal(new Set(ids).size, 1, `every capture attempt reused one PayPal-Request-Id: ${ids}`);
  assert.equal(ids[0], `capture-${created.contribution.id}`);
});

test('a refusal PayPal actually answered stays a plain failure, without an extra read', async () => {
  const s = setupDomain({ mode: 'sandbox', adapter: 'sdk', paypalOptions: { captureError: { status: 422, issue: 'PAYER_CANNOT_PAY' } } });
  const before = progress(s);
  const created = await s.service.createPayPalOrder(contribution({ amountCents: 1500 }));
  await assert.rejects(s.service.capturePayPalOrder({ providerOrderId: created.orderId, ...owner }), (e) => e.code === 'paypal_error' && e.issues.includes('PAYER_CANNOT_PAY'));
  assert.equal(calls(s, 'getOrder').length, 0);
  assert.equal(s.service.contributions(DEMO_GOAL_ID)[0].status, 'failed');
  assert.equal(progress(s), before);
});

test('a refund whose answer is lost says so; retrying resends the same request and reverses progress once', async () => {
  const s = setupDomain({ mode: 'sandbox', adapter: 'sdk' });
  const created = await s.service.createPayPalOrder(contribution({ amountCents: 1500 }));
  await s.service.capturePayPalOrder({ providerOrderId: created.orderId, ...owner });
  const credited = progress(s);
  const captureId = s.service.contributions(DEMO_GOAL_ID)[0].captures[0].captureId;
  const real = s.controllers.payments.refundCapturedPayment;
  s.controllers.payments.refundCapturedPayment = async (args) => { await real.call(s.controllers.payments, args); throw dropped(); }; // refunded; reply lost
  const refund = { captureId, householdId: DEMO_HOUSEHOLD_ID, approverId: 'm_rowan', approvalConfirmed: true };
  await assert.rejects(s.service.refundPayPalCapture(refund), (e) => e.code === 'paypal_unknown' && /may or may not have happened\. Progress was not changed here\. Check this capture in PayPal before trying again\./.test(e.message) && !/will not repeat/.test(e.message));
  assert.equal(progress(s), credited, 'nothing is recorded on an unknown outcome');
  s.controllers.payments.refundCapturedPayment = real;
  const settled = await s.service.refundPayPalCapture(refund);
  assert.equal(settled.outcome, 'refunded');
  assert.equal(progress(s), credited - 1500);
  const ids = calls(s, 'refundCapturedPayment').map((c) => c.args.paypalRequestId);
  assert.deepEqual(ids, [ids[0], ids[0]], 'the retry reused the first PayPal-Request-Id');
  assert.equal(s.fake.requests.filter((r) => r.pathname.endsWith('/refund')).length, 2);
});

test('timeout, then APPROVED with no capture, then another inconclusive check, then COMPLETED: one capture write, one credit', async () => {
  const s = setupDomain({ mode: 'sandbox', adapter: 'sdk' });
  const before = progress(s);
  const created = await s.service.createPayPalOrder(contribution({ amountCents: 1500 }));
  s.fake.orders.get(created.orderId).status = 'APPROVED'; // the buyer approved in PayPal
  const realCapture = s.controllers.orders.captureOrder;
  s.controllers.orders.captureOrder = async (args) => { s.controllers.sdkCalls.push({ name: 'captureOrder', args }); throw dropped(); }; // no answer
  let res = await s.service.capturePayPalOrder({ providerOrderId: created.orderId, ...owner });
  // The re-read succeeded but is inconclusive (APPROVED, no capture): still unresolved and recheckable, not "created".
  assert.deepEqual([res.outcome, res.contribution.status], ['unknown', 'pending']);
  assert.match(res.contribution.statusDetail, /outcome is not known yet/);
  res = await s.service.refreshPayPalOrder({ providerOrderId: created.orderId, ...owner }); // "Check with PayPal"
  assert.deepEqual([res.outcome, res.contribution.status], ['unknown', 'pending']);
  assert.equal(progress(s), before);
  // PayPal finishes the original capture on its side; the next check credits it once.
  const token = { Authorization: 'Bearer fake', 'Content-Type': 'application/json' };
  await s.fake.fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${created.orderId}/capture`, { method: 'POST', headers: token, body: '{}' });
  res = await s.service.refreshPayPalOrder({ providerOrderId: created.orderId, ...owner });
  assert.deepEqual([res.outcome, res.contribution.status], ['completed', 'completed']);
  res = await s.service.refreshPayPalOrder({ providerOrderId: created.orderId, ...owner });
  assert.equal(progress(s) - before, 1500, 'credited exactly once');
  assert.equal(calls(s, 'captureOrder').length, 1, 'our service sent exactly one capture write');
  s.controllers.orders.captureOrder = realCapture;
});

test('a verified webhook that settles the order during the uncertain read is never downgraded to pending', async () => {
  const s = setupDomain({ mode: 'sandbox', adapter: 'sdk' });
  const before = progress(s);
  const created = await s.service.createPayPalOrder(contribution({ amountCents: 1500 }));
  const { captureOrder: realCapture } = s.controllers.orders;
  s.controllers.orders.captureOrder = async (args) => { await realCapture.call(s.controllers.orders, args); throw dropped(); }; // captured; reply lost
  s.controllers.orders.getOrder = async () => {
    // While we wait, PayPal's verified webhook reports the completed capture; then our read fails.
    const capture = s.fake.orders.get(created.orderId).purchase_units[0].payments.captures[0];
    const event = { id: 'WH-EVT-RACE-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { ...capture, supplementary_data: { related_ids: { order_id: created.orderId } } } };
    const hook = await s.service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify(event) });
    assert.equal(hook.outcome, 'completed');
    throw dropped();
  };
  const res = await s.service.capturePayPalOrder({ providerOrderId: created.orderId, ...owner });
  assert.equal(res.outcome, 'already_completed');
  assert.equal(res.contribution.status, 'completed');
  assert.equal(s.service.contributions(DEMO_GOAL_ID)[0].status, 'completed');
  assert.equal(progress(s) - before, 1500, 'credited once, by the webhook');
});
