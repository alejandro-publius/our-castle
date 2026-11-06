import test from 'node:test';
import assert from 'node:assert/strict';
import { createSteward } from '../../server/steward/index.mjs';
import { createContributionService } from '../../server/payments/contributions.mjs';
import { createPayPalClient } from '../../server/payments/paypal-client.mjs';
import { NEEDS_CHECK_QUESTION, isNeedsCheckQuestion, isLocalQuestion } from '../../src/core/steward-questions.js';
import { contribution, setupDomain } from '../helpers/setup.mjs';

// "Any contributions that need a PayPal check?" is answered from this household's saved records through the existing
// steward request: no model call, no PayPal lookup, no write, and no claim of fresh verification. Fake sandbox only.
const owner = (env) => ({ householdId: env.householdId, goalId: env.goalId });
const rows = (db) => JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));

function localSteward(env, { configured = false, service = env.service } = {}) {
  const calls = [];
  const forbidden = (name) => async () => { calls.push(name); throw new Error(`Unexpected provider call: ${name}`); };
  const steward = createSteward({ db: env.db, contributions: service, householdId: env.householdId, clock: env.clock,
    ai: configured ? { apiKey: 'fake-unused-key', model: 'claude-opus-5-5' } : null,
    paypalTools: { getOrder: forbidden('get_order'), listTransactions: forbidden('list_transactions') },
    fetch: async () => { calls.push('model'); return new Response('{}', { status: 401 }); } });
  return { steward, calls };
}

/** A service over the same fake sandbox whose order reads fail while `failing.on` is true. */
function flakyService(env) {
  const failing = { on: false };
  const fetch = (url, init) => (failing.on && /\/v2\/checkout\/orders\/[^/]+$/.test(new URL(url).pathname)
    ? new Response(JSON.stringify({ name: 'INTERNAL_SERVICE_ERROR', debug_id: 'dbg-500' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    : env.fake.fetch(url, init));
  const paypal = createPayPalClient({ clientId: 'test-client-id', clientSecret: 'test-client-secret', fetch });
  return { failing, service: createContributionService({ db: env.db, clock: env.clock, mode: 'sandbox', paypal, webhookId: 'WH-TEST' }) };
}

async function captured(env, service, amountCents) {
  const { orderId } = await service.createPayPalOrder(contribution({ amountCents }));
  const res = await service.capturePayPalOrder({ providerOrderId: orderId, ...owner(env) });
  return { orderId, contributionId: res.contribution.id };
}

test('the question is recognised in a few plain forms and nothing else', () => {
  for (const q of [NEEDS_CHECK_QUESTION, 'any contributions that need a paypal check', 'Which contributions need a PayPal check?', 'Does anything need a PayPal check?!']) {
    assert.equal(isNeedsCheckQuestion(q), true, q);
    assert.equal(isLocalQuestion(q), true, q);
  }
  for (const q of ['Did PayPal confirm our last contribution?', 'check everything with PayPal now', 'need a paypal check', '', null]) assert.equal(isNeedsCheckQuestion(q), false, String(q));
});

test('pending, failed and unchecked records are named with their receipts; matched ones are not; nothing is called or written', async () => {
  const env = setupDomain({ mode: 'sandbox' });
  const { failing, service } = flakyService(env);
  const matched = await captured(env, service, 1500);
  await service.refreshPayPalOrder({ providerOrderId: matched.orderId, ...owner(env) });
  env.fake.behavior.captureStatus = 'PENDING';
  const pending = await captured(env, service, 2000);
  env.fake.behavior.captureStatus = 'COMPLETED';
  const failed = await captured(env, service, 2500);
  await service.refreshPayPalOrder({ providerOrderId: failed.orderId, ...owner(env) }); // an earlier success...
  failing.on = true;
  await assert.rejects(service.refreshPayPalOrder({ providerOrderId: failed.orderId, ...owner(env) }), { code: 'paypal_error' }); // ...then a failure
  failing.on = false;
  const unchecked = await captured(env, service, 3000);
  const simulated = env.db.prepare('SELECT COUNT(*) AS n FROM payment_orders').get().n;
  assert.equal(simulated, 4);

  const before = rows(env.db), providerReads = env.fake.requests.length;
  const { steward, calls } = localSteward(env, { service });
  const res = await steward.ask({ question: NEEDS_CHECK_QUESTION, memberId: 'm_wren' });
  assert.equal(res.status, 'ok');
  assert.equal(res.source, 'local-records');
  assert.equal(res.kind, 'needs-check');
  assert.equal(res.verification, null);
  assert.equal(res.model, null);
  assert.equal(res.paypalTools, false);
  // Records are listed newest first, as in the ledger.
  assert.match(res.answer, /^2 contributions need a PayPal check: \$25\.00 \(the last check did not get an answer from PayPal\); \$20\.00 \(pending in PayPal\)\. Open the receipt and use Check with PayPal\./);
  assert.match(res.answer, /1 contribution has no saved check\./);
  assert.match(res.answer, /This reads saved records only; no new PayPal check was made\.$/);
  assert.deepEqual(res.receipts, [
    { contributionId: failed.contributionId, orderId: failed.orderId, amount: '$25.00', status: 'Check failed · PayPal did not answer', needsCheck: true },
    { contributionId: pending.contributionId, orderId: pending.orderId, amount: '$20.00', status: 'Pending · not checked yet', needsCheck: true },
    { contributionId: unchecked.contributionId, orderId: unchecked.orderId, amount: '$30.00', status: 'No saved check', needsCheck: false },
  ]);
  assert.ok(!res.receipts.some((r) => r.orderId === matched.orderId), 'a matched contribution is not listed');
  assert.deepEqual(res.checks.map((c) => [c.source, c.summary]), [['Saved household records', 'Read 4 PayPal contribution records for this goal. No provider was contacted.']]);
  assert.deepEqual(calls, []);
  assert.equal(env.fake.requests.length, providerReads, 'no PayPal request');
  assert.equal(rows(env.db), before, 'no write');
  assert.equal(steward.available, false, 'works with no AI key');

  // With AI configured the same question still never reaches the model.
  const configured = localSteward(env, { configured: true, service });
  const again = await configured.steward.ask({ question: 'Does anything need a PayPal check?', memberId: 'm_rowan' });
  assert.equal(again.kind, 'needs-check');
  assert.deepEqual(configured.calls, []);
});

test('nothing to do, and a goal with only simulated contributions, are said plainly', async () => {
  const env = setupDomain({ mode: 'sandbox' });
  const { orderId } = await captured(env, env.service, 1500);
  await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner(env) });
  const { steward } = localSteward(env);
  const res = await steward.ask({ question: NEEDS_CHECK_QUESTION, memberId: 'm_rowan' });
  assert.equal(res.answer, 'Nothing needs a PayPal check right now across 1 PayPal contribution. This reads saved records only; no new PayPal check was made.');
  assert.deepEqual(res.receipts, []);

  const example = setupDomain({ mode: 'example' });
  example.service.simulateContribution({ ...contribution({ amountCents: 1500 }), outcome: 'completed' });
  const local = localSteward(example);
  const none = await local.steward.ask({ question: NEEDS_CHECK_QUESTION, memberId: 'm_rowan' });
  assert.match(none.answer, /^There are no PayPal contributions for this goal; the example contributions are simulated/);
  assert.deepEqual(none.receipts, []);
});

test('the answer is scoped to the asking household and goal', async () => {
  const env = setupDomain({ mode: 'sandbox' });
  env.fake.behavior.captureStatus = 'PENDING';
  const ours = await captured(env, env.service, 1500);
  // Another household's pending PayPal order in the same database, written the way the server would.
  const at = env.clock.iso();
  env.db.prepare("INSERT INTO households (id, name, play_mode, crest_field, crest_charge, is_example, setup_complete, created_at) VALUES ('hh_other', 'House Elsewhere', 'solo', 'violet', 'stag', 1, 1, ?)").run(at);
  env.db.prepare("INSERT INTO goals (id, household_id, name, target_cents, currency, target_date, weekly_budget_cents, created_at) VALUES ('goal_other', 'hh_other', 'Bike', 20000, 'USD', '2026-12-29', 2000, ?)").run(at);
  env.db.prepare(`INSERT INTO payment_orders (id, provider, provider_order_id, request_id, household_id, goal_id, approved_by, amount_cents, currency, status, status_detail, created_at, updated_at)
    VALUES ('ctb_other', 'paypal-sandbox', 'ORDEROTHER000001X', 'other-request-0001', 'hh_other', 'goal_other', 'm_other', 4200, 'USD', 'pending', 'Pending', ?, ?)`).run(at, at);
  const { steward } = localSteward(env);
  const res = await steward.ask({ question: NEEDS_CHECK_QUESTION, memberId: 'm_rowan' });
  assert.deepEqual(res.receipts.map((r) => r.orderId), [ours.orderId]);
  assert.doesNotMatch(res.answer, /\$42\.00/);
  assert.match(res.answer, /^1 contribution needs a PayPal check: \$15\.00 \(pending in PayPal\)/);
});

test('a refunded payment without saved checks is not described as a current completed contribution', async (t) => {
  const env = setupDomain({ mode: 'sandbox' });
  t.after(() => env.db.close());
  const { orderId } = await captured(env, env.service, 1500);
  const payment = env.service.contributions(env.goalId).find(c => c.providerOrderId === orderId);
  await env.service.refundPayPalCapture({ captureId: payment.captures[0].captureId, householdId: env.householdId,
    approverId: 'm_rowan', approvalConfirmed: true });
  const before = rows(env.db), requests = env.fake.requests.length;
  const { steward, calls } = localSteward(env);
  const result = await steward.ask({ question: NEEDS_CHECK_QUESTION, memberId: 'm_rowan' });
  assert.match(result.answer, /1 contribution has no saved check/);
  assert.doesNotMatch(result.answer, /completed contribution|verified by this server when paid/);
  assert.equal(result.receipts[0].status, 'Refunded · no saved check');
  assert.equal(rows(env.db), before);
  assert.equal(env.fake.requests.length, requests);
  assert.deepEqual(calls, []);
});
