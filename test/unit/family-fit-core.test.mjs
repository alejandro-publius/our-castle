import test from 'node:test';
import assert from 'node:assert/strict';
import { CEILING_LIMITS, ceilingText, evaluateFit, fitCeiling, matchNeed, needLines, needSummary, problemText } from '../../src/core/family-fit.js';
import { formatCents } from '../../src/core/rules.js';

// Expected cents, dates and words are written from the task's example, not computed by the module:
// Nov 8, 2026; goal date Dec 20 (week 6); $60.00 recorded; household $30.00 a week; offers $20.00 + $10.00.
// The taxonomy below is an invented test fixture, not a claim about Channel3's live categories.
const money = (cents) => formatCents(cents, 'USD');
const date = (iso) => iso.slice(5);
const OFFERS = [{ memberId: 'm_rowan', weeklyCents: 2000 }, { memberId: 'm_ash', weeklyCents: 1000 }];
const BASE = { today: '2026-11-08', targetDate: '2026-12-20', progressCents: 6000, householdLimitCents: 3000, offers: OFFERS };
const NEED = { category: { slug: 'fixture-tents', title: 'Tents (test fixture)', path: ['Outdoor (test fixture)', 'Tents (test fixture)'] },
  mustHaves: [{ key: 'fixture-capacity', name: 'Sleeps', accepted: ['4 person', '6 person'], allowed: ['1 person', '2 person', '4 person', '6 person'] }] };
const facts = (attributes, category = { slug: 'fixture-tents', title: 'Tents (test fixture)', path: ['fixture-outdoor', 'fixture-tents'] }) => ({ category, attributes });
const row = (over = {}) => ({ productId: 'p', priceCents: 12000, currency: 'USD', availability: 'InStock', usable: true, unusableReason: null, catalog: facts({ 'fixture-capacity': ['4 person'] }), ...over });

test('the ceiling is P + max(0, N×C − R): $150.00 with a one-off $90.00, $120.00 with $120.00, never above a typed lower limit', () => {
  const pick = (c) => [c.outcome, c.weeks, c.capacityCents, c.addableCents, c.reservedByDateCents, c.familyCeilingCents, c.ceilingCents, c.limitedBy];
  assert.deepEqual(pick(fitCeiling({ ...BASE, reserveCents: 9000 })), ['ok', 6, 3000, 9000, 9000, 15000, 15000, 'family']);
  assert.deepEqual(pick(fitCeiling({ ...BASE, reserveCents: 12000 })), ['ok', 6, 3000, 6000, 12000, 12000, 12000, 'family']);
  assert.deepEqual(pick(fitCeiling({ ...BASE })), ['ok', 6, 3000, 18000, 0, 24000, 24000, 'family']);
  // The one-off amount comes from future weeks once, never from progress: past N×C it only removes what the weeks add.
  assert.deepEqual(pick(fitCeiling({ ...BASE, reserveCents: 25000 })), ['ok', 6, 3000, 0, 18000, 6000, 6000, 'family']);
  assert.deepEqual(pick(fitCeiling({ ...BASE, reserveCents: 9000, budgetCents: 13000 })), ['ok', 6, 3000, 9000, 9000, 15000, 13000, 'budget']);
  assert.deepEqual(pick(fitCeiling({ ...BASE, reserveCents: 9000, budgetCents: 20000 })), ['ok', 6, 3000, 9000, 9000, 15000, 15000, 'family']);
  // The household amount and the offers are each a ceiling, never added: $25.00 a week caps $20.00 + $10.00.
  assert.deepEqual(pick(fitCeiling({ ...BASE, householdLimitCents: 2500 })), ['ok', 6, 2500, 15000, 0, 21000, 21000, 'family']);
  // A date a year away is capped at 52 weeks; a very large plan at the goal-amount bound.
  assert.equal(fitCeiling({ ...BASE, targetDate: '2027-11-09' }).weeks, 52);
  assert.equal(fitCeiling({ ...BASE, targetDate: '2027-11-09', householdLimitCents: 10_000_000, offers: [{ memberId: 'x', weeklyCents: 10_000_000 }] }).ceilingCents, CEILING_LIMITS.maxCents);
});

test('no offers, a $0 household amount, a date under a week away or a ceiling under $1.00 are said, never worked around', () => {
  assert.equal(fitCeiling({ ...BASE, offers: [] }).outcome, 'no_offers');
  assert.equal(fitCeiling({ ...BASE, householdLimitCents: 0 }).outcome, 'no_capacity');
  assert.equal(fitCeiling({ ...BASE, targetDate: '2026-11-14' }).outcome, 'date_passed');
  assert.equal(fitCeiling({ ...BASE, targetDate: '2026-11-01' }).outcome, 'date_passed');
  assert.deepEqual([fitCeiling({ ...BASE, progressCents: 0, reserveCents: 18000 }).outcome, fitCeiling({ ...BASE, progressCents: 0, reserveCents: 18000 }).ceilingCents], ['below_minimum', 0]);
  for (const bad of [{ reserveCents: -1 }, { reserveCents: 1.5 }, { budgetCents: 99 }, { offers: [{ memberId: 'x', weeklyCents: 50 }] }, { targetDate: '2026-02-30' }]) {
    assert.throws(() => fitCeiling({ ...BASE, ...bad }), RangeError, JSON.stringify(bad));
  }
  const words = (c) => ceilingText(c, { money, date });
  assert.equal(words(fitCeiling({ ...BASE, reserveCents: 9000 })), 'Up to $150.00 by 12-20: the $60.00 already recorded plus $90.00 the adults’ offers can add after the one-off $90.00. A planning limit, not money in hand.');
  assert.equal(words(fitCeiling({ ...BASE, reserveCents: 9000, budgetCents: 13000 })), 'Up to $130.00, the price limit typed here (the plan could cover $150.00 by 12-20: the $60.00 already recorded plus $90.00 the adults’ offers can add after the one-off $90.00). A planning limit, not money in hand.');
  assert.equal(words(fitCeiling({ ...BASE, offers: [] })), 'Options can be matched to the family’s date once an adult offers a weekly amount.');
});

test('a must-have matches only on the catalog’s own listed values: match, mismatch, missing or unclear, and the kind of item must match', () => {
  const status = (attributes, category) => { const r = matchNeed(facts(attributes, category), NEED); return [r.status, r.category.status, r.mustHaves[0].status]; };
  assert.deepEqual(status({ 'fixture-capacity': ['4 person'] }), ['meets', 'match', 'match']);
  assert.deepEqual(status({ 'fixture-capacity': ['4 person', '6 person'] }), ['meets', 'match', 'match']);
  assert.deepEqual(status({ 'fixture-capacity': ['2 person'] }), ['misses', 'match', 'mismatch']);
  assert.deepEqual(status({}), ['unknown', 'match', 'missing']);
  assert.deepEqual(status({ 'fixture-capacity': ['2 person', '4 person'] }), ['unknown', 'match', 'unclear']);
  assert.deepEqual(status({ 'fixture-capacity': ['Four'] }), ['unknown', 'match', 'unclear']); // not a value the category lists
  assert.deepEqual(status({ 'fixture-capacity': ['4 person'] }, { slug: 'fixture-tarps', title: 'Tarps', path: ['fixture-outdoor', 'fixture-tarps'] }), ['misses', 'mismatch', 'match']);
  assert.deepEqual(status({ 'fixture-capacity': ['4 person'] }, null), ['unknown', 'missing', 'match']);
  // A product in a category below the chosen one is in it (descendants count).
  assert.deepEqual(status({ 'fixture-capacity': ['4 person'] }, { slug: 'fixture-dome', title: 'Dome', path: ['fixture-outdoor', 'fixture-tents', 'fixture-dome'] }), ['meets', 'match', 'match']);
  // A title word is never evidence: the facts are empty, so the need stays unknown.
  assert.equal(matchNeed({ category: null, attributes: {} }, NEED).status, 'unknown');
  assert.deepEqual(needLines(matchNeed(facts({ 'fixture-capacity': ['2 person'] }), NEED)), ['Sleeps: 2 person, not 4 person or 6 person']);
  assert.deepEqual(needLines(matchNeed(facts({}), NEED)), ['Sleeps: not reported, so this need cannot be confirmed']);
});

test('suitable means the need is met, a usable USD price is within the ceiling and the retailer reports stock; anything else says why', () => {
  const judge = (over, ceilingCents = 15000) => { const r = evaluateFit(row(over), NEED, { ceilingCents }); return [r.status, r.problems.map((p) => p.code)]; };
  assert.deepEqual(judge({}), ['suitable', []]);
  assert.deepEqual(judge({ priceCents: 15000 }), ['suitable', []]);
  assert.deepEqual(judge({ priceCents: 15001 }), ['not_suitable', ['over_ceiling']]);
  assert.deepEqual(judge({ currency: 'EUR', usable: false }), ['not_suitable', ['currency']]);
  assert.deepEqual(judge({ availability: 'OutOfStock', usable: false }), ['not_suitable', ['out_of_stock']]);
  assert.deepEqual(judge({ availability: null }), ['unknown', ['stock_unknown']]);
  assert.deepEqual(judge({ priceCents: null, currency: null, usable: false }), ['unknown', ['no_price']]);
  assert.deepEqual(judge({ usable: false, unusableReason: 'The selected size or colour is no longer available. Choose another item.' }), ['not_suitable', ['unusable']]);
  // Mismatches come before unknowns, so the first reason is what is known to be wrong.
  assert.deepEqual(judge({ priceCents: 18000, catalog: facts({}) }), ['not_suitable', ['over_ceiling', 'must_have_missing']]);
  assert.deepEqual(judge({ catalog: facts({ 'fixture-capacity': ['2 person'] }), availability: null }), ['not_suitable', ['must_have', 'stock_unknown']]);
  assert.deepEqual(judge({ catalog: facts({ 'fixture-capacity': ['4 person'] }, null) }), ['unknown', ['category_missing']]);
  const text = (code, extra = {}) => problemText({ code, ...extra }, { need: NEED, ceilingCents: 15000, money });
  assert.deepEqual([text('must_have', { key: 'fixture-capacity' }), text('over_ceiling'), text('currency', { currency: 'EUR' }), text('category')],
    ['Sleeps does not match', 'over $150.00', 'priced in EUR', 'not in Tents (test fixture)']);
  // Judging changes no input.
  const input = row();
  const before = JSON.stringify([input, NEED]);
  evaluateFit(input, NEED, { ceilingCents: 15000 });
  assert.equal(JSON.stringify([input, NEED]), before);
});

test('a stored need reads plainly: met, no longer met or unconfirmed, with the search it was found in', () => {
  const need = (check) => ({ ...NEED, check, search: { ceilingCents: 15000, targetDate: '2026-12-20', reserveCents: 9000, on: '2026-11-08' } });
  assert.equal(needSummary(need({ status: 'meets', category: 'match', mustHaves: [{ key: 'fixture-capacity', found: ['4 person'], status: 'match' }] }), { money, date }),
    'Meets the family’s needs: Tents (test fixture) · Sleeps: 4 person (needed: 4 person or 6 person). Found within $150.00 for 12-20.');
  assert.equal(needSummary(need({ status: 'misses', category: 'match', mustHaves: [{ key: 'fixture-capacity', found: ['2 person'], status: 'mismatch' }] }), { money, date }),
    'No longer meets the family’s needs: Tents (test fixture) · Sleeps: now 2 person, not 4 person or 6 person. Found within $150.00 for 12-20.');
  assert.equal(needSummary(need({ status: 'unknown', category: 'match', mustHaves: [{ key: 'fixture-capacity', found: [], status: 'missing' }] }), { money, date }),
    'Cannot confirm the family’s needs: Tents (test fixture) · Sleeps: not reported. Found within $150.00 for 12-20.');
  assert.equal(needSummary({ category: null, mustHaves: [], check: { status: 'meets', category: 'not_chosen', mustHaves: [] }, search: { ceilingCents: 12000, targetDate: '2026-12-20' } }, { money, date }),
    'Meets the family’s needs. Found within $120.00 for 12-20.');
});
