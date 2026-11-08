import test from 'node:test';
import assert from 'node:assert/strict';
import { getAchievements, progressFor } from '../../server/household.mjs';
import { contribution, setupDomain } from '../helpers/setup.mjs';
import { webhookHeaders } from '../helpers/fake-paypal.mjs';

// PayPal completed a pending capture and then refunded it. Its verified refund messages arrive first.
// All provider state and signatures here are fake; no app or external account is involved.
async function refundedBeforeCompletion(adapter, amounts, { earlyRefunds = true } = {}) {
  const env = setupDomain({ mode: 'sandbox', adapter });
  const owner = { householdId: env.householdId, goalId: env.goalId };
  const before = progressFor(env.db, env.goalId).progressCents;
  const achievements = getAchievements(env.db, env.goalId).filter((a) => a.key.startsWith('tier:'));
  const made = await env.service.createPayPalOrder(contribution());
  env.fake.behavior.captureStatus = 'PENDING';
  await env.service.capturePayPalOrder({ providerOrderId: made.orderId, ...owner });
  const completed = env.fake.completePendingCapture(made.orderId);
  const unit = env.fake.orders.get(made.orderId).purchase_units[0];
  const refunds = amounts.map((cents, i) => ({
    id: `REFUND-ORDERING-${i}`, status: 'COMPLETED',
    amount: { currency_code: 'USD', value: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}` },
    links: [{ rel: 'up', href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${completed.id}` }],
  }));
  unit.payments.refunds = refunds;
  unit.payments.captures[0].status = amounts.reduce((a, b) => a + b, 0) === 1500 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  const deliver = (id, type, resource, time) => env.service.handleWebhook({
    headers: webhookHeaders, rawBody: JSON.stringify({ id, event_type: type, create_time: time, resource }),
  });
  for (const [i, refund] of (earlyRefunds ? refunds : []).entries()) {
    assert.equal((await deliver(`WH-EARLY-REFUND-${i}`, 'PAYMENT.CAPTURE.REFUNDED', refund, '2026-11-03T13:02:00Z')).outcome, 'refund_not_credited');
  }
  const complete = (id = 'WH-LATE-COMPLETE') => deliver(id, 'PAYMENT.CAPTURE.COMPLETED',
    { ...completed, supplementary_data: { related_ids: { order_id: made.orderId } } }, '2026-11-03T13:01:00Z');
  return { ...env, owner, before, achievements, made, completed, refunds, deliver, complete };
}

for (const adapter of ['rest', 'sdk']) {
  for (const amounts of [[1500], [500], [500, 1000]]) {
    test(`[${adapter}] known ${amounts.join('+')} cent refunds survive a late completion without a false milestone`, async () => {
      const env = await refundedBeforeCompletion(adapter, amounts);
      try {
        const refunded = amounts.reduce((a, b) => a + b, 0);
        const result = await env.complete();
        assert.equal(progressFor(env.db, env.goalId).progressCents, env.before + 1500 - refunded,
          'already verified reversals count in the same transaction as the late credit');
        assert.equal(result.outcome, 'refunded');
        const receipt = env.service.contributions(env.goalId).find((c) => c.providerOrderId === env.made.orderId);
        assert.equal(receipt.status, refunded === 1500 ? 'refunded' : 'partially_refunded');
        assert.equal(receipt.captures[0].refundedCents, refunded);
        assert.deepEqual(getAchievements(env.db, env.goalId).filter((a) => a.key.startsWith('tier:')), env.achievements,
          'the transient gross credit must not raise the Manor');
        const checkCounts = () => {
          assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'contribution'").get().n, 1);
          assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'refund'").get().n, amounts.length);
          assert.equal(progressFor(env.db, env.goalId).progressCents, env.before + 1500 - refunded);
        };
        checkCounts();
        await env.complete(); // the same event
        await env.complete('WH-COMPLETE-REDELIVERED'); // the same capture under another event id
        for (const [i, refund] of env.refunds.entries()) {
          await env.deliver(`WH-EARLY-REFUND-${i}`, 'PAYMENT.CAPTURE.REFUNDED', refund, '2026-11-03T13:02:00Z');
          await env.deliver(`WH-REFUND-REDELIVERED-${i}`, 'PAYMENT.CAPTURE.REFUNDED', refund, '2026-11-03T13:02:00Z');
        }
        const refreshed = await env.service.refreshPayPalOrder({ providerOrderId: env.made.orderId, ...env.owner });
        assert.equal(refreshed.contribution.lastCheck.verdict, 'match');
        assert.equal((await env.service.capturePayPalOrder({ providerOrderId: env.made.orderId, ...env.owner })).outcome, 'already_completed');
        checkCounts();
        assert.equal(env.fake.requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/capture')).length, 1);
      } finally { env.db.close(); }
    });
  }

  test(`[${adapter}] an explicit first partial-refund snapshot recovers only its confirmed remainder`, async () => {
    const env = await refundedBeforeCompletion(adapter, [500], { earlyRefunds: false });
    try {
      const result = await env.service.refreshPayPalOrder({ providerOrderId: env.made.orderId, ...env.owner });
      assert.equal(progressFor(env.db, env.goalId).progressCents, env.before + 1000);
      assert.equal(result.contribution.status, 'partially_refunded');
      assert.equal(result.contribution.lastCheck.verdict, 'match');
      assert.deepEqual(getAchievements(env.db, env.goalId).filter((a) => a.key.startsWith('tier:')), env.achievements);
      await env.service.refreshPayPalOrder({ providerOrderId: env.made.orderId, ...env.owner });
      await env.complete();
      await env.deliver('WH-PARTIAL-LATE', 'PAYMENT.CAPTURE.REFUNDED', env.refunds[0], '2026-11-03T13:02:00Z');
      assert.equal(progressFor(env.db, env.goalId).progressCents, env.before + 1000);
      assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'contribution'").get().n, 1);
      assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'refund'").get().n, 1);
      assert.equal(env.fake.requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/capture')).length, 1);
    } finally { env.db.close(); }
  });

  test(`[${adapter}] a first partial-refund snapshot needs usable complete refund evidence`, async () => {
    for (const problem of ['missing', 'pending', 'currency', 'foreign', 'excess', 'mixed-invalid']) {
      const env = await refundedBeforeCompletion(adapter, [500], { earlyRefunds: false });
      try {
        const unit = env.fake.orders.get(env.made.orderId).purchase_units[0];
        if (problem === 'missing') unit.payments.refunds = [];
        if (problem === 'pending') unit.payments.refunds[0].status = 'PENDING';
        if (problem === 'currency') unit.payments.refunds[0].amount.currency_code = 'EUR';
        if (problem === 'foreign') unit.payments.refunds[0].links[0].href = 'https://api-m.sandbox.paypal.com/v2/payments/captures/OTHER-CAPTURE';
        if (problem === 'excess') unit.payments.refunds[0].amount.value = '15.01';
        if (problem === 'mixed-invalid') unit.payments.refunds.push({ ...structuredClone(env.refunds[0]), id: 'BAD-REFUND', amount: { currency_code: 'EUR', value: '1.00' } });
        await env.service.refreshPayPalOrder({ providerOrderId: env.made.orderId, ...env.owner });
        assert.equal(progressFor(env.db, env.goalId).progressCents, env.before, problem);
        assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'contribution'").get().n, 0, problem);
      } finally { env.db.close(); }
    }
  });

  test(`[${adapter}] credit and known refund roll back together if writing the reversal fails`, async () => {
    const env = await refundedBeforeCompletion(adapter, [500, 1000]);
    try {
      env.db.exec(`CREATE TEMP TRIGGER reject_test_refund BEFORE INSERT ON ledger_entries
        WHEN NEW.kind = 'refund' AND NEW.amount_cents = 1000 BEGIN SELECT RAISE(ABORT, 'test reversal write failed'); END;`);
      await assert.rejects(env.complete(), /test reversal write failed/);
      assert.equal(progressFor(env.db, env.goalId).progressCents, env.before);
      assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'contribution'").get().n, 0);
      assert.equal(env.db.prepare('SELECT credited FROM payment_captures WHERE capture_id = ?').get(env.completed.id).credited, 0);
      assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM payment_refunds WHERE credited = 1').get().n, 0);
      assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM webhook_events WHERE event_id = 'WH-LATE-COMPLETE'").get().n, 0);
      env.db.exec('DROP TRIGGER reject_test_refund');
      assert.equal((await env.complete()).outcome, 'refunded', 'the same event can recover after rollback');
      assert.equal(progressFor(env.db, env.goalId).progressCents, env.before);
      assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'refund'").get().n, 2);
      assert.deepEqual(getAchievements(env.db, env.goalId).filter((a) => a.key.startsWith('tier:')), env.achievements);
    } finally { env.db.close(); }
  });
}
