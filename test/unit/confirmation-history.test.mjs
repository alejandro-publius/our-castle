import test from 'node:test';
import assert from 'node:assert/strict';
import { createSteward } from '../../server/steward/index.mjs';
import { PayPalError } from '../../server/payments/paypal-client.mjs';
import { contribution, setupDomain } from '../helpers/setup.mjs';

const question = 'When was our last contribution confirmed?';
const owner = env => ({ householdId: env.householdId, goalId: env.goalId });
const rows = db => JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
async function captured(env) {
  const { orderId } = await env.service.createPayPalOrder(contribution());
  await env.service.capturePayPalOrder({ providerOrderId: orderId, ...owner(env) });
  return orderId;
}
function localSteward(env, { configured = false } = {}) {
  const calls = [];
  const forbidden = name => async () => { calls.push(name); throw new Error('Unexpected provider call: ' + name); };
  const steward = createSteward({ db: env.db, contributions: env.service, householdId: env.householdId, clock: env.clock,
    ai: configured ? { apiKey: 'fake-unused-key', model: 'claude-opus-5-5' } : null,
    paypalTools: { getOrder: forbidden('get_order'), listTransactions: forbidden('list_transactions') },
    fetch: async () => { calls.push('model'); return new Response('{}', { status: 401 }); } });
  return { steward, calls };
}

test('saved completed checks answer locally with no key, no provider call, no write and no fresh-verification claim', async () => {
  const env = setupDomain({ mode: 'sandbox' });
  const orderId = await captured(env);
  await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner(env) });
  const before = rows(env.db), providerReads = env.fake.requests.length;
  const { steward, calls } = localSteward(env);
  const res = await steward.ask({ question, memberId: 'm_wren', focusOrderId: orderId });
  assert.equal(steward.available, false);
  assert.equal(steward.localHistoryAvailable, true);
  assert.equal(res.status, 'ok');
  assert.equal(res.source, 'local-records');
  assert.equal(res.recordedConfirmation.checkedAt, env.clock.iso());
  assert.equal(res.recordedConfirmation.orderId, orderId);
  assert.match(res.answer, /saved check confirmed.*UTC/i);
  assert.match(res.answer, /No new PayPal check was made/);
  assert.equal(res.verification, null);
  assert.equal(res.model, null);
  assert.equal(res.paypalTools, false);
  assert.deepEqual(res.checks.map(c => c.tool), ['read_household_ledger']);
  assert.deepEqual(calls, []);
  assert.equal(env.fake.requests.length, providerReads);
  assert.equal(rows(env.db), before);
});

test('a recorded capture without saved checks never invents a last-confirmed timestamp, even with AI configured', async () => {
  const env = setupDomain({ mode: 'sandbox' });
  const orderId = await captured(env);
  const { steward, calls } = localSteward(env, { configured: true });
  const before = rows(env.db);
  const res = await steward.ask({ question: 'When was this contribution confirmed?', memberId: 'm_rowan', focusOrderId: orderId });
  assert.equal(res.recordedConfirmation.checkedAt, null);
  assert.equal(res.recordedConfirmation.latestCheckAt, null);
  assert.match(res.answer, /No completed-payment confirmation time is saved/);
  assert.match(res.answer, /ledger currently records it as completed/);
  assert.deepEqual(calls, []);
  assert.equal(rows(env.db), before);
});

test('a pending match is not a completed-payment confirmation', async () => {
  const env = setupDomain({ mode: 'sandbox', paypalOptions: { captureStatus: 'PENDING' } });
  const orderId = await captured(env);
  await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner(env) });
  const { steward, calls } = localSteward(env);
  const res = await steward.ask({ question, memberId: 'm_rowan', focusOrderId: orderId });
  assert.equal(res.recordedConfirmation.latestVerdict, 'match');
  assert.equal(res.recordedConfirmation.checkedAt, null);
  assert.match(res.answer, /pending/);
  assert.doesNotMatch(res.answer, /saved check confirmed/i);
  assert.equal(res.verification, null);
  assert.deepEqual(calls, []);
});

test('an older confirmation stays historical when the newest check failed', async () => {
  const env = setupDomain({ mode: 'sandbox' });
  const orderId = await captured(env);
  await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner(env) });
  const confirmedAt = env.clock.iso();
  env.clock.now = () => new Date('2026-11-03T12:05:00Z');
  env.paypal.getOrder = async () => { throw new PayPalError('Offline fixture', { status: 500 }); };
  await assert.rejects(env.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner(env) }), { code: 'paypal_error' });
  const before = rows(env.db), { steward, calls } = localSteward(env, { configured: true });
  const res = await steward.ask({ question, memberId: 'm_rowan', focusOrderId: orderId });
  assert.equal(res.recordedConfirmation.checkedAt, confirmedAt);
  assert.equal(res.recordedConfirmation.latestCheckAt, env.clock.iso());
  assert.equal(res.recordedConfirmation.latestVerdict, 'unavailable');
  assert.match(res.answer, /latest saved check.*unavailable/i);
  assert.equal(res.verification, null);
  assert.deepEqual(calls, []);
  assert.equal(rows(env.db), before);
});

test('a refunded contribution is described as refunded alongside its earlier confirmation', async () => {
  const env = setupDomain({ mode: 'sandbox' });
  const orderId = await captured(env);
  await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner(env) });
  const unit = env.fake.orders.get(orderId).purchase_units[0], cap = unit.payments.captures[0];
  cap.status = 'REFUNDED';
  unit.payments.refunds = [{ id: 'HISTORYREFUND001', status: 'COMPLETED', amount: { value: '15.00', currency_code: 'USD' },
    links: [{ rel: 'up', href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${cap.id}` }] }];
  await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner(env) });
  const before = rows(env.db), { steward, calls } = localSteward(env);
  const res = await steward.ask({ question, memberId: 'm_rowan', focusOrderId: orderId });
  assert.ok(res.recordedConfirmation.checkedAt);
  assert.equal(res.recordedConfirmation.ledgerStatus, 'refunded');
  assert.match(res.answer, /currently records it as refunded/);
  assert.match(res.answer, /latest saved check.*refunded/i);
  assert.equal(res.verification, null);
  assert.deepEqual(calls, []);
  assert.equal(rows(env.db), before);
});

test('newest-order selection, foreign-order/member refusal and simulated records retain their boundaries', async () => {
  const env = setupDomain({ mode: 'sandbox' });
  const first = await captured(env);
  await env.service.refreshPayPalOrder({ providerOrderId: first, ...owner(env) });
  env.clock.now = () => new Date('2026-11-03T12:10:00Z');
  const { orderId: next } = await env.service.createPayPalOrder(contribution());
  const { steward, calls } = localSteward(env);
  const res = await steward.ask({ question, memberId: 'm_rowan' });
  assert.equal(res.recordedConfirmation.orderId, next);
  assert.equal(res.recordedConfirmation.checkedAt, null, 'do not substitute an older order’s confirmation');
  await assert.rejects(steward.ask({ question, memberId: 'm_rowan', focusOrderId: 'FOREIGN-ORDER' }), { code: 'order_not_found' });
  await assert.rejects(steward.ask({ question, memberId: 'foreign-member' }), { code: 'invalid_member' });
  assert.deepEqual(calls, []);

  const example = setupDomain({ mode: 'example' });
  example.service.simulateContribution({ ...contribution(), outcome: 'completed' });
  const local = localSteward(example), before = rows(example.db);
  const simulated = await local.steward.ask({ question, memberId: 'm_rowan' });
  assert.equal(simulated.recordedConfirmation, null);
  assert.match(simulated.answer, /simulated/);
  assert.equal(rows(example.db), before);
  assert.deepEqual(local.calls, []);
});
