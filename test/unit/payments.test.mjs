import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_GOAL_ID, DEMO_HOUSEHOLD_ID, getAchievements, progressFor } from '../../server/household.mjs';
import { openDatabase } from '../../server/db.mjs';
import { contribution, setupDomain } from '../helpers/setup.mjs';
import { webhookHeaders } from '../helpers/fake-paypal.mjs';

// Every payment-safety test runs against both PayPal adapters: the small REST client and the
// official Server SDK adapter (the SDK one is driven through stand-in controllers).
for (const adapter of ['rest', 'sdk']) {
  async function approvedOrder(env, overrides = {}) {
    const created = await env.service.createPayPalOrder(contribution(overrides));
    return created.orderId;
  }
  const capture = (env, orderId, ids = {}) => env.service.capturePayPalOrder({ providerOrderId: orderId, householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, ...ids });

  test(`[${adapter}] server creates the sandbox order with its own amount, currency and contribution id`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const orderId = await approvedOrder(env, { amountCents: 1500 });
    const create = env.fake.requests.find((r) => r.pathname === '/v2/checkout/orders');
    assert.equal(create.body.intent, 'CAPTURE');
    assert.deepEqual(create.body.purchase_units[0].amount, { currency_code: 'USD', value: '15.00' });
    const row = env.db.prepare('SELECT * FROM payment_orders WHERE provider_order_id = ?').get(orderId);
    assert.equal(create.body.purchase_units[0].custom_id, row.id);
    assert.equal(create.headers['paypal-request-id'], `create-${row.id}`);
    assert.equal(row.status, 'created');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000, 'creating an order credits nothing');
    const again = await env.service.createPayPalOrder(contribution({ amountCents: 2000 }));
    assert.match(again.approveUrl, /^https:\/\/www\.sandbox\.paypal\.com\/checkoutnow\?token=/);
  });

  test(`[${adapter}] a completed capture credits progress once, moves to the Manor and survives replay`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const orderId = await approvedOrder(env);
    const first = await capture(env, orderId);
    assert.equal(first.outcome, 'completed');
    assert.deepEqual(first.awarded, [1]);
    assert.equal(first.progress.progressCents, 7500);
    const captureCall = env.fake.requests.find((r) => r.pathname.endsWith('/capture'));
    assert.match(captureCall.headers['paypal-request-id'], /^capture-ctb_/);

    const replay = await capture(env, orderId);
    assert.equal(replay.outcome, 'already_completed');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 7500, 'replaying the capture does not double-credit');
    assert.equal(env.fake.requests.filter((r) => r.pathname.endsWith('/capture')).length, 1, 'no second PayPal capture call after settlement');
    assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'contribution'").get().n, 1);
  });

  test(`[${adapter}] concurrent capture requests for one order coalesce into a single credit`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const orderId = await approvedOrder(env);
    const results = await Promise.all([capture(env, orderId), capture(env, orderId), capture(env, orderId)]);
    assert.ok(results.every((r) => ['completed', 'already_completed'].includes(r.outcome)));
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 7500);
  });

  test(`[${adapter}] a retried capture after a lost local status write reconciles with PayPal without double credit`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const orderId = await approvedOrder(env);
    await capture(env, orderId);
    // Simulate a lost local write: the order row still looks uncaptured locally.
    env.db.prepare("UPDATE payment_orders SET status = 'created' WHERE provider_order_id = ?").run(orderId);
    const again = await env.service.capturePayPalOrder({ providerOrderId: orderId, householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID });
    assert.equal(again.outcome, 'already_completed');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 7500);
  });

  test(`[${adapter}] a capture whose amount, currency or custom id differs from the server record is rejected`, async () => {
    for (const [option, value] of [['captureAmountOverride', '150.00'], ['captureCurrencyOverride', 'EUR'], ['captureCustomIdOverride', 'ctb_someone_else']]) {
      const env = setupDomain({ adapter, mode: 'sandbox', paypalOptions: { [option]: value } });
      const orderId = await approvedOrder(env);
      const result = await capture(env, orderId);
      assert.equal(result.outcome, 'rejected_mismatch', option);
      assert.equal(result.contribution.status, 'rejected');
      assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000, `${option}: no progress`);
      assert.equal(getAchievements(env.db, DEMO_GOAL_ID).length, 0);
    }
  });

  test(`[${adapter}] a capture request naming a different household or goal is refused before PayPal is called`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const orderId = await approvedOrder(env);
    await assert.rejects(capture(env, orderId, { householdId: 'hh_other' }), { code: 'order_mismatch' });
    await assert.rejects(capture(env, orderId, { goalId: 'goal_other' }), { code: 'order_mismatch' });
    await assert.rejects(capture(env, 'ORDER-NOT-OURS'), { code: 'unknown_order' });
    assert.equal(env.fake.requests.filter((r) => r.pathname.endsWith('/capture')).length, 0);
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000);
  });

  test(`[${adapter}] pending captures credit nothing until PayPal reports completion via a verified webhook (once)`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox', paypalOptions: { captureStatus: 'PENDING' } });
    const orderId = await approvedOrder(env);
    const pending = await capture(env, orderId);
    assert.equal(pending.outcome, 'pending');
    assert.equal(pending.progress.progressCents, 6000);

    const completed = env.fake.completePendingCapture(orderId);
    const event = { id: 'WH-EVT-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { ...completed, supplementary_data: { related_ids: { order_id: orderId } } } };
    const delivered = await env.service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify(event) });
    assert.equal(delivered.outcome, 'completed');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 7500);

    const redelivered = await env.service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify(event) });
    assert.equal(redelivered.outcome, 'duplicate_event');
    const differentEventSameCapture = await env.service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify({ ...event, id: 'WH-EVT-2' }) });
    assert.equal(differentEventSameCapture.outcome, 'already_completed');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 7500, 'still credited exactly once');
  });

  test(`[${adapter}] declined instruments and canceled approvals leave progress unchanged`, async () => {
    const declined = setupDomain({ adapter, mode: 'sandbox', paypalOptions: { captureError: { status: 422, issue: 'INSTRUMENT_DECLINED' } } });
    const orderId = await approvedOrder(declined);
    const result = await capture(declined, orderId);
    assert.equal(result.outcome, 'declined');
    assert.equal(progressFor(declined.db, DEMO_GOAL_ID).progressCents, 6000);

    const canceled = setupDomain({ adapter, mode: 'sandbox' });
    const orderId2 = await approvedOrder(canceled);
    const c = canceled.service.cancelPayPalOrder({ providerOrderId: orderId2, householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID });
    assert.equal(c.contribution.status, 'approval_canceled');
    assert.equal(progressFor(canceled.db, DEMO_GOAL_ID).progressCents, 6000);

    const failing = setupDomain({ adapter, mode: 'sandbox', paypalOptions: { captureError: { status: 500, issue: 'INTERNAL_SERVER_ERROR' } } });
    const orderId3 = await approvedOrder(failing);
    await assert.rejects(capture(failing, orderId3), { code: 'paypal_error' });
    assert.equal(progressFor(failing.db, DEMO_GOAL_ID).progressCents, 6000);
  });

  test(`[${adapter}] webhooks are ignored unless PayPal verifies the signature, and refused if no webhook id is configured`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox', paypalOptions: { webhookVerification: 'FAILURE' } });
    const event = { id: 'WH-EVT-X', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP', status: 'COMPLETED', amount: { currency_code: 'USD', value: '15.00' } } };
    await assert.rejects(env.service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify(event) }), { code: 'invalid_signature' });
    await assert.rejects(env.service.handleWebhook({ headers: {}, rawBody: JSON.stringify(event) }), { code: 'invalid_signature' });

    const unconfigured = setupDomain({ adapter, mode: 'sandbox', webhookId: null });
    await assert.rejects(unconfigured.service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify(event) }), { code: 'webhooks_not_configured' });
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000);
  });

  test(`[${adapter}] a sandbox refund reverses exactly the credited amount once; the built Manor stays as a keepsake`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const orderId = await approvedOrder(env);
    const captured = await capture(env, orderId);
    const captureId = captured.contribution.captures[0].captureId;

    const refunded = await env.service.refundPayPalCapture({ captureId, householdId: DEMO_HOUSEHOLD_ID, approverId: 'm_rowan', approvalConfirmed: true });
    assert.equal(refunded.outcome, 'refunded');
    assert.equal(refunded.progress.progressCents, 6000);
    assert.equal(refunded.contribution.status, 'refunded');
    assert.ok(getAchievements(env.db, DEMO_GOAL_ID).some((a) => a.key === 'tier:1'), 'achievement commemorates the milestone');

    await assert.rejects(env.service.refundPayPalCapture({ captureId, householdId: DEMO_HOUSEHOLD_ID, approverId: 'm_rowan', approvalConfirmed: true }), { code: 'already_refunded' });

    // The same refund then arrives as a verified webhook: it must not subtract again.
    const refundRow = env.db.prepare('SELECT * FROM payment_refunds').get();
    const event = {
      id: 'WH-REFUND-1', event_type: 'PAYMENT.CAPTURE.REFUNDED',
      resource: { id: refundRow.refund_id, status: 'COMPLETED', amount: { currency_code: 'USD', value: '15.00' }, links: [{ rel: 'up', href: `https://api.sandbox.paypal.com/v2/payments/captures/${captureId}` }] },
    };
    const webhook = await env.service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify(event) });
    assert.equal(webhook.outcome, 'duplicate_refund');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000);
  });

  test(`[${adapter}] a refund initiated in the PayPal dashboard arrives by webhook and is applied once`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const orderId = await approvedOrder(env, { amountCents: 3000 });
    const captured = await capture(env, orderId);
    const captureId = captured.contribution.captures[0].captureId;
    const event = {
      id: 'WH-REFUND-DASH', event_type: 'PAYMENT.CAPTURE.REFUNDED',
      resource: { id: 'REFUND-PARTIAL-1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '10.00' }, links: [{ rel: 'up', href: `https://api.sandbox.paypal.com/v2/payments/captures/${captureId}` }] },
    };
    assert.equal((await env.service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify(event) })).outcome, 'refunded');
    assert.equal((await env.service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify({ ...event, id: 'WH-REFUND-DASH-RETRY' }) })).outcome, 'duplicate_refund');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000 + 3000 - 1000);
    assert.equal(env.db.prepare('SELECT status FROM payment_orders').get().status, 'partially_refunded');
  });

  test(`[${adapter}] only adults with explicit approval can create orders, within limits and never past the goal`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    await assert.rejects(env.service.createPayPalOrder(contribution({ approverId: 'm_wren' })), { code: 'adult_approval_required' });
    await assert.rejects(env.service.createPayPalOrder(contribution({ approvalConfirmed: false })), { code: 'approval_required' });
    await assert.rejects(env.service.createPayPalOrder(contribution({ amountCents: 99 })), { code: 'invalid_amount' });
    await assert.rejects(env.service.createPayPalOrder(contribution({ amountCents: 15.5 })), { code: 'invalid_amount' });
    await assert.rejects(env.service.createPayPalOrder(contribution({ amountCents: 24001 })), { code: 'over_goal' });
    await assert.rejects(env.service.createPayPalOrder(contribution({ householdId: 'hh_other' })), { code: 'not_found' });
    assert.equal(env.fake.requests.filter((r) => r.pathname === '/v2/checkout/orders').length, 0);
  });

  test(`[${adapter}] reusing a request id returns the same order; reusing it for different details is refused`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const input = contribution();
    const a = await env.service.createPayPalOrder(input);
    const b = await env.service.createPayPalOrder(input);
    assert.equal(a.orderId, b.orderId);
    await assert.rejects(env.service.createPayPalOrder({ ...input, amountCents: 2000 }), { code: 'request_conflict' });
  });

  test(`[${adapter}] the OAuth token is cached between calls and only the sandbox host is ever contacted`, { skip: adapter === 'sdk' && 'the SDK manages its own OAuth token' }, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const o1 = await approvedOrder(env);
    await capture(env, o1);
    await approvedOrder(env);
    assert.equal(env.fake.tokenCalls, 1);
    assert.ok(env.fake.requests.every((r) => r.headers.authorization));
  });

  test(`[${adapter}] example mode and sandbox mode cannot cross over`, async () => {
    const example = setupDomain({ mode: 'example' });
    await assert.rejects(example.service.createPayPalOrder(contribution()), { code: 'wrong_mode' });
    const sandbox = setupDomain({ adapter, mode: 'sandbox' });
    assert.throws(() => sandbox.service.simulateContribution(contribution()), { code: 'wrong_mode' });
  });

  test('example mode labels simulated entries separately and handles pending, cancel, failure and refund', () => {
    const env = setupDomain({ mode: 'example' });
    const canceled = env.service.simulateContribution(contribution({ outcome: 'canceled' }));
    const failed = env.service.simulateContribution(contribution({ outcome: 'failed' }));
    const pending = env.service.simulateContribution(contribution({ outcome: 'pending' }));
    assert.deepEqual([canceled.outcome, failed.outcome, pending.outcome], ['canceled', 'declined', 'pending']);
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000);

    const done = env.service.completeSimulatedPending({ contributionId: pending.contribution.id, householdId: DEMO_HOUSEHOLD_ID });
    assert.equal(done.outcome, 'completed');
    assert.equal(done.contribution.simulated, true);
    const p = progressFor(env.db, DEMO_GOAL_ID);
    assert.equal(p.simulatedContributedCents, 1500);
    assert.equal(p.contributedCents, 0, 'simulated money is never reported as a PayPal contribution');

    const refund = env.service.simulateRefund({ captureId: done.contribution.captures[0].captureId, householdId: DEMO_HOUSEHOLD_ID, approverId: 'm_rowan', approvalConfirmed: true });
    assert.equal(refund.outcome, 'refunded');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000);
    assert.ok(env.db.prepare("SELECT 1 FROM ledger_entries WHERE kind = 'simulated_refund'").get());
  });

  test(`[${adapter}] captured progress persists through a restart of the sandbox database`, async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dir = mkdtempSync(path.join(tmpdir(), 'our-house-sbx-'));
    try {
      const env = setupDomain({ adapter, mode: 'sandbox', file: path.join(dir, 'sandbox.sqlite') });
      const orderId = await approvedOrder(env);
      await capture(env, orderId);
      env.db.close();
      const reopened = openDatabase(path.join(dir, 'sandbox.sqlite'));
      assert.equal(progressFor(reopened, DEMO_GOAL_ID).progressCents, 7500);
      assert.equal(reopened.prepare('SELECT credited FROM payment_captures').get().credited, 1);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

}