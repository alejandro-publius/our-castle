import test from 'node:test';
import assert from 'node:assert/strict';
import { createSteward } from '../../server/steward/index.mjs';
import { HOLDS_QUESTION, isHoldsQuestion, isLocalQuestion, isNeedsCheckQuestion } from '../../src/core/steward-questions.js';
import { contribution, requestId, setupDomain } from '../helpers/setup.mjs';

// "Which holds end soonest?" is answered from this household's saved records through the existing steward request: no
// model call, no PayPal lookup, no write, and no claim that PayPal was asked. Fake sandbox and simulated holds only.
const owner = (env) => ({ householdId: env.householdId, goalId: env.goalId });
const rows = (db) => JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
const DAY = 86_400_000;

function localSteward(env) {
  const calls = [];
  const forbidden = (name) => async () => { calls.push(name); throw new Error(`Unexpected provider call: ${name}`); };
  const steward = createSteward({ db: env.db, contributions: env.service, householdId: env.householdId, clock: env.clock, ai: null,
    paypalTools: { getOrder: forbidden('get_order'), listTransactions: forbidden('list_transactions') },
    fetch: async () => { calls.push('model'); return new Response('{}', { status: 401 }); } });
  return { steward, calls, ask: (question = HOLDS_QUESTION) => steward.ask({ question, memberId: 'm_rowan' }) };
}
async function held(env, amountCents) {
  const created = await env.service.createPayPalOrder(contribution({ hold: true, amountCents }));
  await env.service.capturePayPalOrder({ providerOrderId: created.orderId, ...owner(env) });
  return created.contribution.id;
}

test('the question is recognised in a few plain forms and nothing else', () => {
  for (const q of [HOLDS_QUESTION, 'which holds end soonest', 'Is anything still held?', 'What is being held?!', 'Any open holds?']) {
    assert.equal(isHoldsQuestion(q), true, q);
    assert.equal(isLocalQuestion(q), true, q);
    assert.equal(isNeedsCheckQuestion(q), false, q);
  }
  for (const q of ['Release our holds', 'return the hold', 'holds', 'Is anything still pending?', '', null]) assert.equal(isHoldsQuestion(q), false, String(q));
});

test('a sandbox hold is answered from saved records with its receipt; a returned hold is left out; nothing is called or written', async () => {
  const env = setupDomain({ mode: 'sandbox' });
  const { calls, ask } = localSteward(env);
  assert.equal((await ask()).answer, 'Nothing is held for this goal right now. This reads saved records only; no provider was contacted.');

  const first = await held(env, 4000);
  await env.service.releaseHold({ contributionId: first, ...owner(env), approverId: 'm_rowan', approvalConfirmed: true, requestId: requestId(), amountCents: 1000, keepRest: true });
  const returned = await held(env, 900);
  await env.service.returnHold({ contributionId: returned, ...owner(env), approverId: 'm_rowan', approvalConfirmed: true, requestId: requestId() });

  const requests = env.fake.requests.length, before = rows(env.db);
  const res = await ask('is anything still held');
  assert.equal(res.answer, '1 hold is open, with $30.00 still held. None of it counts toward the goal until an adult releases it. '
    + '$30.00 of $40.00: PayPal’s guarantee lasts 3 more days, until Nov 6. It can be held until Dec 2 at the latest. '
    + 'This reads saved records only; PayPal was not asked.');
  assert.deepEqual(res.receipts.map((r) => [r.contributionId, r.amount, r.status, r.needsCheck]), [[first, '$30.00', 'Held, guaranteed', false]]);
  assert.equal(res.receipts[0].orderId, env.service.contributions(env.goalId).find((c) => c.id === first).providerOrderId);
  assert.deepEqual([res.status, res.source, res.kind, res.model, res.paypalTools, res.verification, res.warnings], ['ok', 'local-records', 'holds', null, false, null, []]);
  assert.deepEqual(res.checks, [{ tool: 'read_open_holds', source: 'Saved household records', summary: 'Read 1 open hold for this goal. No provider was contacted.' }]);
  assert.deepEqual(calls, [], 'no model and no PayPal tool');
  assert.equal(env.fake.requests.length, requests, 'PayPal was not asked');
  assert.equal(rows(env.db), before, 'nothing was written');
});

test('simulated holds are listed soonest to end first and said to be simulated; no PayPal is mentioned', async () => {
  const env = setupDomain();
  const { calls, ask } = localSteward(env);
  const start = env.clock.now().getTime();
  // Placed in the other order than they end: the later hold first by id is not what decides.
  const older = env.service.simulateContribution(contribution({ hold: true, amountCents: 2500 })).contribution.id;
  env.clock.now = () => new Date(start + 4 * DAY); // the older hold is past its three-day guarantee when the newer is placed
  const newer = env.service.simulateContribution(contribution({ hold: true, amountCents: 1500 })).contribution.id;
  const res = await ask();
  assert.equal(res.answer, '2 holds are open, with $40.00 still held. None of it counts toward the goal until an adult releases it. Soonest to end first. '
    + '$25.00 of $25.00 (simulated): The simulated guarantee ended Nov 6. An adult can extend it once. It can be held until Dec 2 at the latest. '
    + '$15.00 of $15.00 (simulated): The simulated guarantee lasts 3 more days, until Nov 10. It can be held until Dec 6 at the latest. '
    + 'This reads saved records only; no provider was contacted.');
  assert.deepEqual(res.receipts.map((r) => [r.contributionId, r.amount, r.status]), [[older, '$25.00', 'Held'], [newer, '$15.00', 'Held, guaranteed']]);
  assert.deepEqual(calls, []);
});
