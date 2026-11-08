import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../server/db.mjs';
import { createContributionService } from '../../server/payments/contributions.mjs';
import { getAchievements, progressFor } from '../../server/household.mjs';
import { contribution, setupDomain } from '../helpers/setup.mjs';
import { webhookHeaders } from '../helpers/fake-paypal.mjs';

// External completion is represented by the existing in-memory provider. The server approved the order but never
// learned its capture id, as when the capture answer and subsequent read are both lost. No actual network is used.
async function fixture(adapter, cents = 1500, initiallyPending = false) {
  const dir = mkdtempSync(path.join(tmpdir(), 'our-castle-unbound-'));
  const file = path.join(dir, 'app.sqlite');
  const env = setupDomain({ mode: 'sandbox', adapter, file });
  const ctx = { ...env, dir, file, owner: { householdId: env.householdId, goalId: env.goalId } };
  ctx.progress = () => progressFor(ctx.db, ctx.goalId).progressCents;
  ctx.close = () => { ctx.db.close(); rmSync(dir, { recursive: true, force: true }); };
  const made = await ctx.service.createPayPalOrder(contribution());
  const unit = ctx.fake.orders.get(made.orderId).purchase_units[0];
  if (initiallyPending) ctx.fake.behavior.captureStatus = 'PENDING';
  const answer = await ctx.fake.fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${made.orderId}/capture`, {
    method: 'POST', headers: { Authorization: 'Bearer fixture-only', 'Content-Type': 'application/json', 'PayPal-Request-Id': `capture-${unit.reference_id}` }, body: '{}',
  });
  assert.equal(answer.status, 201);
  const cap = unit.payments.captures[0];
  ctx.pending = { id: 'WH-PENDING', event_type: 'PAYMENT.CAPTURE.PENDING', resource: { ...structuredClone(cap), supplementary_data: { related_ids: { order_id: made.orderId } } } };
  if (initiallyPending) ctx.fake.completePendingCapture(made.orderId);
  ctx.complete = { id: 'WH-COMPLETE', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { ...structuredClone(cap), supplementary_data: { related_ids: { order_id: made.orderId } } } };
  const resource = { id: 'REFUND-BEFORE-CAPTURE', status: 'COMPLETED', amount: { currency_code: 'USD', value: (cents / 100).toFixed(2) }, links: [{ rel: 'up', href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${cap.id}` }] };
  ctx.refund = { id: 'WH-REFUND', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource };
  unit.payments.refunds = [structuredClone(resource)]; cap.status = cents === 1500 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  ctx.orderId = made.orderId; ctx.captureId = cap.id;
  ctx.deliver = (event) => ctx.service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify(event) });
  ctx.restart = () => {
    ctx.db.close(); const calls = ctx.fake.requests.length;
    ctx.db = openDatabase(file);
    ctx.service = createContributionService({ db: ctx.db, clock: ctx.clock, mode: 'sandbox', paypal: ctx.paypal, webhookId: 'WH-TEST' });
    assert.equal(ctx.fake.requests.length, calls, 'reopening dispatches nothing');
  };
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM payment_captures').get().n, 0);
  return ctx;
}

for (const adapter of ['rest', 'sdk']) {
  for (const cents of [500, 1500]) test(`[${adapter}] a verified refund before any capture survives reopening and applies with the late credit (${cents} cents)`, async () => {
    const ctx = await fixture(adapter, cents);
    try {
      await ctx.deliver(ctx.refund);
      assert.equal(ctx.progress(), 6000, 'an unattributed refund changes no household progress');
      assert.equal(JSON.stringify(ctx.service.contributions(ctx.goalId)).includes(ctx.refund.resource.id), false, 'unattributed evidence is private');
      await ctx.deliver(ctx.refund);
      await ctx.deliver({ ...ctx.refund, id: 'WH-REFUND-AGAIN' });
      ctx.restart();
      await ctx.deliver(ctx.complete);
      assert.equal(ctx.progress(), 7500 - cents, 'the earlier verified reversal is retained across restart');
      assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM deferred_refunds').get().n, 0);
      assert.equal(ctx.db.prepare('SELECT refunded_cents FROM payment_captures WHERE capture_id = ?').get(ctx.captureId).refunded_cents, cents);
      assert.equal(getAchievements(ctx.db, ctx.goalId).some((a) => a.key === 'tier:1'), false, 'no gross-credit Manor milestone');
      await ctx.deliver({ ...ctx.complete, id: 'WH-COMPLETE-AGAIN' });
      await ctx.deliver(ctx.refund);
      await ctx.deliver({ ...ctx.refund, id: 'WH-REFUND-AFTER' });
      const checked = await ctx.service.refreshPayPalOrder({ providerOrderId: ctx.orderId, ...ctx.owner });
      assert.equal(checked.contribution.lastCheck.verdict, 'match');
      assert.equal(ctx.progress(), 7500 - cents);
      assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'contribution'").get().n, 1);
      assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'refund'").get().n, 1);
    } finally { ctx.close(); }
  });

  test(`[${adapter}] a later pending observation binds the receipt without prematurely changing progress`, async () => {
    const ctx = await fixture(adapter, 1500, true);
    try {
      await ctx.deliver(ctx.refund);
      await ctx.deliver(ctx.pending);
      assert.equal(ctx.progress(), 6000);
      assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM deferred_refunds').get().n, 0);
      assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM payment_refunds WHERE credited = 0 AND status = 'COMPLETED'").get().n, 1);
      ctx.restart();
      await ctx.deliver(ctx.complete);
      assert.equal(ctx.progress(), 6000);
      assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'refund'").get().n, 1);
      assert.equal(getAchievements(ctx.db, ctx.goalId).some((a) => a.key === 'tier:1'), false);
    } finally { ctx.close(); }
  });

  test(`[${adapter}] an unverified refund is not retained or applied`, async () => {
    const ctx = await fixture(adapter, 500);
    try {
      ctx.fake.behavior.webhookVerification = 'FAILURE';
      await assert.rejects(ctx.deliver(ctx.refund), { code: 'invalid_signature' });
      ctx.fake.behavior.webhookVerification = 'SUCCESS';
      await ctx.deliver(ctx.complete);
      assert.equal(ctx.progress(), 7500, 'the unverified payload cannot reverse a confirmed capture');
      assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM deferred_refunds').get().n, 0);
      assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM payment_refunds').get().n, 0);
    } finally { ctx.close(); }
  });

  test(`[${adapter}] a completion naming an unknown order cannot consume deferred evidence`, async () => {
    const ctx = await fixture(adapter);
    try {
      await ctx.deliver(ctx.refund);
      const forged = structuredClone(ctx.complete); forged.id = 'WH-WRONG-ORDER'; forged.resource.supplementary_data.related_ids.order_id = 'ORDER-UNKNOWN';
      assert.equal((await ctx.deliver(forged)).outcome, 'ignored_unknown_order');
      assert.equal(ctx.progress(), 6000);
      await ctx.deliver(ctx.complete);
      assert.equal(ctx.progress(), 6000);
      assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM deferred_refunds').get().n, 0);
    } finally { ctx.close(); }
  });

  test(`[${adapter}] a failed reversal rolls back credit and preserves the deferred receipt for retry`, async () => {
    const ctx = await fixture(adapter);
    try {
      await ctx.deliver(ctx.refund);
      ctx.db.exec("CREATE TEMP TRIGGER fail_deferred BEFORE INSERT ON ledger_entries WHEN NEW.kind = 'refund' BEGIN SELECT RAISE(ABORT, 'deferred test failure'); END");
      await assert.rejects(ctx.deliver(ctx.complete), /deferred test failure/);
      assert.equal(ctx.progress(), 6000);
      assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM payment_captures').get().n, 0);
      assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM deferred_refunds').get().n, 1);
      ctx.db.exec('DROP TRIGGER fail_deferred');
      await ctx.deliver(ctx.complete);
      assert.equal(ctx.progress(), 6000);
      assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM deferred_refunds').get().n, 0);
      assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'refund'").get().n, 1);
    } finally { ctx.close(); }
  });
}
