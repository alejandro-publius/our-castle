import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { createClock } from '../../server/household.mjs';
import { FIXED_NOW } from '../helpers/setup.mjs';
import { contributionProjection, nextAction } from '../../src/core/journey.js';
import { milestoneCents, tierForProgress } from '../../src/core/rules.js';

// The next step is derived from real example-mode server states, produced by the same API the browser uses.
const root = fileURLToPath(new URL('../../', import.meta.url));
async function exampleServer() {
  const db = openDatabase(':memory:');
  const app = createApp({ config: loadConfig({}, { root }), db, clock: createClock(FIXED_NOW), paypal: null, aiProvider: null, root });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const json = method === 'GET' ? undefined : JSON.stringify(body ?? {});
    const response = await fetch(base + path, { method, headers: json ? { 'Content-Type': 'application/json' } : {}, body: json });
    const result = await response.json();
    assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(result)}`);
    return result;
  };
  return { call, close: () => new Promise((r) => { server.close(r); db.close(); }) };
}
let requests = 0;
const adultOf = (state) => state.members.find((m) => m.role === 'adult');
const childOf = (state) => state.members.find((m) => m.role === 'child');
const pay = (s, state, amountCents, outcome) => s.call('POST', '/api/example/contributions', {
  householdId: state.household.id, goalId: state.goal.id, amountCents, approverId: adultOf(state).id, approvalConfirmed: true, requestId: `journey-${++requests}`, outcome,
});
const text = (action) => `${action.title} ${action.why.join(' ')} ${action.cta}`;
// Words that would claim credit for money the server has not counted.
const CREDIT = /\b(counted toward|was confirmed|confirmed by|credited)\b/i;

test('the next step follows saved state through house, plan, contributions, refund and completion', async () => {
  const s = await exampleServer();
  try {
    let state = await s.call('GET', '/api/state');
    let next = nextAction(state, { persona: adultOf(state) });
    assert.deepEqual([next.key, next.step, next.cta], ['found-house', 'house', 'Set up your house']);

    state = (await s.call('POST', '/api/setup', { playMode: 'family', name: 'House of Rivergate', crest: { field: 'cobalt', charge: 'stag' } })).state;
    next = nextAction(state, { persona: adultOf(state) });
    assert.deepEqual([next.key, next.step, next.cta, next.target], ['make-plan', 'plan', 'Make your plan', '#plan-heading']);

    const { goal, progress } = state;
    const proposed = await s.call('POST', '/api/plans', { goal: { name: goal.name, targetCents: goal.targetCents, startingCents: progress.startingCents, targetDate: goal.targetDate, weeklyBudgetCents: goal.weeklyBudgetCents }, commitments: [] });
    state = proposed.state;
    next = nextAction(state, { persona: adultOf(state) });
    assert.deepEqual([next.key, next.cta, next.target], ['review-plan', 'Review your plan', '#plan-headline']);
    assert.match(next.why[0], new RegExp(state.plan.headline.replace(/[$.]/g, '\\$&')));
    assert.match(next.why[0], /Nothing is paid/);

    state = (await s.call('POST', `/api/plans/${state.plan.id}/accept`)).state;
    next = nextAction(state, { persona: adultOf(state) });
    assert.equal(next.key, 'contribute-week');
    assert.equal(next.title, `Week ${state.nextStep.week}: add $${(state.nextStep.dueCents / 100).toFixed(2)}`);
    assert.equal(next.cta, 'Choose a contribution');
    assert.match(next.why[0], /The Manor needs \$15\.00 more\./);
    // A child persona sees the same step, with the adult-approval boundary spelled out.
    const child = nextAction(state, { persona: childOf(state) });
    assert.equal(child.key, 'contribute-week');
    assert.ok(child.why.some((w) => /child persona: switch “Acting as” to an adult to approve/.test(w)));

    // A canceled payment changes nothing and must not read as credit.
    let res = await pay(s, state, 1500, 'canceled');
    state = res.state;
    next = nextAction(state, { persona: adultOf(state) });
    assert.equal(state.progress.progressCents, 6000);
    assert.equal(next.key, 'contribute-week');
    assert.ok(next.why.some((w) => w === 'Your last payment of $15.00 was canceled before approval, so it was not counted.'), next.why.join(' | '));
    // The saved record stays reachable after a refresh, from durable state.
    assert.deepEqual(next.record, { contributionId: state.contributions[0].id, amountCents: 1500, status: 'approval_canceled', simulated: true });

    // A pending payment is the next thing to follow up, and it is not counted.
    res = await pay(s, state, 1500, 'pending');
    state = res.state;
    next = nextAction(state, { persona: adultOf(state) });
    assert.deepEqual([next.key, next.step, next.cta, next.target], ['payment-pending', 'ledger', 'Check the pending payment', '#ledger-contrib-title']);
    assert.match(next.why[0], /\$15\.00 \(simulated example payment\) is not counted until it completes\. Goal progress is still \$60\.00\./);
    assert.doesNotMatch(text(next), CREDIT);
    assert.equal(next.record, null, 'the step itself opens the Ledger');

    // The server completes it: the receipt is the next step until it has been shown, then the plan continues.
    res = await s.call('POST', `/api/example/contributions/${res.contribution.id}/complete`, { householdId: state.household.id });
    state = res.state;
    assert.equal(state.progress.progressCents, 7500);
    next = nextAction(state, { persona: adultOf(state), receipt: res.contribution, receiptReviewed: false });
    assert.deepEqual([next.key, next.step, next.cta, next.target], ['receipt-ready', 'give', 'Review the receipt', '#receipt']);
    assert.match(next.why[0], /The server counted this simulated example payment\. Goal progress is now \$75\.00 \(25%\)\./);
    next = nextAction(state, { persona: adultOf(state), receipt: res.contribution, receiptReviewed: true });
    assert.equal(next.key, 'contribute-week');
    assert.match(next.why[0], /The Keep needs \$105\.00 more\./);
    assert.equal(next.record.status, 'completed');

    // A refund lowers progress; the Manor stays as a keepsake and is not described as money still in the goal.
    const capture = state.contributions.find((c) => c.status === 'completed').captures[0];
    state = (await s.call('POST', `/api/example/captures/${capture.captureId}/refund`, { householdId: state.household.id, approverId: adultOf(state).id, approvalConfirmed: true })).state;
    assert.equal(state.progress.progressCents, 6000);
    assert.equal(state.board.builtTierCommemorative, true);
    next = nextAction(state, { persona: adultOf(state) });
    assert.equal(next.key, 'contribute-week');
    assert.ok(next.why.some((w) => /\$15\.00 was refunded; goal progress went down by the refunded amount\./.test(w)));
    assert.ok(next.why.some((w) => /The Manor stands as a keepsake from an earlier milestone\. That money is not in the goal now: current progress is \$60\.00\./.test(w)));
    assert.match(next.why[0], /The Manor needs \$15\.00 more\./);
    assert.equal(next.record.status, 'refunded');

    // Completing the goal points to the rewards.
    res = await pay(s, state, state.progress.remainingCents, 'completed');
    state = res.state;
    next = nextAction(state, { persona: adultOf(state), receipt: res.contribution, receiptReviewed: true });
    assert.deepEqual([next.key, next.step, next.cta], ['goal-complete', 'rewards', 'See your rewards']);
    assert.match(next.why[0], /\$300\.00 of \$300\.00 is tracked/);
  } finally { await s.close(); }
});

test('an unfinished PayPal sandbox order is not credit, and a newer unaccepted plan asks for review', async () => {
  const s = await exampleServer();
  try {
    let state = (await s.call('POST', '/api/setup', { playMode: 'solo', name: 'House of Ash', crest: { field: 'crimson', charge: 'tower' } })).state;
    const { goal, progress } = state;
    const body = { goal: { name: goal.name, targetCents: goal.targetCents, startingCents: progress.startingCents, targetDate: goal.targetDate, weeklyBudgetCents: goal.weeklyBudgetCents }, commitments: [] };
    state = (await s.call('POST', '/api/plans', body)).state;
    state = (await s.call('POST', `/api/plans/${state.plan.id}/accept`)).state;
    // A sandbox order that PayPal never approved, as the server records it (status "created").
    const unfinished = { ...state, contributions: [{ id: 'x', status: 'created', simulated: false, amountCents: 2500, captures: [] }, ...state.contributions] };
    const next = nextAction(unfinished, { persona: adultOf(state) });
    assert.equal(next.key, 'contribute-week');
    assert.ok(next.why.some((w) => w === 'A $25.00 PayPal sandbox order was not finished, so nothing was counted.'));
    assert.doesNotMatch(text(next), CREDIT);
    // Asking for a new plan after accepting one: the newer plan needs review before it is used.
    state = (await s.call('POST', '/api/plans', { ...body, goal: { ...body.goal, weeklyBudgetCents: 6000 } })).state;
    assert.notEqual(state.plan.id, state.acceptedPlanId);
    assert.equal(nextAction(state, { persona: adultOf(state) }).key, 'review-plan');
  } finally { await s.close(); }
});

test('the contribution projection uses the shared milestone rules, including custom goals and keepsakes', () => {
  // $60 of $300: $15 reaches the Manor (25%).
  let p = contributionProjection({ progressCents: 6000, targetCents: 30000, builtTier: 0 }, 1500);
  assert.deepEqual([p.afterCents, p.percent, p.rises, p.alreadyStanding, p.completes], [7500, '25%', ['Manor'], [], false]);
  assert.deepEqual([p.next.name, p.next.awayCents], ['Keep', 10500]);
  // After a refund the Manor already stands as a keepsake: reaching 25% again does not raise it twice.
  p = contributionProjection({ progressCents: 6000, targetCents: 30000, builtTier: 1, earned: ['estate:porch'] }, 1500);
  assert.deepEqual([p.rises, p.alreadyStanding], [[], ['Manor']]);
  // 40% adds the village quarter unless it was earned before.
  assert.deepEqual(contributionProjection({ progressCents: 9000, targetCents: 30000, builtTier: 1 }, 3000).additions, ['The village quarter']);
  assert.deepEqual(contributionProjection({ progressCents: 9000, targetCents: 30000, builtTier: 1, earned: ['estate:market'] }, 3000).additions, []);
  // An awkward custom goal: thresholds and tiers come from milestoneCents/tierForProgress, never re-derived here.
  const target = 123456, manor = milestoneCents(target, 25);
  assert.equal(manor, 30864);
  assert.deepEqual(contributionProjection({ progressCents: 0, targetCents: target }, manor - 1).rises, []);
  assert.deepEqual(contributionProjection({ progressCents: 0, targetCents: target }, manor).rises, ['Manor']);
  assert.equal(tierForProgress(manor, target), 1);
  p = contributionProjection({ progressCents: 100000, targetCents: target }, target - 100000);
  assert.deepEqual([p.completes, p.next, p.rises], [true, null, ['Castle']]);
});
