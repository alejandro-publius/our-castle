import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_WEEKS, compareChoices, describeComparison, familySchedule, scheduleLines, splitWeek, weeklyCapacity } from '../../src/core/family-choices.js';
import { formatCents } from '../../src/core/rules.js';

// Expected cents and dates are written from the task's example, not computed by the module:
// - today 2026-11-08, week 1 on Nov 15, tracked progress $60.00 and a household weekly amount of $30.00;
// - adult offers of $20.00 and $10.00, items at $120.00 / $150.00 / $180.00, and the goal's date Dec 20 (week 6).
// It is test data, not a family's result.
const money = (cents) => formatCents(cents, 'USD');
const OFFERS = [{ memberId: 'm_rowan', name: 'Rowan', weeklyCents: 2000 }, { memberId: 'm_ash', name: 'Ash', weeklyCents: 1000 }];
const ITEMS = [{ id: 'a', priceCents: 12000, currency: 'USD' }, { id: 'b', priceCents: 15000, currency: 'USD' }, { id: 'c', priceCents: 18000, currency: 'USD' }];
const BASE = { today: '2026-11-08', deadline: '2026-12-20', progressCents: 6000, householdLimitCents: 3000, currency: 'USD', offers: OFFERS, options: ITEMS };
const pick = (o) => [o.id, o.status, o.remainingCents, o.finishWeek, o.finishDate, o.shortfallCents];

test('the example: $60.00, $90.00 and $120.00 remain; 2, 3 and 4 weeks at $30.00 a week', () => {
  const c = compareChoices(BASE);
  assert.deepEqual([c.deadlineWeek, c.capacityCents, c.offeredCents, c.limitedBy], [6, 3000, 3000, 'both']);
  assert.deepEqual(c.options.map(pick), [
    ['a', 'fits', 6000, 2, '2026-11-22', 0],
    ['b', 'fits', 9000, 3, '2026-11-29', 0],
    ['c', 'fits', 12000, 4, '2026-12-06', 0],
  ]);
  // Each full week is split $20.00 and $10.00, the adults' own offers.
  assert.deepEqual(c.options[0].segments, [{ fromWeek: 1, toWeek: 2, fromDate: '2026-11-15', toDate: '2026-11-22', goalCents: 3000, reservedCents: 0,
    perMember: [{ memberId: 'm_rowan', cents: 2000 }, { memberId: 'm_ash', cents: 1000 }] }]);
});

test('a one-off $90.00 taken once from the first three weeks moves finishes to weeks 5, 6 and 7; the $180.00 item is $30.00 short', () => {
  const c = compareChoices({ ...BASE, reserveCents: 9000 });
  assert.deepEqual(c.reserve, { cents: 9000, weeks: 3, coveredWeek: 3, uncoveredCents: 0 });
  assert.deepEqual(c.options.map(pick), [
    ['a', 'fits', 6000, 5, '2026-12-13', 0],
    ['b', 'fits', 9000, 6, '2026-12-20', 0],
    ['c', 'late', 12000, 7, '2026-12-27', 3000],
  ]);
  assert.equal(c.options[2].weeksLate, 1);
  assert.deepEqual(c.options[0].segments.map((s) => [s.fromWeek, s.toWeek, s.goalCents, s.reservedCents, s.perMember.map((p) => p.cents)]), [
    [1, 3, 0, 3000, [0, 0]],
    [4, 5, 3000, 0, [2000, 1000]],
  ]);
  const text = describeComparison(c, { money, date: (iso) => iso, titles: { a: 'Tent A', b: 'Tent B', c: 'Tent C' } });
  assert.equal(text.reserve, 'Trying a one-off $90.00: it comes out of the first 3 weeks, once, before more goes to the goal. Recorded progress is not touched.');
  assert.equal(text.lines.c, 'Finishes 2026-12-27 (week 7): 1 week after 2026-12-20, $30.00 short by then.');
  assert.equal(text.lines.b, 'Finishes 2026-12-20 (week 6), on time for 2026-12-20.');
  assert.equal(text.choices, 'Still on time for 2026-12-20: Tent A ($120.00), Tent B ($150.00). Later: Tent C, finishing 2026-12-27.');
  assert.equal(text.capacity, 'Up to $30.00 a week can go to the goal: the lower of the household’s weekly amount ($30.00) and the adults’ offers ($30.00).');
});

test('each week splits by the offers in whole cents; leftover cents go to the largest remainders, never above an offer', () => {
  const two = [{ memberId: 'r', weeklyCents: 2000 }, { memberId: 'a', weeklyCents: 1000 }];
  const three = [{ memberId: 'x', weeklyCents: 1000 }, { memberId: 'y', weeklyCents: 1000 }, { memberId: 'z', weeklyCents: 1000 }];
  const cents = (split) => split.map((s) => s.cents);
  assert.deepEqual(cents(splitWeek(3000, two)), [2000, 1000]);
  assert.deepEqual(cents(splitWeek(1500, two)), [1000, 500]);
  assert.deepEqual(cents(splitWeek(500, two)), [333, 167]); // 333.33 and 166.67: the larger remainder gets the cent
  assert.deepEqual(cents(splitWeek(100, two)), [67, 33]);
  assert.deepEqual(cents(splitWeek(2000, three)), [667, 667, 666]); // equal remainders: earlier adults first
  assert.deepEqual(cents(splitWeek(1, three)), [1, 0, 0]);
  assert.deepEqual(cents(splitWeek(0, three)), [0, 0, 0]);
  assert.throws(() => splitWeek(3001, two), RangeError);
  assert.throws(() => splitWeek(12.5, two), RangeError);
  // Every total from 0 to 300 cents over offers of 150, 100 and 50: exact sums, no share above its offer.
  const small = [{ memberId: 'p', weeklyCents: 150 }, { memberId: 'q', weeklyCents: 100 }, { memberId: 'r', weeklyCents: 50 }];
  for (let total = 0; total <= 300; total++) {
    const split = cents(splitWeek(total, small));
    assert.equal(split.reduce((a, b) => a + b, 0), total, `total ${total}`);
    split.forEach((share, i) => assert.ok(share <= small[i].weeklyCents, `share ${i} of ${total}`));
  }
});

test('the household amount and the offers are each a ceiling, never added together', () => {
  const capped = compareChoices({ ...BASE, householdLimitCents: 2500 });
  assert.deepEqual([capped.capacityCents, capped.limitedBy], [2500, 'household']);
  assert.deepEqual(capped.options[0].segments[0].perMember.map((p) => p.cents), [1667, 833]);
  assert.deepEqual(capped.options.map((o) => o.finishWeek), [3, 4, 5]); // $60.00 / $25.00 → 3 weeks, $90.00 → 4, $120.00 → 5
  const offersLower = compareChoices({ ...BASE, householdLimitCents: 5000 });
  assert.deepEqual([offersLower.capacityCents, offersLower.limitedBy], [3000, 'offers']);
});

test('the last week takes exactly what remains', () => {
  const c = compareChoices({ ...BASE, options: [{ id: 'odd', priceCents: 12500, currency: 'USD' }] });
  const [o] = c.options;
  assert.deepEqual([o.remainingCents, o.finishWeek, o.finishDate], [6500, 3, '2026-11-29']);
  assert.deepEqual(o.segments.map((s) => [s.fromWeek, s.toWeek, s.goalCents, s.perMember.map((p) => p.cents)]), [[1, 2, 3000, [2000, 1000]], [3, 3, 500, [333, 167]]]);
});

test('no offers, a zero household amount or a price already covered by progress are said plainly', () => {
  const none = compareChoices({ ...BASE, offers: [] });
  assert.deepEqual([none.capacityCents, none.limitedBy], [0, 'no_offers']);
  assert.deepEqual(none.options.map((o) => [o.status, o.finishWeek, o.shortfallCents]), [['no_capacity', null, 6000], ['no_capacity', null, 9000], ['no_capacity', null, 12000]]);
  const zero = compareChoices({ ...BASE, householdLimitCents: 0 });
  assert.deepEqual([zero.capacityCents, zero.limitedBy, zero.options[0].status], [0, 'household', 'no_capacity']);
  const covered = compareChoices({ ...BASE, options: [{ id: 'small', priceCents: 5000, currency: 'USD' }, { id: 'equal', priceCents: 6000, currency: 'USD' }] });
  assert.deepEqual(covered.options.map((o) => [o.status, o.remainingCents, o.finishWeek, o.fits]), [['covered', 0, 0, true], ['covered', 0, 0, true]]);
  const text = describeComparison(none, { money, date: (iso) => iso });
  assert.equal(text.capacity, 'No adult has offered a weekly amount yet, so there is no finish date to show.');
  assert.equal(text.lines.a, 'No finish date until an adult offers a weekly amount.');
});

test('beyond the 52-week limit, a passed date, other currencies and uncovered one-off amounts', () => {
  const far = compareChoices({ ...BASE, options: [{ id: 'far', priceCents: 200000, currency: 'USD' }] });
  assert.deepEqual(pick(far.options[0]), ['far', 'beyond_limit', 194000, null, null, 176000]); // 6 weeks × $30.00 = $180.00 by the date
  assert.equal(MAX_WEEKS, 52);
  const passed = compareChoices({ ...BASE, deadline: '2026-11-01' });
  assert.deepEqual([passed.deadlineWeek, passed.deadlinePassed, passed.options[0].status, passed.options[0].shortfallCents], [0, true, 'late', 6000]);
  const euro = compareChoices({ ...BASE, options: [{ id: 'eur', priceCents: 12000, currency: 'EUR' }] });
  assert.deepEqual([euro.options[0].status, euro.options[0].remainingCents], ['not_comparable', null]);
  const huge = compareChoices({ ...BASE, reserveCents: 200000 }); // 52 × $30.00 = $1,560.00 < $2,000.00
  assert.deepEqual(huge.reserve, { cents: 200000, weeks: 52, coveredWeek: null, uncoveredCents: 44000 });
  assert.ok(huge.options.every((o) => o.status === 'beyond_limit'));
  // A one-off amount ending part-way through a week leaves the rest of that week to the goal.
  const partial = compareChoices({ ...BASE, reserveCents: 4500, options: [ITEMS[0]] });
  assert.deepEqual(partial.options[0].segments.map((s) => [s.fromWeek, s.toWeek, s.goalCents, s.reservedCents]), [[1, 1, 0, 3000], [2, 2, 1500, 1500], [3, 3, 3000, 0], [4, 4, 1500, 0]]);
  assert.equal(partial.options[0].finishWeek, 4);
  assert.deepEqual(weeklyCapacity({ householdLimitCents: 3000, offers: OFFERS, reserveCents: 4500, weeks: 3 }).available, [0, 1500, 3000]);
});

test('bad inputs are refused, and reading a comparison changes neither input', () => {
  for (const bad of [{ today: '2026-02-30' }, { reserveCents: -1 }, { reserveCents: 10_000_001 }, { offers: [{ memberId: 'x', weeklyCents: 99 }] },
    { offers: [OFFERS[0], OFFERS[0]] }, { options: [...ITEMS, ...ITEMS] }, { householdLimitCents: 12.5 }]) {
    assert.throws(() => compareChoices({ ...BASE, ...bad }), RangeError, JSON.stringify(bad));
  }
  const freeze = (v) => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
  const input = freeze(structuredClone({ ...BASE, reserveCents: 9000 }));
  const before = JSON.stringify(input);
  compareChoices(input);
  assert.equal(JSON.stringify(input), before);
});

test('an expense comparison keeps the original finish so the family can see the delay without clearing the trial', () => {
  const c = compareChoices({ ...BASE, reserveCents: 9000 });
  assert.deepEqual(c.options.map((o) => o.withoutReserve), [
    { status: 'fits', finishWeek: 2, finishDate: '2026-11-22' },
    { status: 'fits', finishWeek: 3, finishDate: '2026-11-29' },
    { status: 'fits', finishWeek: 4, finishDate: '2026-12-06' },
  ]);
  const text = describeComparison(c, { money, date: (iso) => iso });
  assert.deepEqual(text.changes, {
    a: 'Without this expense: 2026-11-22. This trial adds 3 weeks.',
    b: 'Without this expense: 2026-11-29. This trial adds 3 weeks.',
    c: 'Without this expense: 2026-12-06. This trial adds 3 weeks.',
  });
});

test('a small expense can leave the finish unchanged, while a large one can put it beyond the planning limit', () => {
  const small = compareChoices({ ...BASE, options: [{ id: 'odd', priceCents: 12500, currency: 'USD' }], reserveCents: 100 });
  assert.equal(describeComparison(small, { money, date: (iso) => iso }).changes.odd, 'The finish stays 2026-11-29 with this expense.');
  const big = compareChoices({ ...BASE, reserveCents: 200000 });
  assert.equal(describeComparison(big, { money, date: (iso) => iso }).changes.a, 'Without this expense: 2026-11-22. This trial puts the finish beyond 52 weeks.');
  const baseline = compareChoices(BASE);
  assert.deepEqual(describeComparison(baseline, { money, date: (iso) => iso }).changes, {});
});

// ---- The saved family schedule (familySchedule): one dated row per week up to the goal's date ----
// Expected rows are written out from the task's example, not computed by the module.
const GOAL = { today: '2026-11-08', targetDate: '2026-12-20', progressCents: 6000, householdLimitCents: 3000, currency: 'USD', offers: OFFERS };
const rowsOf = (s) => s.rows.map((r) => [r.week, r.date, r.goalCents, r.reservedCents, r.perMember.map((p) => p.cents)]);

test('the example schedule: a one-off $90.00 takes weeks 1-3 once, then $30.00 a week ($20.00 + $10.00) finishes the $150.00 tent on Dec 20', () => {
  const s = familySchedule({ ...GOAL, targetCents: 15000, reserveCents: 9000 });
  assert.deepEqual(rowsOf(s), [
    [1, '2026-11-15', 0, 3000, [0, 0]],
    [2, '2026-11-22', 0, 3000, [0, 0]],
    [3, '2026-11-29', 0, 3000, [0, 0]],
    [4, '2026-12-06', 3000, 0, [2000, 1000]],
    [5, '2026-12-13', 3000, 0, [2000, 1000]],
    [6, '2026-12-20', 3000, 0, [2000, 1000]],
  ]);
  assert.deepEqual([s.outcome, s.weeks, s.remainingCents, s.plannedCents, s.shortfallCents, s.feasible, s.finishWeek, s.finishDate],
    ['on_time', 6, 9000, 9000, 0, true, 6, '2026-12-20']);
  assert.deepEqual(s.reserve, { cents: 9000, byDateCents: 9000, weeks: 3, coveredWeek: 3, uncoveredCents: 0 });
  assert.deepEqual(s.capacity, { householdLimitCents: 3000, offeredCents: 3000, capacityCents: 3000, limitedBy: 'both' });
  // Without the one-off amount the same tent finishes in week 3, and later weeks are $0.
  assert.deepEqual(rowsOf(familySchedule({ ...GOAL, targetCents: 15000 })).map((r) => r[2]), [3000, 3000, 3000, 0, 0, 0]);
});

test('the $180.00 item by the same Dec 20 date is $30.00 short; its earliest finish at the same offers is Dec 27', () => {
  const s = familySchedule({ ...GOAL, targetCents: 18000, reserveCents: 9000 });
  assert.deepEqual(rowsOf(s).map((r) => [r[2], r[4]]), [[0, [0, 0]], [0, [0, 0]], [0, [0, 0]], [3000, [2000, 1000]], [3000, [2000, 1000]], [3000, [2000, 1000]]]);
  assert.deepEqual([s.outcome, s.remainingCents, s.plannedCents, s.shortfallCents, s.feasible, s.finishWeek, s.finishDate], ['short', 12000, 9000, 3000, false, 7, '2026-12-27']);
  // A later date is a separate, explicit choice: at Dec 27 the same offers cover it, and no share rises above an offer.
  const later = familySchedule({ ...GOAL, targetDate: '2026-12-27', targetCents: 18000, reserveCents: 9000 });
  assert.deepEqual(rowsOf(later).map((r) => r[2]), [0, 0, 0, 3000, 3000, 3000, 3000]);
  assert.equal(later.outcome, 'on_time');
});

test('a partly covered week, a final week of exactly what remains and a household limit below the offers, in whole cents', () => {
  // $45.00 one-off: all of week 1, half of week 2. $95.00 to go: $15.00, $30.00, $30.00, then the final $20.00.
  const s = familySchedule({ ...GOAL, targetCents: 15500, reserveCents: 4500 });
  assert.deepEqual(rowsOf(s), [
    [1, '2026-11-15', 0, 3000, [0, 0]],
    [2, '2026-11-22', 1500, 1500, [1000, 500]],
    [3, '2026-11-29', 3000, 0, [2000, 1000]],
    [4, '2026-12-06', 3000, 0, [2000, 1000]],
    [5, '2026-12-13', 2000, 0, [1333, 667]], // 1333.33 + 666.67: the leftover cent goes to the larger remainder
    [6, '2026-12-20', 0, 0, [0, 0]],
  ]);
  assert.deepEqual([s.plannedCents, s.shortfallCents, s.finishWeek, s.reserve.weeks], [9500, 0, 5, 2]);
  // The household's $25.00 is below the $30.00 offered: each week is $25.00, split $16.67 + $8.33, under each offer.
  const capped = familySchedule({ ...GOAL, householdLimitCents: 2500, targetCents: 13500 });
  assert.deepEqual(rowsOf(capped).map((r) => [r[2], r[4]]), [[2500, [1667, 833]], [2500, [1667, 833]], [2500, [1667, 833]], [0, [0, 0]], [0, [0, 0]], [0, [0, 0]]]);
  assert.equal(capped.capacity.limitedBy, 'household');
  for (const sched of [s, capped]) {
    for (const r of sched.rows) {
      assert.equal(r.perMember.reduce((sum, p) => sum + p.cents, 0), r.goalCents);
      r.perMember.forEach((p, i) => assert.ok(p.cents <= OFFERS[i].weeklyCents));
      assert.ok(r.goalCents + r.reservedCents <= sched.capacity.capacityCents);
    }
  }
});

test('the 52-week limit: a goal a year away gets 52 dated weeks and a truthful shortfall, never a feasible-looking schedule', () => {
  const offers = [{ memberId: 'm_rowan', name: 'Rowan', weeklyCents: 600 }, { memberId: 'm_ash', name: 'Ash', weeklyCents: 400 }];
  const s = familySchedule({ today: '2026-11-08', targetDate: '2027-11-09', progressCents: 0, targetCents: 100000, householdLimitCents: 5000, currency: 'USD', offers, reserveCents: 500 });
  assert.equal(s.weeks, MAX_WEEKS);
  assert.equal(s.rows.length, 52);
  assert.deepEqual([s.rows[0].date, s.rows.at(-1).date], ['2026-11-15', '2027-11-07']);
  assert.deepEqual([s.rows[0].goalCents, s.rows[0].reservedCents, s.rows[1].goalCents, s.rows.at(-1).goalCents], [500, 500, 1000, 1000]);
  assert.deepEqual([s.outcome, s.plannedCents, s.shortfallCents, s.feasible, s.finishWeek, s.finishDate], ['short', 51500, 48500, false, null, null]);
});

test('nothing to schedule is said plainly: a reached goal, no offers, a $0 household amount, a date under a week away, a one-off taking every week', () => {
  const outcome = (over) => { const s = familySchedule({ ...GOAL, targetCents: 15000, ...over }); return [s.outcome, s.plannedCents, s.rows.length]; };
  assert.deepEqual(outcome({ progressCents: 15000 }), ['reached', 0, 6]);
  assert.deepEqual(outcome({ offers: [] }), ['no_offers', 0, 6]);
  assert.deepEqual(outcome({ householdLimitCents: 0 }), ['no_capacity', 0, 6]);
  assert.deepEqual(outcome({ targetDate: '2026-11-13' }), ['date_passed', 0, 0]);
  assert.deepEqual(outcome({ reserveCents: 18000 }), ['nothing_planned', 0, 6]);
  // An input is never changed by computing a schedule.
  const input = { ...GOAL, targetCents: 15000, reserveCents: 9000 };
  const before = JSON.stringify(input);
  familySchedule(input);
  assert.equal(JSON.stringify(input), before);
});

test('the schedule reads as short dated lines: weeks given to the one-off, a partly covered week, each adult’s share and the weeks after the finish', () => {
  const names = new Map([['m_rowan', 'Rowan'], ['m_ash', 'Ash']]);
  const lines = (sched) => scheduleLines(sched.rows, { money, date: (iso) => iso.slice(5), names });
  assert.deepEqual(lines(familySchedule({ ...GOAL, targetCents: 15000, reserveCents: 9000 })), [
    'Weeks 1–3 (11-15–11-29): $0.00 to the goal; each week’s $30.00 goes to the one-off expense',
    'Weeks 4–6 (12-06–12-20): $30.00 a week — Rowan $20.00 · Ash $10.00',
  ]);
  assert.deepEqual(lines(familySchedule({ ...GOAL, targetCents: 15500, reserveCents: 4500 })), [
    'Week 1 (11-15): $0.00 to the goal; this week’s $30.00 goes to the one-off expense',
    'Week 2 (11-22): $15.00, after $15.00 to the one-off expense — Rowan $10.00 · Ash $5.00',
    'Weeks 3–4 (11-29–12-06): $30.00 a week — Rowan $20.00 · Ash $10.00',
    'Week 5 (12-13): $20.00 — Rowan $13.33 · Ash $6.67',
    'Week 6 (12-20): $0.00, nothing more is needed',
  ]);
});
