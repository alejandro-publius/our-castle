import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../server/db.mjs';
import { DEMO_GOAL_ID, DEMO_HOUSEHOLD_ID, createClock, progressFor } from '../../server/household.mjs';
import { createContributionService } from '../../server/payments/contributions.mjs';
import { createPayPalClient } from '../../server/payments/paypal-client.mjs';
import { contribution, FIXED_NOW, setupDomain } from '../helpers/setup.mjs';

// "Check with PayPal" remembers what it found. Fresh in-memory or temporary-file databases and the fake sandbox only;
// nothing here is evidence of a live PayPal read.
const owner = { householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID };
const progress = (db) => progressFor(db, DEMO_GOAL_ID).progressCents;
const checkRows = (db) => db.prepare('SELECT * FROM order_checks ORDER BY id').all();

async function captured(env, amountCents = 1500) {
  const { orderId } = await env.service.createPayPalOrder(contribution({ amountCents }));
  const res = await env.service.capturePayPalOrder({ providerOrderId: orderId, ...owner });
  return { orderId, res };
}

test('upgrading an existing schema-3 household preserves every application row and its completed receipt', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'our-castle-check-migration-'));
  const file = path.join(dir, 'household.sqlite');
  const env = setupDomain({ mode: 'sandbox', file });
  let db = env.db;
  t.after(() => { try { db.close(); } catch {} rmSync(dir, { recursive: true, force: true }); });
  await captured(env);
  const receipt = env.service.contributions(DEMO_GOAL_ID)[0];
  const rows = (database) => Object.fromEntries(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'order_checks' ORDER BY name").all()
    .map(({ name }) => [name, database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
  const before = rows(db);
  // Migrations 1–3 are unchanged. Remove the newer empty table and later columns to prepare the actual previous schema with saved data.
  db.exec('DROP TABLE order_checks; ALTER TABLE goals DROP COLUMN project_kind; ALTER TABLE goal_items DROP COLUMN selection_json; ALTER TABLE goal_items DROP COLUMN condition; PRAGMA user_version = 3;');
  db.close();
  db = openDatabase(file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 7);
  assert.deepEqual(rows(db), before);
  assert.deepEqual(checkRows(db), []);
  const service = createContributionService({ db, clock: env.clock, mode: 'sandbox', paypal: null });
  assert.deepEqual(service.contributions(DEMO_GOAL_ID)[0], receipt);
  assert.equal(progress(db), 7500);
});

test('an explicit check records a compact, reconciled result; repeated checks never credit again', async () => {
  const env = setupDomain({ mode: 'sandbox' });
  const { orderId, res } = await captured(env);
  const captureId = res.contribution.captures[0].captureId;
  assert.equal(res.contribution.lastCheck, null, 'a capture is not a check');

  const first = await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner });
  assert.equal(first.outcome, 'already_completed');
  assert.deepEqual(first.check, {
    checkedAt: env.clock.iso(), verdict: 'match', outcome: 'already_completed', note: 'PayPal and the ledger agree.',
    paypalOrderStatus: 'COMPLETED', captureId, captureStatus: 'COMPLETED', amountCents: 1500, currency: 'USD', refundIds: [],
  });
  assert.deepEqual(first.contribution.lastCheck, first.check);

  for (let i = 0; i < 11; i++) await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner });
  const view = env.service.contributions(DEMO_GOAL_ID)[0];
  assert.equal(view.checks.length, 10, 'history is capped');
  assert.deepEqual(view.lastCheck, view.checks[0]);
  assert.equal(progress(env.db), 7500, 'twelve checks, one credit');
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get().n, 2);
  assert.equal(env.fake.requests.filter((r) => /\/capture$/.test(r.pathname)).length, 1);

  // Only references and amounts are stored: no buyer, payload or model columns exist to fill.
  const columns = env.db.prepare('PRAGMA table_info(order_checks)').all().map((c) => c.name);
  assert.deepEqual(columns, ['id', 'order_id', 'checked_at', 'verdict', 'outcome', 'note', 'paypal_order_status', 'capture_id', 'capture_status', 'amount_cents', 'currency', 'refund_ids']);
});

test('the record survives closing and reopening the database, and reopening makes no PayPal call', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'our-castle-checks-')), 'household.sqlite');
  const env = setupDomain({ mode: 'sandbox', file });
  const { orderId } = await captured(env);
  await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner });
  const before = env.service.contributions(DEMO_GOAL_ID)[0];
  const calls = env.fake.requests.length;
  env.db.close();

  const db = openDatabase(file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 7);
  const reopened = createContributionService({ db, clock: createClock(FIXED_NOW), mode: 'sandbox', paypal: null, webhookId: 'WH-TEST' });
  const after = reopened.contributions(DEMO_GOAL_ID)[0];
  assert.deepEqual(after.lastCheck, before.lastCheck);
  assert.deepEqual(after.checks, before.checks);
  assert.equal(after.status, 'completed');
  assert.equal(progress(db), 7500);
  assert.equal(env.fake.requests.length, calls, 'reading the receipt never calls PayPal');
  db.close();
});

test('a check is scoped to the owning household and goal', async () => {
  const env = setupDomain({ mode: 'sandbox' });
  const { orderId } = await captured(env);
  const reads = () => env.fake.requests.filter((r) => r.method === 'GET' && r.pathname.endsWith(orderId)).length;
  await assert.rejects(env.service.refreshPayPalOrder({ providerOrderId: orderId, householdId: 'hh_someone_else', goalId: DEMO_GOAL_ID }), { code: 'order_mismatch' });
  await assert.rejects(env.service.refreshPayPalOrder({ providerOrderId: orderId, householdId: DEMO_HOUSEHOLD_ID, goalId: 'goal_other' }), { code: 'order_mismatch' });
  await assert.rejects(env.service.refreshPayPalOrder({ providerOrderId: 'ORDER00000099TEST', ...owner }), { code: 'unknown_order' });
  assert.equal(reads(), 0, 'PayPal was not asked');
  assert.deepEqual(checkRows(env.db), []);
  await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner });
  const [row] = checkRows(env.db);
  const order = env.db.prepare('SELECT household_id, goal_id FROM payment_orders WHERE id = ?').get(row.order_id);
  assert.deepEqual({ ...order }, { household_id: DEMO_HOUSEHOLD_ID, goal_id: DEMO_GOAL_ID });
});

test('mismatch, pending and refunded outcomes are remembered as what they are', async () => {
  // Mismatch: PayPal captured a different amount than this server asked for.
  const wrong = setupDomain({ mode: 'sandbox', paypalOptions: { captureAmountOverride: '50.00' } });
  const { orderId: wrongId, res: wrongRes } = await captured(wrong);
  assert.equal(wrongRes.outcome, 'rejected_mismatch');
  const mismatch = await wrong.service.refreshPayPalOrder({ providerOrderId: wrongId, ...owner });
  assert.equal(mismatch.check.verdict, 'differs');
  assert.equal(mismatch.check.amountCents, 5000, 'the amount PayPal actually reported');
  assert.match(mismatch.check.note, /disagree/);
  assert.equal(progress(wrong.db), 6000);

  // Pending: not counted yet, then completed and counted exactly once.
  const held = setupDomain({ mode: 'sandbox', paypalOptions: { captureStatus: 'PENDING' } });
  const { orderId: heldId } = await captured(held);
  const pending = await held.service.refreshPayPalOrder({ providerOrderId: heldId, ...owner });
  assert.equal(pending.outcome, 'pending');
  assert.deepEqual([pending.check.verdict, pending.check.captureStatus], ['match', 'PENDING']);
  assert.match(pending.check.note, /Pending in PayPal, and not counted yet/);
  assert.equal(progress(held.db), 6000);
  held.fake.completePendingCapture(heldId);
  const done = await held.service.refreshPayPalOrder({ providerOrderId: heldId, ...owner });
  assert.equal(done.outcome, 'completed');
  assert.deepEqual([done.check.verdict, done.check.captureStatus], ['match', 'COMPLETED']);
  assert.equal(progress(held.db), 7500);
  assert.equal(done.contribution.checks.length, 2);
  assert.equal(done.contribution.checks[1].captureStatus, 'PENDING', 'the earlier pending check stays in the history');

  // Refunded from the PayPal dashboard: the check names the refund it applied.
  const env = setupDomain({ mode: 'sandbox' });
  const { orderId, res } = await captured(env);
  const captureId = res.contribution.captures[0].captureId;
  const unit = env.fake.orders.get(orderId).purchase_units[0];
  unit.payments.captures[0].status = 'REFUNDED';
  unit.payments.refunds = [{ id: 'REFUNDDASH0001TEST', status: 'COMPLETED', amount: { currency_code: 'USD', value: '15.00' },
    links: [{ rel: 'up', href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}` }] }];
  const refunded = await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner });
  assert.equal(refunded.outcome, 'refunded');
  assert.deepEqual([refunded.check.verdict, refunded.check.captureStatus, refunded.check.refundIds], ['match', 'REFUNDED', ['REFUNDDASH0001TEST']]);
  assert.equal(progress(env.db), 6000);
});

test('when PayPal does not answer, the check is remembered as unavailable and nothing changes', async () => {
  const env = setupDomain({ mode: 'sandbox' });
  const { orderId } = await captured(env);
  let failing = false;
  const fetch = (url, init) => (failing && /\/v2\/checkout\/orders\/[^/]+$/.test(new URL(url).pathname)
    ? new Response(JSON.stringify({ name: 'INTERNAL_SERVICE_ERROR', debug_id: 'dbg-500' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    : env.fake.fetch(url, init));
  const paypal = createPayPalClient({ clientId: 'test-client-id', clientSecret: 'test-client-secret', fetch });
  const service = createContributionService({ db: env.db, clock: env.clock, mode: 'sandbox', paypal, webhookId: 'WH-TEST' });
  failing = true;
  await assert.rejects(service.refreshPayPalOrder({ providerOrderId: orderId, ...owner }), { code: 'paypal_error', debugId: 'dbg-500' });
  const view = service.contributions(DEMO_GOAL_ID)[0];
  assert.deepEqual([view.lastCheck.verdict, view.lastCheck.outcome, view.lastCheck.captureId, view.lastCheck.amountCents], ['unavailable', 'unavailable', null, null]);
  assert.match(view.lastCheck.note, /did not answer/);
  assert.equal(view.status, 'completed', 'a failed check does not touch the record');
  assert.equal(progress(env.db), 7500);
  failing = false;
  const ok = await service.refreshPayPalOrder({ providerOrderId: orderId, ...owner });
  assert.equal(ok.check.verdict, 'match');
  assert.equal(ok.contribution.checks[1].verdict, 'unavailable');
});
