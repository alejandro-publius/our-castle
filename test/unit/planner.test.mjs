import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanText, computeBasis, rulesAmounts } from '../../server/planner/basis.mjs';
import { dollarFigures, validateAiPlan, validateEditedAmounts } from '../../server/planner/validate.mjs';
import { createPlanner } from '../../server/planner/index.mjs';
import { PlannerProviderError } from '../../server/planner/anthropic-provider.mjs';
import { DEMO_GOAL_ID, DEMO_HOUSEHOLD_ID, getGoal, progressFor, updateGoal } from '../../server/household.mjs';
import { setupDomain } from '../helpers/setup.mjs';

const goal = (o = {}) => ({ name: 'Camping trip fund', targetCents: 30000, currency: 'USD', targetDate: '2026-12-29', weeklyBudgetCents: 3000, ...o });
const progress = (cents = 6000) => ({ startingCents: cents, confirmedNetCents: 0, progressCents: cents });
const basisFor = (o = {}, p = 6000, commitments = []) => computeBasis({ goal: goal(o), progress: progress(p), commitments, today: '2026-11-03' });

test('demo basis: $240 remaining over eight weekly contributions of $30 reaches the goal exactly', () => {
  const b = basisFor();
  assert.equal(b.weeks, 8);
  assert.equal(b.remainingCents, 24000);
  assert.equal(b.dates[0], '2026-11-10');
  assert.equal(b.dates.at(-1), '2026-12-29');
  assert.equal(b.plannedCents, 24000);
  assert.equal(b.shortfallCents, 0);
  assert.deepEqual(rulesAmounts(b), Array(8).fill(3000));
  assert.deepEqual(b.milestones.map((m) => [m.key, m.targetCents, m.awayCents]), [['manor', 7500, 1500], ['keep', 18000, 12000], ['castle', 30000, 24000]]);
});

test('an impossible target reports the exact shortfall and the alternatives', () => {
  const b = basisFor({ weeklyBudgetCents: 1000 });
  assert.equal(b.feasible, false);
  assert.equal(b.plannedCents, 8000);
  assert.equal(b.shortfallCents, 16000);
  assert.equal(b.requiredWeeklyCents, 3000);
  assert.equal(b.suggestedDate, '2027-04-20'); // 24 weeks at $10
  const text = buildPlanText(b, rulesAmounts(b));
  assert.match(text.headline, /\$160\.00 short/);
  assert.ok(text.cautions.some((c) => c.includes('$30.00') && c.includes('Apr 20, 2027')));
  assert.equal(validateAiPlan(text, b).ok, true, 'the rules plan passes the same validator as AI output');
});

test('rules plans cover uneven remainders in whole-dollar weeks without exceeding the weekly amount', () => {
  const b = basisFor({ targetCents: 31000, weeklyBudgetCents: 4000 });
  const amounts = rulesAmounts(b);
  assert.equal(amounts.reduce((a, c) => a + c, 0), 25000);
  assert.ok(amounts.every((a) => a <= 4000 && a % 100 === 0));
  assert.equal(validateAiPlan(buildPlanText(b, amounts), b).ok, true);
});

function validAiOutput(b) {
  return {
    headline: 'Reach the Manor this week',
    summary: 'You have $60.00 tracked. Adding $30.00 each week covers the remaining $240.00.',
    contributions: b.dates.map((date, i) => ({ week: i + 1, date, amountCents: 3000, note: i === 0 ? 'The first $15.00 raises the Manor.' : '' })),
    explanation: ['$300.00 − $60.00 = $240.00.', '$240.00 ÷ 8 weeks = $30.00 a week.'],
    milestoneNotes: [{ milestone: 'manor', note: 'Manor at $75.00 in week 1.' }, { milestone: 'keep', note: 'Keep at $180.00 by week 4.' }],
    cautions: ['Each contribution needs an adult’s approval in PayPal.'],
    claimedTotals: { plannedCents: 24000, shortfallCents: 0, feasible: true },
  };
}

test('a well-formed AI plan that matches the arithmetic is accepted', () => {
  const b = basisFor();
  const result = validateAiPlan(validAiOutput(b), b);
  assert.deepEqual(result.issues, []);
});

test('invalid AI output is rejected with readable reasons', () => {
  const b = basisFor();
  const cases = [
    ['negative cents', (o) => { o.contributions[2].amountCents = -100; }, 'cents'],
    ['fractional cents', (o) => { o.contributions[2].amountCents = 2999.5; }, 'cents'],
    ['over the chosen weekly amount', (o) => { o.contributions[0].amountCents = 4500; o.contributions[1].amountCents = 1500; }, 'budget'],
    ['wrong total', (o) => { o.contributions[7].amountCents = 2000; }, 'totals'],
    ['wrong date', (o) => { o.contributions[3].date = '2026-12-02'; }, 'dates'],
    ['missing week', (o) => { o.contributions.pop(); }, 'schedule'],
    ['false feasibility claim', (o) => { o.claimedTotals.feasible = false; }, 'totals'],
    ['fabricated income', (o) => { o.summary = 'With your $4,200.00 monthly income this is easy.'; }, 'fabricated_amount'],
    ['missing explanation', (o) => { o.explanation = []; }, 'shape'],
  ];
  for (const [name, mutate, code] of cases) {
    const output = structuredClone(validAiOutput(b));
    mutate(output);
    const result = validateAiPlan(output, b);
    assert.equal(result.ok, false, name);
    assert.ok(result.issues.some((i) => i.code === code), `${name}: expected ${code}, got ${JSON.stringify(result.issues)}`);
  }
  assert.equal(validateAiPlan(null, b).ok, false);
  assert.equal(validateAiPlan('{"headline":1}', b).ok, false);
});

test('an AI plan that claims an impossible goal is reachable is rejected', () => {
  const b = basisFor({ weeklyBudgetCents: 1000 });
  const output = validAiOutput(b);
  const result = validateAiPlan(output, b);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.code === 'budget'));
});

test('dollar figures are extracted precisely', () => {
  assert.deepEqual(dollarFigures('$1,234.56 then $30 and $ 7.05, not 40$'), [123456, 3000, 705]);
});

test('household edits accept whole nonnegative cents and show the resulting shortfall', () => {
  const b = basisFor();
  assert.equal(validateEditedAmounts([1500, 4500, 3000, 3000, 3000, 3000, 3000, 3000], b).ok, true);
  assert.equal(validateEditedAmounts([1500, 4500, 3000, 3000, 3000, 3000, 3000, 3000], b).warnings.length, 1);
  assert.equal(validateEditedAmounts([3000, -1, 3000, 3000, 3000, 3000, 3000, 3000], b).ok, false);
  assert.equal(validateEditedAmounts([30000, 0, 0, 0, 0, 0, 0, 0], b).ok, false, 'cannot plan past the goal');
  assert.equal(validateEditedAmounts([3000], b).ok, false);
});

function plannerWith(provider) {
  const env = setupDomain();
  return { ...env, planner: createPlanner({ db: env.db, clock: env.clock, provider }) };
}

test('example mode stores a labeled rules plan, never an AI plan', async () => {
  const { planner } = plannerWith(null);
  const result = await planner.propose({ householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, commitments: [{ label: 'Internet bill', amountCents: 6000, cadence: 'monthly' }] });
  assert.equal(result.status, 'ok');
  assert.equal(result.plan.source, 'rules');
  assert.match(result.plan.sourceLabel, /no AI/);
  assert.equal(result.plan.totals.plannedCents, 24000);
  assert.ok(result.plan.cautions.some((c) => c.includes('Internet bill $60.00 a month')));
  assert.deepEqual(result.plan.projections.map((p) => p.week), [1, 4, 8]);
});

test('a live provider plan is stored only after validation, with provider and model recorded', async () => {
  const provider = { provider: 'anthropic', model: 'claude-opus-5-5', proposePlan: async (b) => ({ output: validAiOutput(b), model: 'claude-opus-5-5', requestId: 'req_test' }) };
  const { planner } = plannerWith(provider);
  const result = await planner.propose({ householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, commitments: [] });
  assert.equal(result.status, 'ok');
  assert.equal(result.plan.source, 'ai');
  assert.equal(result.plan.model, 'claude-opus-5-5');
  assert.equal(result.plan.providerRequestId, 'req_test');
});

test('invalid provider output is surfaced, not stored, and a labeled rules fallback is available', async () => {
  const provider = {
    provider: 'anthropic', model: 'claude-opus-5-5',
    proposePlan: async (b) => { const o = validAiOutput(b); o.contributions[0].amountCents = 9000; return { output: o, model: 'claude-opus-5-5' }; },
  };
  const { planner, db } = plannerWith(provider);
  const result = await planner.propose({ householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, commitments: [] });
  assert.equal(result.status, 'invalid_ai_output');
  assert.ok(result.issues.length > 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plans').get().n, 0);
  const fallback = planner.proposeRules({ householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, commitments: [], afterAiFailure: true });
  assert.equal(fallback.plan.source, 'rules');
  assert.equal(fallback.plan.fallbackFromAi, true);
});

test('provider errors (auth, refusal, network) are reported without inventing a plan', async () => {
  const provider = { provider: 'anthropic', model: 'claude-opus-5-5', proposePlan: async () => { throw new PlannerProviderError('auth', 'The AI provider rejected the API key in the server .env file.'); } };
  const { planner } = plannerWith(provider);
  const result = await planner.propose({ householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, commitments: [] });
  assert.equal(result.status, 'provider_error');
  assert.equal(result.error.kind, 'auth');
});

test('edits are re-validated and stored as household-edited; accepting supersedes others', async () => {
  const { planner } = plannerWith(null);
  const { plan } = await planner.propose({ householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, commitments: [] });
  assert.throws(() => planner.edit({ householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, planId: plan.id, amounts: [1, 2] }), { code: 'invalid_edit' });
  const edited = planner.edit({ householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, planId: plan.id, amounts: [1500, 1500, 3000, 3000, 3000, 3000, 3000, 3000] });
  assert.equal(edited.source, 'household-edited');
  assert.equal(edited.totals.shortfallCents, 3000);
  assert.equal(edited.totals.feasible, false);
  const accepted = planner.accept({ householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, planId: edited.id });
  assert.equal(accepted.status, 'accepted');
  assert.throws(() => planner.accept({ householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, planId: plan.id }), { code: 'plan_superseded' });
});

test('plans use current tracked progress, including confirmed contributions', async () => {
  const env = plannerWith(null);
  env.service.simulateContribution({ householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, amountCents: 1500, approverId: 'm_rowan', approvalConfirmed: true, requestId: 'plan-progress-1' });
  const { plan } = await env.planner.propose({ householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, commitments: [] });
  assert.equal(plan.totals.remainingCents, 22500);
  assert.equal(plan.projections[0].reached, true);
  updateGoal(env.db, DEMO_GOAL_ID, { name: 'Camping trip fund', targetCents: 30000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-29' }, env.clock);
  assert.equal(env.planner.current(DEMO_GOAL_ID), null, 'editing the goal supersedes the old plan');
  assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 7500);
  assert.equal(getGoal(env.db, DEMO_GOAL_ID).weeklyBudgetCents, 3000);
});
