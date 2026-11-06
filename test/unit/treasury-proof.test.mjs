import test from 'node:test';
import assert from 'node:assert/strict';
import { createSteward } from '../../server/steward/index.mjs';
import { createPayPalReadTools } from '../../server/steward/paypal-tools.mjs';
import { PAYPAL_READ_TOOLS, READ_ONLY_QUESTION, isReadOnlyQuestion } from '../../src/core/steward-policy.js';
import { isLocalQuestion } from '../../src/core/steward-questions.js';
import { savedCheckSummary } from '../../src/core/check-status.js';
import { setupDomain } from '../helpers/setup.mjs';

const snapshot = db => JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));

for (const configured of [false, true]) test(`the explicit permissions question refuses locally with ${configured ? 'configured' : 'no'} model credentials`, async t => {
  const env = setupDomain({ mode: 'sandbox' }); t.after(() => env.db.close());
  const calls = [];
  const forbidden = name => async () => { calls.push(name); throw new Error('Unexpected call: ' + name); };
  const steward = createSteward({ db: env.db, contributions: env.service, householdId: env.householdId, clock: env.clock,
    ai: configured ? { apiKey: 'fake-unused-key', model: 'fixture-model' } : null,
    fetch: forbidden('model'), paypalTools: { getOrder: forbidden('get_order'), listTransactions: forbidden('list_transactions') } });
  const before = snapshot(env.db);
  const answer = await steward.ask({ question: READ_ONLY_QUESTION, memberId: 'm_wren' });
  assert.equal(answer.source, 'local-policy'); assert.equal(answer.kind, 'read-only-boundary');
  assert.match(answer.answer, /can’t make a payment or refund/);
  assert.deepEqual(answer.policy, { paypalReadTools: ['get_order', 'list_transactions'], canMoveMoney: false });
  assert.deepEqual(answer.checks, []); assert.equal(answer.verification, null); assert.equal(answer.model, null);
  assert.deepEqual(calls, []); assert.equal(snapshot(env.db), before);
  await assert.rejects(steward.ask({ question: READ_ONLY_QUESTION, memberId: 'foreign-member' }), { code: 'invalid_member' });
  await assert.rejects(steward.ask({ question: READ_ONLY_QUESTION, memberId: 'm_rowan', focusOrderId: 'FOREIGN-ORDER' }), { code: 'order_not_found' });
  assert.deepEqual(calls, []); assert.equal(snapshot(env.db), before);
});

test('the displayed PayPal allow-list is enforced by the runtime wrapper', () => {
  const toolkit = names => ({ client: { getBaseUrl: () => 'https://api.sandbox.paypal.com' },
    getTools: () => names.map(name => ({ function: { name } })), handleToolCall: async () => { throw new Error('No tool should run'); } });
  const tools = createPayPalReadTools({ toolkit: toolkit([...PAYPAL_READ_TOOLS]) });
  assert.deepEqual(tools.tools, [...PAYPAL_READ_TOOLS]);
  for (const write of ['pay_order', 'create_order', 'create_refund'])
    assert.throws(() => createPayPalReadTools({ toolkit: toolkit([...PAYPAL_READ_TOOLS, write]) }), /not read-only/);
  assert.equal(Object.isFrozen(PAYPAL_READ_TOOLS), true);
});

test('only explicit policy questions use the local refusal; historical refund questions still use the normal reader', () => {
  assert.equal(isReadOnlyQuestion('  CAN you make a payment or refund for me?! '), true);
  assert.equal(isLocalQuestion(READ_ONLY_QUESTION), true);
  assert.equal(isReadOnlyQuestion('Did PayPal refund our last contribution?'), false);
  assert.equal(isLocalQuestion('Did PayPal refund our last contribution?'), false);
  assert.equal(isReadOnlyQuestion(null), false);
});

test('a saved summary names pending, failed, unpaid and older checks without calling them a completed match', () => {
  const c = { id: 'fixture-contribution', simulated: false, providerOrderId: 'FIXTUREORDER', status: 'completed', captures: [],
    lastCheck: { verdict: 'match', captureStatus: 'COMPLETED', checkedAt: '2026-11-03T12:00:00Z' } };
  assert.equal(savedCheckSummary(c).label, 'Match');
  assert.equal(savedCheckSummary({ ...c, status: 'pending', lastCheck: { ...c.lastCheck, captureStatus: 'PENDING' } }).label, 'Pending');
  assert.equal(savedCheckSummary({ ...c, status: 'created', lastCheck: { ...c.lastCheck, captureStatus: null } }).label, 'Not paid');
  const failed = savedCheckSummary({ ...c, lastCheck: { verdict: 'unavailable', checkedAt: '2026-11-04T12:00:00Z' } });
  assert.equal(failed.label, 'Needs check'); assert.equal(failed.checkedAt, '2026-11-04T12:00:00Z');
  assert.equal(savedCheckSummary({ ...c, status: 'refunded' }).label, 'Checked before refund');
  assert.equal(savedCheckSummary({ ...c, status: 'refunded', lastCheck: { ...c.lastCheck, captureStatus: 'REFUNDED' } }).label, 'Refunded');
  assert.equal(savedCheckSummary({ ...c, simulated: true }), null);
  assert.equal(savedCheckSummary({ ...c, lastCheck: null }), null);
});
