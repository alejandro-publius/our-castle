import test from 'node:test';
import assert from 'node:assert/strict';
import { createMerchant } from '../../server/merchant/channel3.mjs';
import { createFakeChannel3, fakeProduct, fakeSearchResponse } from '../helpers/fake-channel3.mjs';
import { familyWith, mutableClock, startServer } from '../helpers/family-http.mjs';

// The family's reviewed choice carried into a saved weekly schedule, over real HTTP in family mode. The merchant is the real
// Channel3 code over a FAKE transport whose tents are invented test data. The figures are the task's example:
// - today Nov 8, 2026, so week 1 is Nov 15 and the Dec 20 date is week 6;
// - $60.00 tracked, a household weekly amount of $30.00, and offers of $20.00 (Rowan) and $10.00 (Ash);
// - the $150.00 tent, with a one-off $90.00 tried.
const TENTS = [['fakeTentA', 'Test fixture: Two-person tent', 120], ['fakeTentB', 'Test fixture: Four-person tent', 150], ['fakeTentC', 'Test fixture: Six-person tent', 180]];
const product = ([id, title, price]) => fakeProduct({ id, title,
  offers: [{ url: `https://buy.trychannel3.com/fake/${id}`, domain: 'example-outfitter.com', price: { price, currency: 'USD' }, availability: 'InStock', condition: 'new' }] });
const catalog = () => createFakeChannel3(() => fakeSearchResponse(TENTS.map(product)));

async function family() {
  const fake = catalog();
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

// What the page sends for the reviewed goal draft: the reviewed amount, date and weekly amount, and the unchanged starting report.
const draftGoal = (review, startingCents) => ({ name: 'Four-person tent', targetCents: review.goal.targetCents, startingCents, weeklyBudgetCents: review.goal.weeklyBudgetCents, targetDate: review.goal.targetDate });
const EXPECTED = [['2026-11-15', 0], ['2026-11-22', 0], ['2026-11-29', 0], ['2026-12-06', 3000], ['2026-12-13', 3000], ['2026-12-20', 3000]];

test('reproduction: the one-off $90.00 an adult reviewed reaches the accepted weekly schedule', async () => {
  const f = await family();
  const { owner } = f;
  try {
    const before = await f.state();
    const tent = f.choice(TENTS[1][1]);
    const reviewed = await owner.call('POST', '/api/family-choices/review', { choiceId: tent.id, revision: before.familyChoices.revision, reserveCents: 9000 });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.json));
    const review = reviewed.json;
    // The comparison the adult reviewed gives the first three weeks to the expense, then $30.00 a week to the tent.
    assert.equal(review.reserveCents, 9000);
    assert.deepEqual(review.option.segments.map((s) => [s.fromDate, s.toDate, s.goalCents, s.reservedCents, s.perMember.map((p) => p.cents)]),
      [['2026-11-15', '2026-11-29', 0, 3000, [0, 0]], ['2026-12-06', '2026-12-20', 3000, 0, [2000, 1000]]]);
    assert.deepEqual(review.goal, { targetCents: 15000, targetDate: '2026-12-20', weeklyBudgetCents: 3000 });

    // The page's path after this review: "Save as our goal" from the family choice, then its plan button, then "Use this plan".
    const saved = await owner.call('POST', '/api/merchant/goal', { draftId: review.item.draftId, goalId: before.goal.id, expectedGoalRevision: before.merchantGoalRevision,
      goal: draftGoal(review, before.progress.startingCents), familyChoice: { choiceId: review.choiceId, revision: review.revision } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const afterSave = saved.json.state;
    const proposed = await owner.call('POST', '/api/plans', { goal: draftGoal(review, afterSave.progress.startingCents), commitments: [], expectedGoalRevision: afterSave.merchantGoalRevision });
    assert.equal(proposed.status, 200, JSON.stringify(proposed.json));
    const accepted = await owner.call('POST', `/api/plans/${proposed.json.plan.id}/accept`, {});
    assert.equal(accepted.status, 200, JSON.stringify(accepted.json));

    // The accepted weeks must keep the reviewed expense: nothing to the goal in weeks 1-3, then $30.00 a week.
    const now = accepted.json.state;
    assert.deepEqual(now.plan.contributions.map((c) => [c.date, c.amountCents]), EXPECTED);
    assert.deepEqual(now.nextStep && [now.nextStep.week, now.nextStep.date, now.nextStep.plannedCents], [4, '2026-12-06', 3000]);
  } finally {
    await f.s.close();
  }
});
