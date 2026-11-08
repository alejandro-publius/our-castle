import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { createMerchant } from '../../server/merchant/channel3.mjs';
import { createFakeChannel3, fakeProduct, fakeSearchResponse } from '../helpers/fake-channel3.mjs';
import { browser, familyWith, mutableClock, startServer } from '../helpers/family-http.mjs';

// The family's reviewed choice carried into a saved weekly schedule, over real HTTP in family mode. The merchant is the real
// Channel3 code over a FAKE transport whose tents are invented test data. The figures are the task's example:
// - today Nov 8, 2026, so week 1 is Nov 15 and the Dec 20 date is week 6;
// - $60.00 tracked, a household weekly amount of $30.00, and offers of $20.00 (Rowan) and $10.00 (Ash);
// - the $150.00 tent, with a one-off $90.00 tried.
// Expected cents, dates and shares are written out here, not computed by the code under test.
const root = fileURLToPath(new URL('../../', import.meta.url));
const TENTS = [['fakeTentA', 'Test fixture: Two-person tent', 120], ['fakeTentB', 'Test fixture: Four-person tent', 150], ['fakeTentC', 'Test fixture: Six-person tent', 180]];
const product = ([id, title, price]) => fakeProduct({ id, title,
  offers: [{ url: `https://buy.trychannel3.com/fake/${id}`, domain: 'example-outfitter.com', price: { price, currency: 'USD' }, availability: 'InStock', condition: 'new' }] });
// A search returns the three tents; a product look-up (the explicit "Check price") returns the current price.
function catalog(prices = new Map()) {
  return createFakeChannel3((url) => {
    const lookup = /\/v1\/products\/([^?]+)/.exec(url);
    if (lookup) { const t = TENTS.find(([id]) => id === decodeURIComponent(lookup[1])); return product([t[0], t[1], prices.get(t[0]) ?? t[2]]); }
    return fakeSearchResponse(TENTS.map(product));
  });
}
const DAY = 86_400_000;
// Every money record, row by row (not just totals): no planning request may change one.
const MONEY_TABLES = ['payment_orders', 'payment_captures', 'payment_refunds', 'deferred_refunds', 'order_checks', 'ledger_entries', 'webhook_events'];
const money = (db) => JSON.stringify(MONEY_TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
const deeds = (db) => db.prepare('SELECT key FROM achievements ORDER BY key').all().map((r) => r.key);
const goalRows = (db) => JSON.stringify([db.prepare('SELECT * FROM goals').all(), db.prepare('SELECT * FROM goal_items').all()]);
const planRows = (db) => db.prepare('SELECT id, source, status, plan_json, basis_json, inputs_json FROM plans ORDER BY rowid').all();
const weeksOf = (plan) => plan.contributions.map((c) => [c.date, c.amountCents]);
const sharesOf = (plan) => plan.family.weeks.map((w) => [w.date, w.goalCents, w.reservedCents, w.perMember.map((p) => p.cents)]);
const EXPECTED = [['2026-11-15', 0], ['2026-11-22', 0], ['2026-11-29', 0], ['2026-12-06', 3000], ['2026-12-13', 3000], ['2026-12-20', 3000]];
const EXPECTED_SHARES = [['2026-11-15', 0, 3000, [0, 0]], ['2026-11-22', 0, 3000, [0, 0]], ['2026-11-29', 0, 3000, [0, 0]],
  ['2026-12-06', 3000, 0, [2000, 1000]], ['2026-12-13', 3000, 0, [2000, 1000]], ['2026-12-20', 3000, 0, [2000, 1000]]];

async function family({ prices } = {}) {
  const fake = catalog(prices);
  const clock = mutableClock('2026-11-08T12:00:00');
  const s = await startServer({ clock, merchant: createMerchant({ apiKey: 'test-key-not-real', fetch: fake.fetch, clock }) });
  const people = await familyWith(s, [['Ash', 'adult'], ['Wren', 'child']]);
  const { owner } = people;
  const state = async (b = owner) => (await b.call('GET', '/api/state')).json;
  const goal = await owner.call('PUT', '/api/goal', { name: 'Camping gear', targetCents: 30000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-20', expectedGoalRevision: (await state()).merchantGoalRevision });
  assert.equal(goal.status, 200, JSON.stringify(goal.json));
  assert.equal((await owner.call('PUT', '/api/family-choices/offer', { weeklyCents: 2000 })).status, 200);
  assert.equal((await people.Ash.call('PUT', '/api/family-choices/offer', { weeklyCents: 1000 })).status, 200);
  const found = (await owner.call('POST', '/api/merchant/search', { query: 'tent' })).json;
  for (const r of found.results) assert.equal((await owner.call('POST', '/api/family-choices', { draftId: r.draftId, expectedGoalId: found.goalId })).json.outcome, 'added');
  const choices = (await state()).familyChoices.choices;
  return { s, fake, clock, ...people, state, choice: (title) => choices.find((c) => c.title === title) };
}
async function review(f, title, reserveCents, b = f.owner) {
  const st = await f.state(b);
  const r = await b.call('POST', '/api/family-choices/review', { choiceId: f.choice(title).id, revision: st.familyChoices.revision, reserveCents });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { review: r.json, before: st };
}
// What the page sends for the reviewed goal draft: the reviewed amount, date and weekly amount, and the unchanged starting report.
const draftGoal = (r, over = {}) => ({ name: 'Four-person tent', targetCents: r.goal.targetCents, startingCents: r.startingCents, weeklyBudgetCents: r.goal.weeklyBudgetCents, targetDate: r.goal.targetDate, ...over });
const saveBody = ({ review: r, before }, { goal = {}, schedule } = {}) => ({ draftId: r.item.draftId, goalId: before.goal.id, expectedGoalRevision: before.merchantGoalRevision,
  goal: draftGoal(r, goal), familyChoice: { choiceId: r.choiceId, revision: r.revision }, ...(schedule === undefined ? { schedule: { reserveCents: r.reserveCents, revision: r.schedule.revision } } : schedule === null ? {} : { schedule }) });
async function acceptedFamilyPlan(f) {
  const reviewed = await review(f, TENTS[1][1], 9000);
  const saved = await f.owner.call('POST', '/api/merchant/goal', saveBody(reviewed));
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const accepted = await f.owner.call('POST', `/api/plans/${saved.json.plan.id}/accept`, {});
  assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
  return { reviewed, saved: saved.json, accepted: accepted.json };
}

test('reproduction, now passing: the one-off $90.00 an adult reviewed reaches the accepted weekly schedule, with each adult’s share', async () => {
  const f = await family();
  const { s, owner, Ash: ash, Wren: wren } = f;
  try {
    const ledger = money(s.db), deedsBefore = deeds(s.db);
    const reviewed = await review(f, TENTS[1][1], 9000);
    const r = reviewed.review;
    // The review is read-only and now carries the dated weeks it would propose, with each adult's share.
    assert.equal(r.reserveCents, 9000);
    assert.deepEqual(r.option.segments.map((seg) => [seg.fromDate, seg.toDate, seg.goalCents, seg.reservedCents, seg.perMember.map((p) => p.cents)]),
      [['2026-11-15', '2026-11-29', 0, 3000, [0, 0]], ['2026-12-06', '2026-12-20', 3000, 0, [2000, 1000]]]);
    assert.deepEqual(r.goal, { targetCents: 15000, targetDate: '2026-12-20', weeklyBudgetCents: 3000 });
    assert.deepEqual(r.schedule.rows.map((w) => [w.date, w.goalCents, w.reservedCents, w.perMember.map((p) => p.cents)]), EXPECTED_SHARES);
    assert.deepEqual([r.schedule.outcome, r.schedule.plannedCents, r.schedule.shortfallCents, r.schedule.finishDate, r.schedule.proposable], ['on_time', 9000, 0, '2026-12-20', true]);
    assert.match(r.schedule.revision, /^fs1_[0-9a-f]{32}$/);
    assert.deepEqual([planRows(s.db).length, money(s.db)], [0, ledger]);

    // "Save goal and propose this schedule": the existing goal save and the reviewed schedule as a PROPOSAL, together.
    const saved = await owner.call('POST', '/api/merchant/goal', saveBody(reviewed));
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const plan = saved.json.plan;
    assert.deepEqual([plan.status, plan.kind, plan.source, plan.sourceLabel, plan.provider, plan.model],
      ['proposed', 'family', 'rules', 'Family schedule (built-in arithmetic from your family’s offers, no AI)', null, null]);
    assert.deepEqual(weeksOf(plan), EXPECTED);
    assert.deepEqual(sharesOf(plan), EXPECTED_SHARES);
    assert.deepEqual(plan.family.offers, [{ memberId: plan.family.offers[0].memberId, name: 'Rowan', weeklyCents: 2000 }, { memberId: plan.family.offers[1].memberId, name: 'Ash', weeklyCents: 1000 }]);
    assert.deepEqual([plan.family.reserveCents, plan.family.capacityCents, plan.family.householdLimitCents, plan.family.finishDate, plan.family.revision], [9000, 3000, 3000, '2026-12-20', r.schedule.revision]);
    assert.deepEqual(plan.family.choice, { id: r.choiceId, title: TENTS[1][1], merchant: 'example-outfitter.com', priceCents: 15000, currency: 'USD' });
    assert.deepEqual(plan.totals, { plannedCents: 9000, shortfallCents: 0, feasible: true, remainingCents: 9000 });
    assert.equal(plan.headline, 'After the one-off $90.00, three weeks of $30.00 reach the Castle');
    assert.equal(plan.summary, 'You\'ve tracked $60.00 of your $150.00 Four-person tent. This family schedule covers the remaining $90.00 by Dec 20, 2026, after the one-off $90.00 you entered takes the first three weeks.');
    assert.deepEqual(plan.explanation, [
      'Goal $150.00 − tracked progress $60.00 = $90.00 still to save.',
      'Each week up to $30.00 can go to the goal: the lower of the household’s weekly amount ($30.00) and the adults’ own offers (Rowan $20.00 + Ash $10.00 = $30.00).',
      'The one-off $90.00 comes out of weeks 1–3 (Nov 15–Nov 29) first, once. It is not taken from tracked progress and not repeated.',
      'Each week’s goal amount is split between the adults in proportion to their offers, in whole cents (leftover cents go to the largest remainders). No one’s share is above their own offer.',
      'The schedule totals $90.00, so the shortfall is $0.00.',
    ]);
    assert.deepEqual(plan.contributions.map((c) => c.note), ['This week’s $30.00 goes to the one-off expense.', 'This week’s $30.00 goes to the one-off expense.', 'This week’s $30.00 goes to the one-off expense.', '', '', '']);
    assert.ok(plan.cautions.some((c) => c.includes('Not an AI plan')) && plan.cautions.some((c) => c.includes('Nothing is held or set aside in the app')));
    // Saving proposes only: nothing is in use, so there is no next contribution yet.
    let st = saved.json.state;
    assert.deepEqual([st.plan.id, st.acceptedPlanId, st.nextStep, st.treasury.week.plannedCents], [plan.id, null, null, null]);
    assert.deepEqual([st.goal.targetCents, st.goal.targetDate, st.goal.weeklyBudgetCents], [15000, '2026-12-20', 3000]);
    // The goal save's own deeds, exactly as the plain "Save as our goal" records them: the $60.00 already tracked was 20% of
    // $300.00 (porch, 10%) and is 40% of $150.00, so the Manor (25%) and market (40%) are recorded. The proposal adds none,
    // and no money record changed.
    assert.deepEqual([deedsBefore, deeds(s.db)], [['estate:porch'], ['estate:market', 'estate:porch', 'tier:1']]);
    assert.equal(money(s.db), ledger);

    // "Use this plan" puts it in use. The next positive contribution is week 4, Dec 6, $30.00: never a $0 week or an invented charge.
    const accepted = await owner.call('POST', `/api/plans/${plan.id}/accept`, {});
    assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
    st = accepted.json.state;
    assert.deepEqual(weeksOf(st.plan), EXPECTED);
    assert.deepEqual([st.acceptedPlanId, st.nextStep], [plan.id, { week: 4, date: '2026-12-06', plannedCents: 3000, dueCents: 3000, contributedSinceCents: 0 }]);
    // The Treasury's week (Nov 2-8) has no dated contribution; its milestones follow the accepted amounts (Keep on Dec 6).
    assert.deepEqual([st.treasury.week.start, st.treasury.week.plannedCents], ['2026-11-02', 0]);
    assert.deepEqual(st.plan.projections.map((p) => [p.key, p.reached, p.week, p.date]), [['manor', true, 0, null], ['keep', false, 4, '2026-12-06'], ['castle', false, 6, '2026-12-20']]);
    // Every member, child included, reads the same accepted schedule and shares.
    for (const b of [ash, wren]) {
      const theirs = await f.state(b);
      assert.deepEqual([theirs.acceptedPlanId, weeksOf(theirs.plan), sharesOf(theirs.plan), theirs.nextStep.date], [plan.id, EXPECTED, EXPECTED_SHARES, '2026-12-06']);
    }
    assert.deepEqual([deeds(s.db), money(s.db)], [['estate:market', 'estate:porch', 'tier:1'], ledger]);

    // The ordinary built-in plan is unchanged: it knows nothing about the expense and says nothing about it. Proposing one
    // leaves the accepted family schedule in use until someone chooses "Use this plan" again.
    const ordinary = await owner.call('POST', '/api/plans/rules', {});
    assert.equal(ordinary.status, 200, JSON.stringify(ordinary.json));
    assert.deepEqual([weeksOf(ordinary.json.plan).map(([, c]) => c), ordinary.json.plan.kind, ordinary.json.plan.family, ordinary.json.plan.sourceLabel],
      [[1500, 1500, 1500, 1500, 1500, 1500], undefined, undefined, 'Example plan (built-in rules, no AI)']);
    assert.deepEqual([ordinary.json.state.acceptedPlanId, ordinary.json.state.nextStep.date], [plan.id, '2026-12-06']);
  } finally {
    await s.close();
  }
});

test('reload and a clock advance keep the accepted weeks pinned; the one-off is not taken again and a new proposal needs it entered again', async () => {
  const f = await family();
  const { s, owner, Ash: ash } = f;
  try {
    const { saved } = await acceptedFamilyPlan(f);
    const id = saved.plan.id;
    const stored = JSON.stringify(planRows(s.db).find((p) => p.id === id));
    // A week later (a reserved week): the dated weeks and shares are the same, and the Treasury plans $0 this week.
    f.clock.advance(7 * DAY);
    assert.equal((await owner.call('GET', '/api/state')).status, 401, 'the old session has expired');
    assert.equal((await owner.signIn()).done.status, 200);
    let st = await f.state();
    assert.deepEqual([st.acceptedPlanId, weeksOf(st.plan), sharesOf(st.plan)], [id, EXPECTED, EXPECTED_SHARES]);
    assert.deepEqual(st.nextStep, { week: 4, date: '2026-12-06', plannedCents: 3000, dueCents: 3000, contributedSinceCents: 0 });
    assert.deepEqual([st.treasury.week.start, st.treasury.week.plannedCents], ['2026-11-09', 0]);
    // An accepted plan stays in use as history: a new day is reported, never applied to it.
    assert.deepEqual([st.planReview.status, st.planReview.factsChanged, st.planReview.needsRefresh], ['accepted', true, false]);
    assert.equal(JSON.stringify(planRows(s.db).find((p) => p.id === id)), stored);

    // Dec 1: the Treasury's week (Nov 30-Dec 6) holds week 4's $30.00. A simulated $30.00 contribution moves the next step to
    // week 5 from the same stored weeks; nothing is recomputed from the new date.
    f.clock.advance(16 * DAY);
    assert.equal((await owner.signIn()).done.status, 200);
    st = await f.state();
    assert.deepEqual([st.treasury.week.start, st.treasury.week.plannedCents], ['2026-11-30', 3000]);
    const ownerId = st.access.me.memberId;
    const paid = await owner.call('POST', '/api/example/contributions', { amountCents: 3000, approverId: ownerId, approvalConfirmed: true, requestId: 'schedule-week-4', outcome: 'completed' });
    assert.equal(paid.status, 200, JSON.stringify(paid.json));
    st = paid.json.state;
    assert.deepEqual([weeksOf(st.plan), st.nextStep], [EXPECTED, { week: 5, date: '2026-12-13', plannedCents: 3000, dueCents: 3000, contributedSinceCents: 3000 }]);
    assert.equal(JSON.stringify(planRows(s.db).find((p) => p.id === id)), stored);

    // A later family schedule is a new, explicit proposal. Its one-off amount is whatever the adult enters now (here none);
    // the earlier $90.00 is not carried over or assumed paid. The accepted schedule stays in use until it is chosen.
    assert.equal((await ash.signIn()).done.status, 200);
    const fresh = await ash.call('POST', '/api/plans/family', { reserveCents: 0, revision: st.familyChoices.revision });
    assert.equal(fresh.status, 200, JSON.stringify(fresh.json));
    assert.deepEqual([fresh.json.plan.family.reserveCents, weeksOf(fresh.json.plan)], [0, [['2026-12-08', 3000], ['2026-12-15', 3000]]]);
    assert.deepEqual(sharesOf(fresh.json.plan).map((w) => w[3]), [[2000, 1000], [2000, 1000]]);
    assert.deepEqual([fresh.json.state.plan.id, fresh.json.state.acceptedPlanId, fresh.json.state.nextStep.week], [fresh.json.plan.id, id, 5]);
    assert.equal(JSON.stringify(planRows(s.db).find((p) => p.id === id)), stored);
  } finally {
    await s.close();
  }
});

test('only adults propose and accept; a child, another family, an impersonation, a signed-out or expired session and bad input write nothing', async () => {
  const f = await family();
  const other = await familyWith(f.s); // a separate household on the same server
  const { s, owner, Ash: ash, Wren: wren } = f;
  try {
    const reviewed = await review(f, TENTS[1][1], 9000);
    const st = reviewed.before;
    const theirs = (await other.owner.call('GET', '/api/state')).json;
    const snapshot = () => JSON.stringify([money(s.db), goalRows(s.db), planRows(s.db), deeds(s.db)]);
    const before = snapshot();
    const ownerId = st.access.me.memberId;
    for (const [b, method, url, body, status, code] of [
      [wren, 'POST', '/api/plans/family', { reserveCents: 9000, revision: st.familyChoices.revision }, 403, 'adult_required'],
      [wren, 'POST', '/api/merchant/goal', saveBody(reviewed), 403, 'adult_required'],
      [ash, 'POST', '/api/plans/family', { reserveCents: 9000, revision: st.familyChoices.revision, memberId: ownerId }, 403, 'member_mismatch'],
      [ash, 'POST', '/api/merchant/goal', { ...saveBody(reviewed), memberId: ownerId }, 403, 'member_mismatch'],
      [other.owner, 'POST', '/api/plans/family', { reserveCents: 0, revision: st.familyChoices.revision, goalId: st.goal.id }, 403, 'scope_mismatch'],
      [other.owner, 'POST', '/api/plans/family', { reserveCents: 0, revision: st.familyChoices.revision, householdId: st.household.id }, 403, 'scope_mismatch'],
      [other.owner, 'POST', '/api/merchant/goal', { ...saveBody(reviewed), goalId: theirs.goal.id }, 410, 'merchant_draft_expired'],
      [owner, 'POST', '/api/plans/family', { reserveCents: -1, revision: st.familyChoices.revision }, 400, 'invalid_one_off'],
      [owner, 'POST', '/api/plans/family', { reserveCents: 9000.5, revision: st.familyChoices.revision }, 400, 'invalid_one_off'],
      [owner, 'POST', '/api/plans/family', { reserveCents: '9000', revision: st.familyChoices.revision }, 400, 'invalid_one_off'],
      [owner, 'POST', '/api/plans/family', { reserveCents: 10_000_001, revision: st.familyChoices.revision }, 400, 'invalid_one_off'],
      [owner, 'POST', '/api/plans/family', { reserveCents: 9000 }, 409, 'choices_changed'],
      [owner, 'POST', '/api/plans/family', { reserveCents: 9000, revision: 'fc1_not_current' }, 409, 'choices_changed'],
      [owner, 'POST', '/api/merchant/goal', saveBody(reviewed, { schedule: { reserveCents: 9000, revision: 'fs1_not_reviewed' } }), 409, 'schedule_changed'],
      [owner, 'POST', '/api/merchant/goal', { ...saveBody(reviewed), schedule: null }, 400, 'invalid_schedule'],
      [owner, 'POST', '/api/merchant/goal', { ...saveBody(reviewed), familyChoice: undefined }, 400, 'invalid_schedule'],
    ]) {
      const r = await b.call(method, url, body);
      assert.deepEqual([r.status, r.json?.error?.code], [status, code], `${method} ${url} ${JSON.stringify(body).slice(0, 120)}`);
    }
    assert.equal(snapshot(), before, 'no refused request wrote anything');
    // A proposal that does exist: a child and another family still cannot use it, and a family schedule is not hand-edited.
    const proposed = await owner.call('POST', '/api/plans/family', { reserveCents: 9000, revision: st.familyChoices.revision });
    assert.equal(proposed.status, 200, JSON.stringify(proposed.json));
    const planId = proposed.json.plan.id;
    assert.deepEqual([(await wren.call('POST', `/api/plans/${planId}/accept`, {})).json.error.code], ['adult_required']);
    assert.deepEqual([(await other.owner.call('POST', `/api/plans/${planId}/accept`, {})).status], [404]);
    const edit = await owner.call('PUT', `/api/plans/${planId}`, { amounts: [0, 0, 0, 0, 0, 0] });
    assert.deepEqual([edit.status, edit.json.error.code], [409, 'family_schedule_fixed']);
    assert.equal((await f.state()).acceptedPlanId, null);
    // No session, no CSRF token or an ended session: refused before any work.
    assert.equal((await browser(s.origin).call('POST', '/api/plans/family', { reserveCents: 0 })).status, 401);
    assert.equal((await owner.call('POST', `/api/plans/${planId}/accept`, {}, { csrf: false })).json.error.code, 'csrf_failed');
    f.clock.advance(31 * 60_000);
    assert.equal((await ash.call('POST', `/api/plans/${planId}/accept`, {})).json.error.code, 'session_expired');
    assert.deepEqual(planRows(s.db).map((p) => [p.id, p.status]), [[planId, 'proposed']]);
  } finally {
    await s.close();
  }
});

test('a proposal is refused at "Use this plan" once a price, an offer, a member, the goal or progress changes; a refused save is undone whole', async () => {
  const prices = new Map();
  const f = await family({ prices });
  const { s, owner, Ash: ash } = f;
  try {
    const accept = async (planId) => { const r = await owner.call('POST', `/api/plans/${planId}/accept`, {}); return [r.status, r.json?.error?.code, (r.json?.error?.issues ?? []).map((i) => i.code)]; };
    // A refused "Save goal and propose this schedule" leaves neither half: no goal change, no item, no plan, no deed.
    const reviewed = await review(f, TENTS[1][1], 9000);
    const untouched = JSON.stringify([goalRows(s.db), planRows(s.db), deeds(s.db), money(s.db)]);
    for (const [body, code] of [
      [saveBody(reviewed, { goal: { targetCents: 16000 } }), 'schedule_changed'], // the adult raised the amount for tax: not what was reviewed
      [saveBody(reviewed, { goal: { targetDate: '2027-01-03' } }), 'schedule_changed'],
      [saveBody(reviewed, { schedule: { reserveCents: 0, revision: reviewed.review.schedule.revision } }), 'schedule_changed'],
    ]) {
      const r = await owner.call('POST', '/api/merchant/goal', body);
      assert.deepEqual([r.status, r.json.error.code], [409, code]);
      assert.equal(JSON.stringify([goalRows(s.db), planRows(s.db), deeds(s.db), money(s.db)]), untouched);
    }
    // An offer changed after the review: the save is refused before anything is written.
    assert.equal((await ash.call('PUT', '/api/family-choices/offer', { weeklyCents: 1200 })).status, 200);
    assert.equal((await owner.call('POST', '/api/merchant/goal', saveBody(reviewed))).json.error.code, 'choices_changed');
    assert.equal(JSON.stringify([goalRows(s.db), planRows(s.db), deeds(s.db), money(s.db)]), untouched);
    assert.equal((await ash.call('PUT', '/api/family-choices/offer', { weeklyCents: 1000 })).status, 200);

    // 1. The price of the choice it came from changes after an explicit check: refused.
    const again = await review(f, TENTS[1][1], 9000);
    const p1 = (await owner.call('POST', '/api/merchant/goal', saveBody(again))).json.plan;
    prices.set('fakeTentB', 160);
    const checked = await owner.call('POST', '/api/family-choices/refresh', { choiceId: f.choice(TENTS[1][1]).id });
    assert.deepEqual([checked.json.usable, checked.json.priceCents], [true, 16000]);
    const stale = (await f.state()).planReview;
    assert.deepEqual([stale.needsRefresh, stale.changes.map((c) => c.message)], [true, ['Test fixture: Four-person tent now shows $160.00; this schedule used $150.00.']]);
    assert.deepEqual(await accept(p1.id), [409, 'plan_stale', ['price_changed']]);
    prices.delete('fakeTentB');
    await owner.call('POST', '/api/family-choices/refresh', { choiceId: f.choice(TENTS[1][1]).id });

    // 2. An adult changes their offer: refused, with the change named.
    const revision = async () => (await f.state()).familyChoices.revision;
    const p2 = (await owner.call('POST', '/api/plans/family', { reserveCents: 9000, revision: await revision() })).json.plan;
    assert.deepEqual(weeksOf(p2), EXPECTED);
    assert.equal((await ash.call('PUT', '/api/family-choices/offer', { weeklyCents: 1200 })).status, 200);
    assert.deepEqual(await accept(p2.id), [409, 'plan_stale', ['offer_changed']]);
    assert.deepEqual((await f.state()).planReview.changes.map((c) => c.message), ['Ash’s weekly offer changed from $10.00 to $12.00.']);
    assert.equal((await ash.call('PUT', '/api/family-choices/offer', { weeklyCents: 1000 })).status, 200);

    // 3. An adult with an offer is removed from the family: their offer no longer counts, so the proposal is refused.
    const p3 = (await owner.call('POST', '/api/plans/family', { reserveCents: 9000, revision: await revision() })).json.plan;
    const ashId = (await f.state()).access.members.find((m) => m.name === 'Ash').id;
    assert.equal((await owner.call('POST', `/api/family/members/${ashId}/revoke`, {})).status, 200);
    assert.deepEqual(await accept(p3.id), [409, 'plan_stale', ['offer_ended']]);

    // 4. Rowan alone: the goal is edited after proposing. The goal edit sets every earlier plan aside, as it always has.
    const p4 = (await owner.call('POST', '/api/plans/family', { reserveCents: 9000, revision: await revision() })).json.plan;
    assert.deepEqual(sharesOf(p4).map((w) => [w[1], w[2], w[3]]), [[0, 2000, [0]], [0, 2000, [0]], [0, 2000, [0]], [0, 2000, [0]], [1000, 1000, [1000]], [2000, 0, [2000]]]);
    const st = await f.state();
    assert.equal((await owner.call('PUT', '/api/goal', { name: st.goal.name, targetCents: 15000, startingCents: 6000, weeklyBudgetCents: 2500, targetDate: '2026-12-20', expectedGoalRevision: st.merchantGoalRevision })).status, 200);
    assert.deepEqual(await accept(p4.id), [409, 'plan_superseded', []]);

    // 5. Progress changes (a simulated contribution): refused like any plan made from earlier progress.
    const p5 = (await owner.call('POST', '/api/plans/family', { reserveCents: 0, revision: await revision() })).json.plan;
    const paid = await owner.call('POST', '/api/example/contributions', { amountCents: 500, approverId: st.access.me.memberId, approvalConfirmed: true, requestId: 'schedule-stale-progress', outcome: 'completed' });
    assert.equal(paid.status, 200);
    assert.deepEqual(await accept(p5.id), [409, 'plan_stale', ['contributions', 'progress']]);
    assert.equal((await f.state()).acceptedPlanId, null, 'no stale proposal was put in use');
  } finally {
    await s.close();
  }
});

test('nothing to schedule is refused plainly, and the $180.00 choice offers a later date only in the reviewed draft, at the same offers', async () => {
  const f = await family();
  const { s, owner, Ash: ash } = f;
  try {
    const st = await f.state();
    const propose = async (reserveCents) => {
      const r = await owner.call('POST', '/api/plans/family', { reserveCents, revision: (await f.state()).familyChoices.revision });
      return [r.status, r.json?.error?.code ?? r.json.plan.kind];
    };
    // $300.00 goal: $240.00 to go and six weeks of $30.00. A one-off $180.00 takes every week up to Dec 20.
    assert.deepEqual(await propose(18000), [409, 'nothing_planned']);
    // $180.00 by Dec 20 with the one-off $90.00: $90.00 of the $120.00 is scheduled, $30.00 short, and no offer is raised.
    const c = await review(f, TENTS[2][1], 9000);
    assert.deepEqual([c.review.goal.targetDate, c.review.schedule.rows.map((w) => w.goalCents), c.review.schedule.outcome], ['2026-12-27', [0, 0, 0, 3000, 3000, 3000, 3000], 'on_time']);
    assert.deepEqual(c.review.schedule.rows.at(-1).perMember.map((p) => p.cents), [2000, 1000]);
    assert.equal((await owner.call('PUT', '/api/goal', { name: 'Six-person tent', targetCents: 18000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-20', expectedGoalRevision: st.merchantGoalRevision })).status, 200);
    const short = await owner.call('POST', '/api/plans/family', { reserveCents: 9000, revision: (await f.state()).familyChoices.revision });
    const plan = short.json.plan;
    assert.deepEqual([weeksOf(plan), plan.totals], [EXPECTED, { plannedCents: 9000, shortfallCents: 3000, feasible: false, remainingCents: 12000 }]);
    assert.equal(plan.headline, '$30.00 short by Dec 20, 2026');
    assert.ok(plan.cautions.includes('At these offers the earliest finish is Dec 27, 2026. A later date is the family’s choice to review; no one’s offer is raised.'));
    assert.deepEqual((await f.state()).familyChoices.offers.map((o) => o.weeklyCents), [2000, 1000]);
    // Tracked progress already covers a goal: nothing to schedule.
    let now = await f.state();
    assert.equal((await owner.call('PUT', '/api/goal', { name: 'Lantern', targetCents: 6000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-20', expectedGoalRevision: now.merchantGoalRevision })).status, 200);
    assert.deepEqual(await propose(0), [409, 'goal_reached']);
    // A household weekly amount of $0.00, then no offers at all.
    now = await f.state();
    assert.equal((await owner.call('PUT', '/api/goal', { name: 'Camping gear', targetCents: 30000, startingCents: 6000, weeklyBudgetCents: 0, targetDate: '2026-12-20', expectedGoalRevision: now.merchantGoalRevision })).status, 200);
    assert.deepEqual(await propose(0), [409, 'no_capacity']);
    now = await f.state();
    assert.equal((await owner.call('PUT', '/api/goal', { name: 'Camping gear', targetCents: 30000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-20', expectedGoalRevision: now.merchantGoalRevision })).status, 200);
    assert.equal((await owner.call('POST', '/api/family-choices/offer/withdraw', {})).status, 200);
    assert.equal((await ash.call('POST', '/api/family-choices/offer/withdraw', {})).status, 200);
    assert.deepEqual(await propose(0), [409, 'no_offers']);
    assert.equal((await ash.call('PUT', '/api/family-choices/offer', { weeklyCents: 1000 })).status, 200);
    // The goal's date is now less than a week away.
    f.clock.advance(37 * DAY);
    assert.equal((await owner.signIn()).done.status, 200);
    assert.deepEqual(await propose(0), [409, 'date_too_soon']);
    assert.deepEqual(planRows(s.db).map((p) => p.status), ['superseded'], 'only the one $180.00 proposal was written, later set aside by a goal edit');
  } finally {
    await s.close();
  }
});

test('example mode: the labelled example adult proposes and uses a family schedule; a child persona or a stranger cannot', async () => {
  const clock = mutableClock('2026-11-08T12:00:00');
  const db = openDatabase(':memory:');
  const app = createApp({ config: loadConfig({}, { root }), db, clock, root });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => { const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Origin: base }, body: body && JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
  try {
    let st = (await call('GET', '/api/state')).json;
    assert.equal((await call('PUT', '/api/goal', { name: 'Camping gear', targetCents: 15000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-20', expectedGoalRevision: st.merchantGoalRevision })).status, 200);
    assert.equal((await call('PUT', '/api/family-choices/offer', { weeklyCents: 2000, memberId: 'm_rowan' })).status, 200);
    st = (await call('GET', '/api/state')).json;
    const revision = st.familyChoices.revision;
    assert.equal((await call('POST', '/api/plans/family', { reserveCents: 4000, revision, memberId: 'm_wren' })).json.error.code, 'adult_required');
    assert.equal((await call('POST', '/api/plans/family', { reserveCents: 4000, revision, memberId: 'm_nobody' })).json.error.code, 'invalid_member');
    const proposed = await call('POST', '/api/plans/family', { reserveCents: 4000, revision, memberId: 'm_rowan' });
    assert.equal(proposed.status, 200, JSON.stringify(proposed.json));
    // One adult at $20.00 under the $30.00 household amount: $40.00 takes weeks 1-2, then $20.00 a week covers $80.00 of the
    // $90.00 by Dec 20, a truthful $10.00 short.
    assert.deepEqual(weeksOf(proposed.json.plan), [['2026-11-15', 0], ['2026-11-22', 0], ['2026-11-29', 2000], ['2026-12-06', 2000], ['2026-12-13', 2000], ['2026-12-20', 2000]]);
    assert.deepEqual(proposed.json.plan.totals, { plannedCents: 8000, shortfallCents: 1000, feasible: false, remainingCents: 9000 });
    const used = await call('POST', `/api/plans/${proposed.json.plan.id}/accept`, {});
    assert.deepEqual([used.status, used.json.state.nextStep.date, used.json.state.nextStep.plannedCents], [200, '2026-11-29', 2000]);
  } finally {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); db.close();
  }
});
