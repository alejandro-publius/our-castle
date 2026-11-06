import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { DEMO_GOAL_ID, DEMO_HOUSEHOLD_ID, createClock, daysBetween, progressFor, setStartingProgress, getGoal, updateGoal } from '../../server/household.mjs';
import { buildPlanText, rulesAmounts } from '../../server/planner/basis.mjs';
import { createPlanner } from '../../server/planner/index.mjs';
import { previewRemainingPlan } from '../../server/planner/remaining.mjs';
import { webhookHeaders } from '../helpers/fake-paypal.mjs';
import { FIXED_NOW, contribution, setupDomain } from '../helpers/setup.mjs';

// Plans stay correct while the household's facts change, and the remaining-plan preview is read-only.
// Fake transports only: simulated example payments, the stateful fake PayPal sandbox and a scripted model response.
const root = fileURLToPath(new URL('../../', import.meta.url));
const ids = { householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID };
const GOAL = { name: 'Camping trip fund', targetCents: 30000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-29' };

/** Every row of every application table, so a refused or read-only operation can be shown to write nothing. */
function snapshot(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name);
  return Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
}

function env({ provider = null, mode = 'example' } = {}) {
  const e = setupDomain({ mode });
  let now = FIXED_NOW;
  e.clock.now = () => new Date(now); // iso() and today() read now(): one movable server clock for every service
  e.setNow = (value) => { now = value; };
  e.planner = createPlanner({ db: e.db, clock: e.clock, provider });
  e.give = (amountCents) => e.service.simulateContribution(contribution({ amountCents }));
  e.refund = (result) => e.service.simulateRefund({ captureId: result.contribution.captures[0].captureId, householdId: DEMO_HOUSEHOLD_ID, approverId: 'm_rowan', approvalConfirmed: true });
  return e;
}

/** A scripted model: it answers with a schedule that passes the server's checks, but only when the test releases it. */
function scriptedModel() {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const seen = [];
  return {
    seen,
    release: () => release(),
    provider: {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      async proposePlan(basis) {
        seen.push(basis);
        await gate;
        return { output: buildPlanText(basis, rulesAmounts(basis)), model: 'claude-opus-5-5', requestId: 'req_scripted' };
      },
    },
  };
}

const codes = (error) => error.issues.map((i) => i.code);

// ---------------------------------------------------------------- Deliverable 1: stale proposals ----

test('reproduced defect: a $240 proposal is refused after a $15 contribution leaves $225, and a fresh one is accepted', () => {
  const e = env();
  const { plan } = e.planner.proposeRules({ ...ids, commitments: [] });
  assert.equal(plan.totals.remainingCents, 24000);
  e.give(1500);
  assert.equal(progressFor(e.db, DEMO_GOAL_ID).progressCents, 7500);

  const before = snapshot(e.db);
  assert.throws(() => e.planner.accept({ ...ids, planId: plan.id }), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, 'plan_stale');
    assert.deepEqual(codes(error), ['contributions', 'progress']);
    assert.match(error.issues[1].message, /Tracked progress is now \$75\.00; this plan used \$60\.00\./);
    return true;
  });
  assert.deepEqual(snapshot(e.db), before, 'the refusal wrote nothing: plans, ledger, payments and keepsakes are unchanged');
  assert.equal(e.planner.accepted(DEMO_GOAL_ID), null);
  const review = e.planner.review(DEMO_GOAL_ID);
  assert.deepEqual([review.planId, review.status, review.needsRefresh, review.factsChanged], [plan.id, 'proposed', true, true]);
  assert.match(review.factsRevision, /^pf1_[0-9a-f]{32}$/);
  assert.notEqual(review.planFactsRevision, review.factsRevision);

  const fresh = e.planner.proposeRules({ ...ids, commitments: [] }).plan;
  assert.equal(fresh.totals.remainingCents, 22500);
  assert.equal(e.planner.review(DEMO_GOAL_ID).needsRefresh, false);
  assert.equal(e.planner.accept({ ...ids, planId: fresh.id }).status, 'accepted');
  assert.throws(() => e.planner.accept({ ...ids, planId: plan.id }), { code: 'plan_superseded' });
});

test('editing a stale proposal is refused before validation and writes nothing', () => {
  const e = env();
  const { plan } = e.planner.proposeRules({ ...ids, commitments: [] });
  e.give(1500);
  const before = snapshot(e.db);
  // These amounts fit the old $240 basis but go past the $225 actually remaining.
  assert.throws(() => e.planner.edit({ ...ids, planId: plan.id, amounts: Array(8).fill(3000) }), { code: 'plan_stale' });
  assert.deepEqual(snapshot(e.db), before);
});

test('full and partial refunds make an unaccepted proposal stale', async () => {
  const full = env();
  const paid = full.give(3000);
  const { plan } = full.planner.proposeRules({ ...ids, commitments: [] });
  full.refund(paid);
  const before = snapshot(full.db);
  assert.throws(() => full.planner.accept({ ...ids, planId: plan.id }), (error) => {
    assert.deepEqual(codes(error), ['contributions', 'progress']);
    assert.match(error.issues[0].message, /A refund lowered counted contributions from \$30\.00 to \$0\.00\./);
    return true;
  });
  assert.deepEqual(snapshot(full.db), before);

  // Fake PayPal sandbox: a captured $30 order, then a verified $10 dashboard refund webhook.
  const sandbox = env({ mode: 'sandbox' });
  const created = await sandbox.service.createPayPalOrder(contribution({ amountCents: 3000 }));
  const captured = await sandbox.service.capturePayPalOrder({ providerOrderId: created.orderId, ...ids });
  const proposal = sandbox.planner.proposeRules({ ...ids, commitments: [] }).plan;
  assert.equal(proposal.totals.remainingCents, 21000);
  const event = {
    id: 'WH-PLAN-PARTIAL', event_type: 'PAYMENT.CAPTURE.REFUNDED',
    resource: { id: 'REFUND-PLAN-1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '10.00' }, links: [{ rel: 'up', href: `https://api.sandbox.paypal.com/v2/payments/captures/${captured.contribution.captures[0].captureId}` }] },
  };
  assert.equal((await sandbox.service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify(event) })).outcome, 'refunded');
  const sandboxBefore = snapshot(sandbox.db);
  assert.throws(() => sandbox.planner.accept({ ...ids, planId: proposal.id }), (error) => {
    assert.match(error.issues.at(-1).message, /Tracked progress is now \$80\.00; this plan used \$90\.00\./);
    return true;
  });
  assert.deepEqual(snapshot(sandbox.db), sandboxBefore);
  assert.equal(sandbox.planner.proposeRules({ ...ids, commitments: [] }).plan.totals.remainingCents, 22000);
});

test('goal edits set the proposal aside, and a starting-progress change made any other way still makes it stale', () => {
  const edits = [['target', { targetCents: 32000 }], ['weekly', { weeklyBudgetCents: 4000 }], ['date', { targetDate: '2027-01-05' }], ['starting', { startingCents: 7000 }]];
  for (const [name, change] of edits) {
    const e = env();
    const { plan } = e.planner.proposeRules({ ...ids, commitments: [] });
    updateGoal(e.db, DEMO_GOAL_ID, { ...GOAL, ...change }, e.clock);
    const before = snapshot(e.db);
    assert.throws(() => e.planner.accept({ ...ids, planId: plan.id }), { code: 'plan_superseded' }, name);
    assert.throws(() => e.planner.edit({ ...ids, planId: plan.id, amounts: Array(8).fill(1000) }), { code: 'plan_superseded' }, name);
    assert.deepEqual(snapshot(e.db), before, name);
  }
  // Defense in depth: the facts check does not depend on updateGoal's supersede step.
  const e = env();
  const { plan } = e.planner.proposeRules({ ...ids, commitments: [] });
  setStartingProgress(e.db, getGoal(e.db, DEMO_GOAL_ID), 7000, e.clock.iso());
  assert.throws(() => e.planner.accept({ ...ids, planId: plan.id }), (error) => {
    assert.equal(error.code, 'plan_stale');
    assert.deepEqual(codes(error), ['starting', 'progress']);
    return true;
  });
});

test('a proposal made before local midnight is stale after it; within the same day it stays usable', () => {
  const e = env();
  e.setNow('2026-11-03T00:00:01');
  const morning = e.planner.proposeRules({ ...ids, commitments: [] }).plan;
  e.setNow('2026-11-03T23:59:59');
  assert.equal(e.planner.review(DEMO_GOAL_ID).needsRefresh, false);
  const late = e.planner.proposeRules({ ...ids, commitments: [] }).plan;
  assert.equal(late.contributions[0].date, morning.contributions[0].date);
  e.setNow('2026-11-04T00:00:00');
  const before = snapshot(e.db);
  assert.throws(() => e.planner.accept({ ...ids, planId: late.id }), (error) => {
    assert.deepEqual(codes(error), ['date']);
    assert.match(error.issues[0].message, /made on Nov 3, 2026\. Today is Nov 4, 2026/);
    return true;
  });
  assert.deepEqual(snapshot(e.db), before);
  const next = e.planner.proposeRules({ ...ids, commitments: [] }).plan;
  assert.equal(next.contributions[0].date, '2026-11-11');
  assert.equal(next.contributions.length, 7, 'Dec 29 is now 55 days away: seven whole weeks');
});

test('facts that change while a scripted model is answering: the answer is dropped and nothing is stored', async () => {
  const cases = [
    ['contribution', (e) => e.give(1500), ['contributions', 'progress']],
    ['refund', (e) => e.refund(e.paid), ['contributions', 'progress']],
    ['goal edit', (e) => updateGoal(e.db, DEMO_GOAL_ID, { ...GOAL, weeklyBudgetCents: 4000 }, e.clock), ['weekly_amount']],
    ['starting edit', (e) => updateGoal(e.db, DEMO_GOAL_ID, { ...GOAL, startingCents: 7000 }, e.clock), ['starting', 'progress']],
    ['midnight', (e) => e.setNow('2026-11-04T00:00:00'), ['date']],
  ];
  for (const [name, change, expected] of cases) {
    const model = scriptedModel();
    const e = env({ provider: model.provider });
    if (name === 'refund') e.paid = e.give(2000);
    // A plan already in use must survive the dropped answer.
    const inUse = e.planner.proposeRules({ ...ids, commitments: [] }).plan;
    e.planner.accept({ ...ids, planId: inUse.id });
    const pending = e.planner.propose({ ...ids, commitments: [] });
    assert.equal(model.seen.length, 1, `${name}: the model was asked once`);
    change(e);
    const before = snapshot(e.db);
    model.release();
    await assert.rejects(pending, (error) => {
      assert.equal(error.status, 409, name);
      assert.equal(error.code, 'plan_facts_changed', name);
      assert.deepEqual(codes(error), expected, name);
      return true;
    });
    assert.deepEqual(snapshot(e.db), before, `${name}: no plan row was written`);
    if (name === 'contribution' || name === 'refund' || name === 'midnight') {
      assert.equal(e.planner.accepted(DEMO_GOAL_ID).id, inUse.id, `${name}: the plan in use is untouched`);
    }
  }
  // Control: nothing changes while the model answers, so the validated plan is stored as a proposal.
  const model = scriptedModel();
  const e = env({ provider: model.provider });
  const pending = e.planner.propose({ ...ids, commitments: [] });
  model.release();
  const result = await pending;
  assert.equal(result.status, 'ok');
  assert.equal(result.plan.source, 'ai');
  assert.equal(result.plan.status, 'proposed');
});

test('an accepted plan is history: payments never make it stale, accepting it again is a no-op, and edits need fresh facts', () => {
  const e = env();
  const { plan } = e.planner.proposeRules({ ...ids, commitments: [] });
  const accepted = e.planner.accept({ ...ids, planId: plan.id });
  e.give(1500);
  e.give(3000);
  const state = () => ({ review: e.planner.review(DEMO_GOAL_ID), accepted: e.planner.accepted(DEMO_GOAL_ID) });
  assert.equal(state().accepted.id, plan.id);
  assert.equal(state().review.status, 'accepted');
  assert.equal(state().review.needsRefresh, false, 'an accepted plan never needs a refresh to stay in use');
  assert.equal(state().review.factsChanged, true);

  const before = snapshot(e.db);
  assert.deepEqual(e.planner.accept({ ...ids, planId: plan.id }), accepted, 'accepting again returns the same plan');
  assert.deepEqual(snapshot(e.db), before, 'and writes nothing');
  assert.equal(state().accepted.totals.remainingCents, 24000, 'its historical schedule is kept');

  assert.throws(() => e.planner.edit({ ...ids, planId: plan.id, amounts: Array(8).fill(1000) }), { code: 'plan_stale' });
  assert.deepEqual(snapshot(e.db), before);

  // A newer proposal is not disturbed by a repeated accept of the plan in use.
  const newer = e.planner.proposeRules({ ...ids, commitments: [] }).plan;
  e.planner.accept({ ...ids, planId: plan.id });
  assert.equal(e.planner.current(DEMO_GOAL_ID).id, newer.id);
  assert.equal(e.planner.current(DEMO_GOAL_ID).status, 'proposed');
  assert.equal(e.planner.accepted(DEMO_GOAL_ID).id, plan.id);
  e.planner.accept({ ...ids, planId: newer.id });
  assert.equal(e.planner.accepted(DEMO_GOAL_ID).id, newer.id);
  assert.equal(e.planner.accepted(DEMO_GOAL_ID).totals.remainingCents, 19500);
});

test('every plan operation is scoped to the household and its goal', async () => {
  const e = env();
  const at = e.clock.iso();
  e.db.prepare(`INSERT INTO households (id, name, play_mode, crest_field, crest_charge, is_example, setup_complete, created_at)
    VALUES ('hh_birch', 'House of Birch', 'solo', 'cobalt', 'stag', 1, 1, ?)`).run(at);
  e.db.prepare(`INSERT INTO goals (id, household_id, name, target_cents, currency, target_date, weekly_budget_cents, created_at)
    VALUES ('goal_birch', 'hh_birch', 'Bike fund', 20000, 'USD', '2026-12-29', 2500, ?)`).run(at);
  const birch = { householdId: 'hh_birch', goalId: 'goal_birch' };
  const ours = e.planner.proposeRules({ ...ids, commitments: [] }).plan;
  const theirs = e.planner.proposeRules({ ...birch, commitments: [] }).plan;
  const before = snapshot(e.db);
  const attempts = [
    () => e.planner.accept({ householdId: 'hh_birch', goalId: DEMO_GOAL_ID, planId: ours.id }),
    () => e.planner.accept({ householdId: DEMO_HOUSEHOLD_ID, goalId: 'goal_birch', planId: theirs.id }),
    () => e.planner.accept({ ...ids, planId: theirs.id }),
    () => e.planner.edit({ ...ids, planId: theirs.id, amounts: Array(8).fill(1000) }),
    () => e.planner.edit({ householdId: 'hh_birch', goalId: DEMO_GOAL_ID, planId: ours.id, amounts: Array(8).fill(1000) }),
    () => e.planner.proposeRules({ householdId: 'hh_birch', goalId: DEMO_GOAL_ID, commitments: [] }),
    () => e.planner.previewRemaining({ householdId: DEMO_HOUSEHOLD_ID, goalId: 'goal_birch', weeklyBudgetCents: 1000 }),
  ];
  for (const attempt of attempts) assert.throws(attempt, { status: 404, code: 'not_found' });
  await assert.rejects(e.planner.propose({ householdId: 'hh_birch', goalId: DEMO_GOAL_ID, commitments: [] }), { code: 'not_found' });
  assert.deepEqual(snapshot(e.db), before);
  // A payment in one household does not make the other household's proposal stale.
  e.give(1500);
  assert.equal(e.planner.accept({ ...birch, planId: theirs.id }).status, 'accepted');
  assert.equal(e.planner.current(DEMO_GOAL_ID).id, ours.id, "our proposal is not set aside by theirs");
});

// ---------------------------------------------------------------- Deliverable 2: remaining-plan preview ----

test('the preview matches the plan the built-in planner would propose after saving the same values', () => {
  const choices = [{}, { weeklyBudgetCents: 4000 }, { weeklyBudgetCents: 2000 }, { targetDate: '2027-01-26', weeklyBudgetCents: 2000 },
    { targetDate: '2026-12-08', weeklyBudgetCents: 4000 }, { weeklyBudgetCents: 0 }, { weeklyBudgetCents: 2999, targetDate: '2027-02-02' }];
  for (const choice of choices) {
    const previewEnv = env();
    previewEnv.give(1500);
    const preview = previewEnv.planner.previewRemaining({ ...ids, ...choice });

    const savedEnv = env();
    savedEnv.give(1500);
    updateGoal(savedEnv.db, DEMO_GOAL_ID, { ...GOAL, ...choice }, savedEnv.clock);
    const { plan } = savedEnv.planner.proposeRules({ ...ids, commitments: [] });
    const label = JSON.stringify(choice);
    assert.deepEqual(preview.schedule, plan.contributions.map(({ week, date, amountCents }) => ({ week, date, amountCents })), label);
    assert.deepEqual(preview.totals, { plannedCents: plan.totals.plannedCents, shortfallCents: plan.totals.shortfallCents, feasible: plan.totals.feasible, remainingCents: plan.totals.remainingCents }, label);
    assert.deepEqual(preview.milestones.map((m) => [m.key, m.week, m.date]), plan.projections.map((p) => [p.key, p.week, p.date]), label);
  }
});

test('previewing writes nothing and leaves the plan in use, the goal and the ledger alone', () => {
  const e = env();
  const { plan } = e.planner.proposeRules({ ...ids, commitments: [] });
  e.planner.accept({ ...ids, planId: plan.id });
  e.give(1500);
  const before = snapshot(e.db);
  const preview = e.planner.previewRemaining({ ...ids, weeklyBudgetCents: 2000, targetDate: '2027-01-05' });
  assert.equal(preview.saved, false);
  assert.equal(preview.planInUseId, plan.id);
  assert.deepEqual(preview.savedSettings, { weeklyBudgetCents: 3000, targetDate: '2026-12-29' });
  assert.deepEqual(snapshot(e.db), before);
});

test('an amount that cannot meet the date: exact shortfall, never a raised amount, and an achievable later date', () => {
  const e = env();
  e.give(1500);
  const preview = e.planner.previewRemaining({ ...ids, weeklyBudgetCents: 2000 });
  assert.equal(preview.outcome, 'short');
  assert.equal(preview.facts.remainingCents, 22500);
  assert.equal(preview.weeks, 8);
  assert.ok(preview.schedule.every((w) => w.amountCents === 2000), 'every week stays at the chosen $20.00');
  assert.deepEqual(preview.totals, { plannedCents: 16000, shortfallCents: 6500, feasible: false, remainingCents: 22500 });
  assert.equal(preview.requiredWeeklyCents, 2813);
  assert.deepEqual(preview.reach, { weeklyCents: 2000, weeksNeeded: 12, date: '2027-01-26', withinPlanningLimit: true });
  assert.deepEqual(preview.milestones.map((m) => [m.key, m.reached, m.week, m.date]), [['manor', true, 0, null], ['keep', false, 6, '2026-12-15'], ['castle', false, null, null]]);
  assert.match(preview.notes.join(' '), /At \$20\.00 a week the remaining \$225\.00 is covered by Jan 26, 2027 \(12 weeks\)\./);

  const later = e.planner.previewRemaining({ ...ids, weeklyBudgetCents: 2000, targetDate: preview.reach.date });
  assert.equal(later.outcome, 'on_track');
  assert.equal(later.totals.shortfallCents, 0);
  assert.ok(later.schedule.every((w) => w.amountCents <= 2000));
  assert.equal(later.milestones.at(-1).date, '2027-01-26');
});

test('zero weekly amount, reached and overfunded goals are reported honestly', () => {
  const e = env();
  e.give(1500);
  const zero = e.planner.previewRemaining({ ...ids, weeklyBudgetCents: 0 });
  assert.equal(zero.outcome, 'no_budget');
  assert.deepEqual(zero.totals, { plannedCents: 0, shortfallCents: 22500, feasible: false, remainingCents: 22500 });
  assert.ok(zero.schedule.every((w) => w.amountCents === 0));
  assert.deepEqual(zero.reach, { weeklyCents: 0, weeksNeeded: null, date: null, withinPlanningLimit: false });
  assert.equal(zero.requiredWeeklyCents, 2813);

  e.give(8500); // $160 tracked; then the family lowers the goal to $150
  updateGoal(e.db, DEMO_GOAL_ID, { ...GOAL, targetCents: 15000 }, e.clock);
  const before = snapshot(e.db);
  const reached = e.planner.previewRemaining({ ...ids, weeklyBudgetCents: 0 });
  assert.equal(reached.outcome, 'reached');
  assert.equal(reached.facts.remainingCents, 0);
  assert.equal(reached.facts.overfundedCents, 1000);
  assert.deepEqual(reached.schedule, []);
  assert.equal(reached.weeks, 0);
  assert.equal(reached.requiredWeeklyCents, 0);
  assert.ok(reached.milestones.every((m) => m.reached && m.week === 0 && m.date === null));
  assert.match(reached.notes.join(' '), /already reached: \$160\.00 of \$150\.00.*\$10\.00 above the goal amount/);
  assert.deepEqual(snapshot(e.db), before);
});

test('the 52-week planning bound is reported, not exceeded', () => {
  const e = env();
  e.give(1500);
  const far = e.planner.previewRemaining({ ...ids, weeklyBudgetCents: 100, targetDate: '2027-11-04' }); // 366 days
  assert.equal(far.weeks, 52);
  assert.equal(far.schedule.length, 52);
  assert.equal(far.planEndDate, '2027-11-02');
  assert.deepEqual(far.totals, { plannedCents: 5200, shortfallCents: 17300, feasible: false, remainingCents: 22500 });
  assert.equal(far.requiredWeeklyCents, 433);
  assert.deepEqual(far.reach, { weeklyCents: 100, weeksNeeded: 225, date: null, withinPlanningLimit: false });
  assert.match(far.notes.join(' '), /needs 225 weeks, longer than the 52-week planning limit/);
  assert.throws(() => e.planner.previewRemaining({ ...ids, targetDate: '2027-11-05' }), { code: 'invalid_plan_inputs' }); // 367 days
});

test('whole cents: odd remainders are covered exactly, and a one-cent gap is a real shortfall', () => {
  const e = env();
  updateGoal(e.db, DEMO_GOAL_ID, { ...GOAL, startingCents: 7499 }, e.clock);
  const odd = e.planner.previewRemaining(ids);
  assert.equal(odd.facts.remainingCents, 22501);
  assert.deepEqual(odd.schedule.map((w) => w.amountCents), [2900, 2900, 2900, 2900, 2900, 2900, 2900, 2201]);
  assert.equal(odd.totals.shortfallCents, 0);

  updateGoal(e.db, DEMO_GOAL_ID, { ...GOAL, startingCents: 6007, weeklyBudgetCents: 2999 }, e.clock);
  const tight = e.planner.previewRemaining(ids);
  assert.equal(tight.facts.remainingCents, 23993);
  assert.ok(tight.schedule.every((w) => w.amountCents === 2999 && Number.isSafeInteger(w.amountCents)));
  assert.equal(tight.totals.shortfallCents, 1);
  assert.equal(tight.requiredWeeklyCents, 3000);
  assert.deepEqual(tight.reach, { weeklyCents: 2999, weeksNeeded: 9, date: '2027-01-05', withinPlanningLimit: true });
});

test('preview inputs follow the goal editor’s limits', () => {
  const e = env();
  const bad = [
    [{ weeklyBudgetCents: -1 }, 'weekly_amount'], [{ weeklyBudgetCents: 2999.5 }, 'weekly_amount'], [{ weeklyBudgetCents: '3000' }, 'weekly_amount'],
    [{ weeklyBudgetCents: 30001 }, 'weekly_amount'], [{ targetDate: '2026-11-09' }, 'date'], [{ targetDate: '2026-02-30' }, 'date'], [{ targetDate: 'soon' }, 'date'],
  ];
  for (const [input, code] of bad) {
    assert.throws(() => e.planner.previewRemaining({ ...ids, ...input }), (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, 'invalid_plan_inputs');
      assert.deepEqual(error.issues.map((i) => i.code), [code], JSON.stringify(input));
      return true;
    });
  }
  assert.equal(e.planner.previewRemaining({ ...ids, targetDate: '2026-11-10' }).weeks, 1, 'exactly one week away is allowed');
  // Time passes: the saved date is now under a week away, so the preview asks for a new date instead of guessing one.
  e.setNow('2026-12-24T12:00:00');
  assert.throws(() => e.planner.previewRemaining(ids), (error) => {
    assert.match(error.issues[0].message, /saved target date \(Dec 29, 2026\) is less than a week away/);
    return true;
  });
  assert.equal(e.planner.previewRemaining({ ...ids, targetDate: '2027-01-26' }).weeks, 4);
});

test('calendar boundaries: local midnight, daylight saving, year end and leap day', () => {
  const e = env();
  e.setNow('2026-11-03T23:59:59');
  assert.equal(e.planner.previewRemaining(ids).schedule[0].date, '2026-11-10');
  e.setNow('2026-11-04T00:00:00');
  const next = e.planner.previewRemaining(ids);
  assert.equal(next.facts.today, '2026-11-04');
  assert.equal(next.schedule[0].date, '2026-11-11');
  assert.equal(next.weeks, 7);

  const goal = { id: 'goal_x', householdId: 'hh_x', name: 'Camping trip fund', targetCents: 30000, currency: 'USD', targetDate: '2027-04-17', weeklyBudgetCents: 3000 };
  const progress = { startingCents: 6000, confirmedNetCents: 0, progressCents: 6000 };
  const spring = previewRemainingPlan({ goal, progress, today: '2027-02-20' }); // US clocks change on Mar 14, 2027
  const gaps = spring.schedule.slice(1).map((w, i) => daysBetween(spring.schedule[i].date, w.date));
  assert.ok(gaps.every((g) => g === 7));
  assert.ok(spring.schedule.some((w) => w.date === '2027-03-13') && spring.schedule.some((w) => w.date === '2027-03-20'));
  assert.ok(spring.schedule.every((w) => new Date(`${w.date}T00:00:00Z`).getUTCDay() === 6), 'every week falls on the same weekday');

  const yearEnd = previewRemainingPlan({ goal: { ...goal, targetDate: '2027-01-12' }, progress, today: '2026-12-22' });
  assert.deepEqual(yearEnd.schedule.map((w) => w.date), ['2026-12-29', '2027-01-05', '2027-01-12']);

  const leap = previewRemainingPlan({ goal: { ...goal, targetDate: '2028-04-11' }, progress, today: '2028-02-15' });
  assert.equal(leap.schedule[1].date, '2028-02-29');
  assert.equal(leap.schedule[2].date, '2028-03-07');
});

// ---------------------------------------------------------------- HTTP contract ----

async function startServer() {
  const db = openDatabase(':memory:');
  const app = createApp({ config: loadConfig({}, { root }), db, clock: createClock(FIXED_NOW), root });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const response = await fetch(base + path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, json: await response.json() };
  };
  return { db, call, close: () => new Promise((r) => { server.close(r); db.close(); }) };
}

test('HTTP: state flags a stale proposal, accept refuses it with reasons, and the preview route is read-only', async () => {
  const s = await startServer();
  try {
    await s.call('POST', '/api/setup', { playMode: 'family', name: 'House of Alder', crest: { field: 'cobalt', charge: 'stag' } });
    const proposed = (await s.call('POST', '/api/plans/rules', { commitments: [] })).json;
    assert.equal(proposed.state.planReview.needsRefresh, false);
    await s.call('POST', '/api/example/contributions', { householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, amountCents: 1500, approverId: 'm_rowan', approvalConfirmed: true, requestId: 'http-plan-1' });
    const state = (await s.call('GET', '/api/state')).json;
    assert.equal(state.planReview.planId, proposed.plan.id);
    assert.equal(state.planReview.needsRefresh, true);
    assert.deepEqual(state.planReview.changes.map((c) => c.code), ['contributions', 'progress']);

    const before = snapshot(s.db);
    const refused = await s.call('POST', `/api/plans/${proposed.plan.id}/accept`, {});
    assert.equal(refused.status, 409);
    assert.equal(refused.json.error.code, 'plan_stale');
    assert.equal(refused.json.error.issues.length, 2);
    const preview = await s.call('POST', '/api/plans/preview', { weeklyBudgetCents: 2000 });
    assert.equal(preview.status, 200);
    assert.equal(preview.json.status, 'ok');
    assert.equal(preview.json.preview.outcome, 'short');
    assert.equal(preview.json.preview.reach.date, '2027-01-26');
    assert.equal(preview.json.preview.facts.factsRevision, state.planReview.factsRevision);
    assert.equal(preview.json.state, undefined, 'a preview returns no new state because nothing changed');
    const invalid = await s.call('POST', '/api/plans/preview', { weeklyBudgetCents: -5, targetDate: '2026-11-04' });
    assert.equal(invalid.status, 400);
    assert.deepEqual(invalid.json.error.issues.map((i) => i.code), ['weekly_amount', 'date']);
    assert.deepEqual(snapshot(s.db), before);

    const fresh = (await s.call('POST', '/api/plans/rules', { commitments: [] })).json;
    const accepted = await s.call('POST', `/api/plans/${fresh.plan.id}/accept`, {});
    assert.equal(accepted.status, 200);
    assert.equal(accepted.json.state.acceptedPlanId, fresh.plan.id);
    assert.equal(accepted.json.state.plan.totals.remainingCents, 22500);
  } finally { await s.close(); }
});
