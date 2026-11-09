// The playable family-trip example (npm run demo -- --family-trip), over real HTTP on a loopback port.
// - Everything is invented example data: the family, two sample shops and six sample listings (scripts/family-trip.mjs).
// - The planning is the existing engine: the real merchant over a local transport, the real kit planner routes, and the
//   compiled Rust solver when it is built (KIT_SOLVER_REQUIRED=1 makes that mandatory, as CI does), else the reference.
// - The figures expected below are the worked example's own (docs/KIT-PLANNER.md), with the server's day pinned to
//   Nov 8, 2026. The example itself holds none of them: they are what the engine answers for its listings.
// No provider is contacted, and no .env, key or saved record is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { startDemo } from '../../scripts/demo.mjs';
import { FAMILY_TRIP, SAMPLE_LISTINGS, SAMPLE_SHOPS, createFamilyTrip, createSampleCatalogue } from '../../scripts/family-trip.mjs';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { daysBetween } from '../../server/household.mjs';
import { createKitSolver } from '../../server/kit/solver.mjs';
import { catalogueOf } from '../../src/core/catalogue.js';
import { mutableClock } from '../helpers/family-http.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = fileURLToPath(new URL('../../scripts/demo.mjs', import.meta.url));
const required = process.env.KIT_SOLVER_REQUIRED === '1';
const NOV_8 = '2026-11-08T12:00:00'; // local noon, seven weeks before Dec 27

async function trip() {
  const clock = mutableClock(NOV_8);
  const kitSolver = createKitSolver({ root, engine: required ? 'native' : 'auto' });
  const demo = await startDemo({ familyTrip: true, clock, kitSolver });
  const call = async (method, path, body) => {
    const res = await fetch(demo.url + path, { method, headers: body ? { 'Content-Type': 'application/json', Origin: demo.url } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  const state = async () => (await call('GET', '/api/state')).json;
  const as = (memberId, body = {}) => ({ memberId, ...body });
  const compare = async (reserveCents, memberId = 'm_rowan') => {
    const s = await state();
    return call('POST', '/api/kit/compare', as(memberId, { revision: s.kitPlan.revision, choicesRevision: s.familyChoices.revision, reserveCents }));
  };
  const choose = async (kit) => call('PUT', '/api/kit/choice', as('m_rowan', { revision: (await state()).kitPlan.revision, lines: kit.lines.map((l) => ({ lineId: l.lineId, candidateId: l.candidateId })) }));
  const keep = async (name, kept = true) => {
    const s = await state();
    return call('PUT', '/api/kit/keep', as('m_rowan', { revision: s.kitPlan.revision, lineId: s.kitPlan.lines.find((l) => l.name === name).lineId, kept }));
  };
  return { demo, clock, kitSolver, calls: demo.example.merchant.catalogue.calls, call, state, as, compare, choose, keep };
}
// Everything a planning step must leave alone: recorded progress, the ledger, payments, the plan, the goal and the offers.
const money = (s) => JSON.stringify([s.progress, s.ledger, s.contributions, s.plan, s.acceptedPlanId, s.goal, s.goalKit, s.familyChoices.offers]);
const titles = (kit) => kit.lines.map((l) => l.title);

test('the ordinary fresh demo is unchanged: no catalogue, no example, the default household', async () => {
  const demo = await startDemo();
  try {
    assert.equal(demo.example, null);
    const status = await (await fetch(demo.url + '/api/status')).json();
    assert.deepEqual([status.merchant.mode, status.merchant.label, status.payments.mode, status.ai.mode, status.kit.mode], ['off', 'Channel3 not connected', 'example', 'example', 'off']);
    assert.equal('example' in status, false);
    const s = await (await fetch(demo.url + '/api/state')).json();
    assert.equal('example' in s, false);
    assert.deepEqual(s.members.map((m) => [m.name, m.role]), [['Rowan', 'adult'], ['Wren', 'child']]);
    assert.equal(s.household.setupComplete, false);
    assert.deepEqual([s.kit.items.length, s.familyChoices.offers.length, s.kitPlan.lines.length], [0, 0, 0]);
    const search = await fetch(demo.url + '/api/merchant/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'tent' }) });
    assert.equal(search.status, 503);
    assert.equal((await search.json()).error.code, 'merchant_not_connected');
    assert.deepEqual(catalogueOf(s), { open: false, sample: false, name: 'Channel3' });
  } finally { await demo.close(); }
});

test('the example starts from invented, labelled data saved through the existing services', async () => {
  const t = await trip();
  try {
    const status = (await t.call('GET', '/api/status')).json;
    assert.deepEqual(status.example, { id: 'family-trip', title: 'Example family trip' });
    // Market Town says what it is: an example catalogue, never Channel3 or "live". Every other provider stays off.
    assert.deepEqual(status.merchant, { mode: 'sample', provider: 'Example catalogue', label: 'Example catalogue: invented shops, listings and prices (not Channel3)' });
    assert.deepEqual([status.payments.mode, status.ai.mode, status.kit.mode], ['example', 'example', 'off']);
    const s = await t.state();
    assert.deepEqual(s.example, status.example);
    assert.deepEqual(catalogueOf(s), { open: true, sample: true, name: 'the example catalogue' });
    assert.equal(s.kitPlan.preference.mode, 'off', 'ordering by a preference (Cohere) stays off');
    assert.deepEqual([s.household.name, s.household.isExample, s.household.setupComplete, s.household.playMode], ['House of Alder', true, true, 'family']);
    assert.deepEqual(s.members.map((m) => [m.id, m.name, m.role, m.isExample]), [['m_rowan', 'Rowan', 'adult', true], ['m_ash', 'Ash', 'adult', true], ['m_wren', 'Wren', 'child', true]]);
    // $60 reported, $30 a week, and a date seven weeks after the day the example started.
    assert.deepEqual([s.goal.targetCents, s.goal.weeklyBudgetCents, s.goal.targetDate, s.familyChoices.today, s.progress.progressCents], [30000, 3000, '2026-12-27', '2026-11-08', 6000]);
    assert.deepEqual(s.familyChoices.offers.map((o) => [o.name, o.weeklyCents]), [['Rowan', 2000], ['Ash', 1000]]);
    assert.deepEqual(s.ledger.goalEntries.map((e) => [e.kind, e.amountCents, e.source]), [['starting_progress', 6000, 'user-reported']]);
    assert.deepEqual([s.contributions.length, s.plan, s.kitPlan.selection, s.goalKit, s.familyChoices.choices.length], [0, null, null, null, 0]);
    // The list: one tent, two sleeping bags, two torches already at home, one stove.
    assert.deepEqual(s.kitPlan.lines.map((l) => [l.name, l.quantity, l.ownedQuantity, l.remaining, l.candidates.length]),
      [['4-person tent', 1, 0, 1, 2], ['sleeping bag', 2, 0, 2, 2], ['torch', 2, 2, 0, 0], ['stove', 1, 0, 1, 2]]);
    // Six listings from two shops. Each says it is a sample, and its count per listing is recorded as Rowan's.
    const listings = s.kitPlan.lines.flatMap((l) => l.candidates);
    assert.deepEqual(listings.map((c) => [c.title, c.priceCents, c.weightMg, c.merchant]), SAMPLE_LISTINGS.map((l) => [l.title, l.dollars * 100, l.weight.number * (l.weight.unit === 'kg' ? 1_000_000 : 1000), l.shop]));
    for (const c of listings) {
      assert.match(c.title, /^Sample: /);
      assert.match(c.merchant, /^sample-shop-(one|two)\.example$/);
      assert.deepEqual([c.perListing, c.perListingBy, c.availability, c.currency, c.fresh, c.issue], [FAMILY_TRIP.perListing, 'Rowan', 'InStock', 'USD', true, null]);
    }
    assert.deepEqual([...new Set(listings.map((c) => c.merchant))], [...SAMPLE_SHOPS]);
    // One search per item still to get, as "Find listings for <item>" makes; the torches at home were never searched.
    assert.deepEqual(t.calls, { search: 3, product: 0, similar: 0, other: 0 });
  } finally { await t.demo.close(); }
});

test('the existing planner compares, repairs and reports a real shortfall for the example, moving no money', async () => {
  const t = await trip();
  try {
    const before = money(await t.state());
    // A $90 one-off leaves $180 by Dec 27: two different complete kits fit.
    const ninety = (await t.compare(9000)).json;
    assert.deepEqual([ninety.status, ninety.ceiling.ceilingCents, ninety.pool.combinations, ninety.pool.feasible, ninety.pool.listings], ['ok', 18000, 8, 5, 6]);
    assert.deepEqual(ninety.kits.map((k) => [k.labels, k.totalCents, k.finish.status, k.finish.finishDate, k.retailers, k.weightMg]),
      [[['lowest_total', 'fewest_retailers'], 15000, 'fits', '2026-12-20', 1, 5_200_000], [['lower_weight'], 18000, 'fits', '2026-12-27', 2, 4_000_000]]);
    assert.deepEqual(titles(ninety.kits[1]), ['Sample: Light tent, four-person', 'Sample: Sleeping bag, synthetic', 'Sample: Camp stove']);
    // Rowan chooses the $180 kit and keeps its stove.
    assert.equal((await t.choose(ninety.kits[1])).status, 200);
    assert.equal((await t.keep('stove')).status, 200);
    // A $120 one-off leaves $150: the chosen kit no longer fits, and the smallest change switches only the tent.
    const repair = (await t.compare(12000)).json;
    assert.deepEqual([repair.status, repair.ceiling.ceilingCents, repair.pool.combinations, repair.pool.feasible], ['ok', 15000, 4, 1]);
    assert.deepEqual([repair.current.totalCents, repair.current.fits, repair.current.finish.status, repair.current.finish.finishDate, repair.current.finish.shortfallCents], [18000, false, 'late', '2027-01-03', 3000]);
    assert.equal(repair.kits.length, 1);
    const fixed = repair.kits[0];
    assert.deepEqual([fixed.labels[0], fixed.totalCents, fixed.changes, fixed.finish.finishDate], ['smallest_change', 15000, 1, '2026-12-27']);
    assert.deepEqual(fixed.lines.map((l) => [l.name, l.title, l.kept, l.switched?.title ?? null]), [
      ['4-person tent', 'Sample: Dome tent, four-person', false, 'Sample: Light tent, four-person'],
      ['sleeping bag', 'Sample: Sleeping bag, synthetic', false, null],
      ['stove', 'Sample: Camp stove', true, null]]);
    // An impossible limit: a $200 one-off leaves $70. Nothing is invented to fit; the closest kit shows what it would take.
    const short = (await t.compare(20000)).json;
    assert.deepEqual([short.status, short.ceiling.ceilingCents, short.pool.feasible, short.kits.length], ['none_fits', 7000, 0, 0]);
    assert.deepEqual([short.closest.totalCents, short.closest.finish.status, short.closest.finish.finishDate, short.closest.finish.weeksLate, short.closest.finish.shortfallCents], [15000, 'late', '2027-01-17', 3, 8000]);
    assert.equal(short.closest.lines.find((l) => l.name === 'stove').kept, true, 'the kept stove is never switched, even when nothing fits');
    // Wren reads and cannot compare; a trial belongs to the adult who made it.
    assert.deepEqual([(await t.compare(0, 'm_wren')).status, (await t.compare(0, 'm_wren')).json.error.code], [403, 'adult_required']);
    // Comparing, choosing and keeping asked the catalogue nothing more, and changed no money, progress, goal, plan or offer.
    assert.deepEqual(t.calls, { search: 3, product: 0, similar: 0, other: 0 });
    assert.equal(money(await t.state()), before);
    // The answers came from the solver (the compiled one when it is required), each checked against its request.
    assert.equal(t.kitSolver.stats.native + t.kitSolver.stats.reference, 3);
    assert.equal(t.kitSolver.stats.refused, 0);
    if (required) assert.equal(t.kitSolver.stats.native, 3);
  } finally { await t.demo.close(); }
});

test('the reviewed kit is saved only on request, and one simulated contribution credits progress once', async () => {
  const t = await trip();
  try {
    const kits = (await t.compare(12000)).json.kits;
    assert.deepEqual(kits.map((k) => k.totalCents), [15000]);
    assert.equal((await t.choose(kits[0])).status, 200);
    let s = await t.state();
    const ask = { revision: s.kitPlan.revision, choicesRevision: s.familyChoices.revision, reserveCents: 12000 };
    // Reviewing checks every listing against the example catalogue's current answer and writes nothing.
    const review = await t.call('POST', '/api/kit/review', t.as('m_rowan', ask));
    assert.equal(review.status, 200, JSON.stringify(review.json));
    assert.deepEqual([review.json.saved, review.json.goal, review.json.schedule.proposable], [false, { targetCents: 15000, targetDate: '2026-12-27', weeklyBudgetCents: 3000 }, true]);
    assert.deepEqual([(s = await t.state()).goal.targetCents, s.plan, s.goalKit], [30000, null, null]);
    assert.equal((await t.call('POST', '/api/kit/review', t.as('m_wren', ask))).status, 403);
    // "Save goal and propose this schedule": the goal, the kit as its source and a proposal. Nothing is put in use or paid.
    const adopt = await t.call('POST', '/api/kit/adopt', t.as('m_rowan', { goalId: s.goal.id, expectedGoalRevision: s.merchantGoalRevision,
      goal: { name: s.goal.name, targetCents: 15000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-27' },
      kit: { revision: ask.revision, choicesRevision: ask.choicesRevision }, schedule: { reserveCents: 12000, revision: review.json.schedule.revision } }));
    assert.equal(adopt.status, 200, JSON.stringify(adopt.json));
    s = adopt.json.state;
    assert.deepEqual([s.goal.targetCents, s.goalKit.totalCents, s.goalKit.lineCount, s.plan.status, s.acceptedPlanId, s.progress.progressCents, s.contributions.length], [15000, 15000, 3, 'proposed', null, 6000, 0]);
    assert.deepEqual(s.goalKit.lines.map((l) => l.title), ['Sample: Dome tent, four-person', 'Sample: Sleeping bag, synthetic', 'Sample: Camp stove']);
    // A contribution is a separate, amount-specific adult approval: unconfirmed, or from the child, it is refused.
    const give = (body) => t.call('POST', '/api/example/contributions', { householdId: s.household.id, goalId: s.goal.id, amountCents: 1500, ...body });
    const requestId = crypto.randomUUID();
    assert.deepEqual([(await give({ approverId: 'm_rowan', approvalConfirmed: false, requestId: crypto.randomUUID() })).status, (await give({ approverId: 'm_wren', approvalConfirmed: true, requestId: crypto.randomUUID() })).status], [400, 403]);
    assert.equal((await t.state()).progress.progressCents, 6000);
    const paid = await give({ approverId: 'm_rowan', approvalConfirmed: true, requestId });
    assert.equal(paid.status, 200, JSON.stringify(paid.json));
    assert.deepEqual([paid.json.contribution.status, paid.json.contribution.simulated, paid.json.state.progress.progressCents], ['completed', true, 7500]);
    // The same request again is the same contribution: still one credit, one receipt.
    const again = await give({ approverId: 'm_rowan', approvalConfirmed: true, requestId });
    assert.deepEqual([again.status, again.json.contribution.id], [200, paid.json.contribution.id]);
    s = await t.state();
    assert.deepEqual([s.progress.progressCents, s.progress.simulatedContributedCents, s.progress.contributedCents, s.contributions.length], [7500, 1500, 0, 1]);
    assert.deepEqual(s.ledger.goalEntries.map((e) => [e.kind, e.amountCents, e.source]), [['starting_progress', 6000, 'user-reported'], ['simulated_contribution', 1500, 'simulated']]);
  } finally { await t.demo.close(); }
});

test('the example catalogue goes through the merchant’s own freshness and call limits', async () => {
  const t = await trip();
  try {
    const kits = (await t.compare(9000)).json.kits;
    assert.equal((await t.choose(kits[0])).status, 200);
    // Thirty-one minutes later the listings are no longer fresh: a review names each one to check again.
    t.clock.advance(31 * 60_000);
    let s = await t.state();
    assert.deepEqual(s.kitPlan.lines.flatMap((l) => l.candidates).map((c) => c.fresh), [false, false, false, false, false, false]);
    const ask = () => ({ revision: s.kitPlan.revision, choicesRevision: s.familyChoices.revision, reserveCents: 9000 });
    const stale = await t.call('POST', '/api/kit/review', t.as('m_rowan', ask()));
    assert.deepEqual([stale.status, stale.json.error.code, stale.json.error.issues.length], [409, 'kit_needs_check', 3]);
    // "Check price" is one bounded look-up per listing, answered by the example catalogue; then the review passes.
    for (const issue of stale.json.error.issues) {
      const checked = await t.call('POST', '/api/kit/listings/refresh', t.as('m_rowan', { candidateId: issue.candidateId }));
      assert.deepEqual([checked.status, checked.json.usable, checked.json.previousPriceCents === checked.json.priceCents], [200, true, true]);
    }
    assert.deepEqual(t.calls, { search: 3, product: 3, similar: 0, other: 0 });
    s = await t.state();
    assert.equal((await t.call('POST', '/api/kit/review', t.as('m_rowan', ask()))).status, 200);
    // The merchant's six calls a minute apply to the example as to Channel3.
    const search = (query) => t.call('POST', '/api/merchant/search', { query });
    const found = await search('light tent');
    assert.deepEqual([found.status, found.json.provider, found.json.results.map((r) => r.title)], [200, 'Example catalogue', ['Sample: Dome tent, four-person', 'Sample: Light tent, four-person']]);
    assert.deepEqual([(await search('a torch')).json.results.length, (await search('compact stove')).json.results.length], [0, 2]);
    assert.deepEqual([(await search('one more tent')).status, (await search('yet another tent')).json.error.code], [429, 'merchant_busy']);
  } finally { await t.demo.close(); }
});

test('a house or crest save keeps the planning records of everyone who stays', async () => {
  // Reproduced at b21b2d8: saving the house re-created every member, and the weekly offers, the kit list and its listings
  // went with the old rows. In the example that erased the whole starting state.
  const t = await trip();
  try {
    const before = await t.state();
    const saved = await t.call('POST', '/api/setup', { playMode: 'family', name: 'House of Hazel', crest: { field: 'emerald', charge: 'leaf' } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    let s = saved.json.state;
    assert.deepEqual([s.household.name, s.household.crest], ['House of Hazel', { field: 'emerald', charge: 'leaf' }]);
    assert.deepEqual(s.members, before.members);
    assert.deepEqual([s.familyChoices.offers, s.kit.items, s.kitPlan.lines], [before.familyChoices.offers, before.kit.items, before.kitPlan.lines]);
    // Playing solo removes Ash and Wren, and Ash's offer with them. Rowan's own offer, list and listings stay.
    s = (await t.call('POST', '/api/setup', { playMode: 'solo', name: 'House of Hazel', crest: { field: 'emerald', charge: 'leaf' } })).json.state;
    assert.deepEqual(s.members.map((m) => m.name), ['Rowan']);
    assert.deepEqual(s.familyChoices.offers.map((o) => [o.name, o.weeklyCents]), [['Rowan', 2000]]);
    assert.deepEqual([s.kit.items.length, s.kitPlan.lines.flatMap((l) => l.candidates).length], [4, 6]);
    // The example's own family comes back with Family.
    s = (await t.call('POST', '/api/setup', { playMode: 'family', name: 'House of Hazel', crest: { field: 'emerald', charge: 'leaf' } })).json.state;
    assert.deepEqual(s.members.map((m) => [m.name, m.role]), [['Rowan', 'adult'], ['Ash', 'adult'], ['Wren', 'child']]);
  } finally { await t.demo.close(); }
  // The ordinary demo had the same defect for Rowan's own offer and list.
  const demo = await startDemo();
  try {
    const send = async (method, path, body) => (await fetch(demo.url + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    const first = await (await fetch(demo.url + '/api/state')).json();
    await send('PUT', '/api/family-choices/offer', { memberId: 'm_rowan', weeklyCents: 2000 });
    await send('PUT', '/api/kit', { memberId: 'm_rowan', goalId: first.goal.id, expectedRevision: 0, items: [{ name: 'torch', quantity: 2, ownedQuantity: 0, from: 'typed' }] });
    const { state: s } = await send('POST', '/api/setup', { playMode: 'family', name: 'House of Alder', crest: { field: 'cobalt', charge: 'stag' } });
    assert.deepEqual([s.familyChoices.offers.map((o) => o.weeklyCents), s.kit.items.map((i) => i.name), s.members.map((m) => m.name)], [[2000], ['torch'], ['Rowan', 'Wren']]);
  } finally { await demo.close(); }
});

test('resetting the example starts it again, or changes nothing when the catalogue cannot answer', async () => {
  const t = await trip();
  try {
    const start = await t.state();
    const kits = (await t.compare(9000)).json.kits;
    await t.choose(kits[1]);
    await t.keep('stove');
    await t.call('PUT', '/api/family-choices/offer', t.as('m_ash', { weeklyCents: 500 }));
    const changed = await t.state();
    assert.deepEqual([changed.kitPlan.selection.lines.length, changed.familyChoices.offers[1].weeklyCents], [3, 500]);
    // With the minute's catalogue calls used up, a reset is refused before anything is erased.
    t.clock.advance(3 * 60_000); // earlier answers are no longer cached, and the minute's count starts again
    for (const query of ['tent one', 'tent two', 'tent three', 'tent four', 'tent five', 'tent six']) assert.equal((await t.call('POST', '/api/merchant/search', { query })).status, 200);
    const refused = await t.call('POST', '/api/demo/reset', {});
    assert.deepEqual([refused.status, refused.json.error.code], [429, 'merchant_busy']);
    assert.deepEqual([(await t.state()).kitPlan.selection, (await t.state()).familyChoices.offers], [changed.kitPlan.selection, changed.familyChoices.offers]);
    // A minute later the reset runs: the example's own starting state, with fresh listings and nothing chosen.
    t.clock.advance(61_000);
    const reset = await t.call('POST', '/api/demo/reset', {});
    assert.equal(reset.status, 200, JSON.stringify(reset.json));
    const s = reset.json.state;
    assert.deepEqual([s.example, s.members.map((m) => m.name), s.familyChoices.offers.map((o) => o.weeklyCents), s.kitPlan.selection, s.progress.progressCents],
      [start.example, ['Rowan', 'Ash', 'Wren'], [2000, 1000], null, 6000]);
    assert.deepEqual(s.kitPlan.lines.map((l) => [l.name, l.remaining, l.candidates.map((c) => c.title)]), start.kitPlan.lines.map((l) => [l.name, l.remaining, l.candidates.map((c) => c.title)]));
  } finally { await t.demo.close(); }
});

test('the example cannot bypass the family’s rules, and runs only on the simulated example household', async () => {
  const clock = mutableClock(NOV_8);
  const appWith = (scenario, env = {}) => {
    const db = openDatabase(':memory:');
    const example = createFamilyTrip({ clock, scenario });
    return { db, app: createApp({ config: loadConfig({ PORT: '0', ...env }, { root }), db, clock, root, example, merchant: example.merchant }) };
  };
  // A scenario in which the child lists the kit, or offers a weekly amount, is refused by the same services the page's
  // routes call, and the whole starting state is rolled back: the household stays the untouched example.
  for (const [scenario, message] of [
    [{ ...FAMILY_TRIP, listedBy: 'm_wren' }, /Only an adult in the family can save the kit list/],
    [{ ...FAMILY_TRIP, offers: [{ memberId: 'm_wren', weeklyCents: 500 }] }, /Only an adult in the family can do this/],
    [{ ...FAMILY_TRIP, perListing: 0 }, /Enter how many .+ one listing gives, from 1 to 100/],
  ]) {
    const { db, app } = appWith(scenario);
    try {
      await assert.rejects(app.seedExample(), (error) => { assert.match(error.message, message); return true; });
      const s = app.state();
      assert.deepEqual([s.household.setupComplete, s.familyChoices.offers.length, s.kit.items.length, s.kitPlan.lines.length], [false, 0, 0, 0]);
    } finally { db.close(); }
  }
  // The authored example is never attached to PayPal sandbox records or to shared families.
  for (const env of [{ PAYPAL_CLIENT_ID: 'invented-client', PAYPAL_CLIENT_SECRET: 'invented-secret' }, { OUR_CASTLE_ACCESS: 'family', OUR_CASTLE_ORIGIN: 'http://localhost:3299' }]) {
    const db = openDatabase(':memory:');
    try {
      const example = createFamilyTrip({ clock });
      assert.throws(() => createApp({ config: loadConfig({ PORT: '0', ...env }, { root }), db, clock, root, example, merchant: example.merchant }), /runs only on the simulated example household/);
    } finally { db.close(); }
  }
});

test('an example listing saved as the goal names the example catalogue, never Channel3', async () => {
  const t = await trip();
  try {
    const found = await t.call('POST', '/api/merchant/search', { query: 'tent' });
    const tent = found.json.results[0];
    const s = await t.state();
    const saved = await t.call('POST', '/api/merchant/goal', { draftId: tent.draftId, goalId: found.json.goalId, expectedGoalRevision: found.json.goalRevision,
      goal: { name: 'Sample dome tent', targetCents: tent.priceCents, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: s.goal.targetDate } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual([saved.json.state.goalItem.provider, saved.json.state.goalItem.title, saved.json.state.goalItem.merchant, saved.json.state.progress.progressCents],
      ['Example catalogue', 'Sample: Dome tent, four-person', 'sample-shop-one.example', 6000]);
    // Channel3 is named once in the whole state: where the merchant's own label says these listings are not Channel3's.
    assert.deepEqual(JSON.stringify(saved.json.state).match(/.{5}Channel3/g), ['(not Channel3']);
  } finally { await t.demo.close(); }
});

test('Market Town’s other searches work over the example catalogue and are labelled as it', async () => {
  const t = await trip();
  try {
    const s = await t.state();
    // "Find options that fit": the server derives the $180 limit for a $90 one-off and judges each listing itself. The
    // one-off takes weeks 1-3, so the $80 tent is reached in week 4 (Dec 6) and the $110 tent in week 5 (Dec 13).
    const fit = await t.call('POST', '/api/family-choices/fit', t.as('m_rowan', { query: 'tent', budgetCents: null, category: null, mustHaves: [], reserveCents: 9000, revision: s.familyChoices.revision }));
    assert.equal(fit.status, 200, JSON.stringify(fit.json));
    assert.deepEqual([fit.json.provider, fit.json.ceiling.ceilingCents, fit.json.results.map((r) => [r.title, r.priceCents, r.fit.status, r.finishDate])],
      ['Example catalogue', 18000, [['Sample: Dome tent, four-person', 8000, 'suitable', '2026-12-06'], ['Sample: Light tent, four-person', 11000, 'suitable', '2026-12-13']]]);
    assert.equal((await t.call('POST', '/api/family-choices/fit', t.as('m_wren', { query: 'tent', reserveCents: 0, revision: s.familyChoices.revision }))).status, 403);
    // "Cheaper options" for the light tent is the dome tent; the example lists no kinds of item to choose between.
    const light = fit.json.results[1];
    const cheaper = await t.call('POST', '/api/merchant/alternatives', { referenceId: light.referenceId, goalId: fit.json.goalId, budgetCents: null });
    assert.deepEqual([cheaper.status, cheaper.json.provider, cheaper.json.results.map((r) => r.title)], [200, 'Example catalogue', ['Sample: Dome tent, four-person']]);
    const kinds = await t.call('POST', '/api/merchant/categories', { query: 'tent' });
    assert.deepEqual([kinds.status, kinds.json.provider, kinds.json.categories], [200, 'Example catalogue', []]);
    assert.deepEqual(t.calls, { search: 4, product: 0, similar: 1, other: 1 });
  } finally { await t.demo.close(); }
});

test('the example catalogue is a local transport: it answers from six listings and never uses the network', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('the example catalogue must not use the network'); };
  try {
    const catalogue = createSampleCatalogue();
    const ask = async (path, init) => { const res = await catalogue.fetch(`https://api.trychannel3.com${path}`, init); return { status: res.status, body: await res.json() }; };
    const search = (body) => ask('/v1/search', { method: 'POST', body: JSON.stringify(body) });
    assert.deepEqual((await search({ query: '4-person tent', limit: 3 })).body.products.map((p) => p.id), ['sampleTentDome', 'sampleTentLight']);
    assert.deepEqual((await search({ query: 'tent', limit: 3, filters: { price: { max_price: 90 } } })).body.products.map((p) => p.id), ['sampleTentDome']);
    assert.deepEqual((await search({ query: 'head torch', limit: 3 })).body.products, []);
    const stove = (await ask('/v1/products/sampleStoveCompact?country=US')).body;
    assert.deepEqual([stove.title, stove.offers.length, stove.offers[0].domain, stove.offers[0].price, stove.offers[0].availability, stove.offers[0].dimensions.weight],
      ['Sample: Compact stove', 1, 'sample-shop-two.example', { price: 35, currency: 'USD' }, 'InStock', { number: 300, unit: 'g' }]);
    assert.equal((await ask('/v1/products/not-a-sample')).status, 404);
    assert.deepEqual((await ask('/v1/similar', { method: 'POST', body: JSON.stringify({ product_id: 'sampleTentLight', limit: 3, filters: { price: { max_price: 109.99 } } }) })).body.products.map((p) => p.id), ['sampleTentDome']);
    assert.deepEqual((await ask('/v1/categories/search?query=tent&limit=5')).body, { categories: [] });
    assert.deepEqual(catalogue.calls, { search: 3, product: 2, similar: 1, other: 1 });
    // Every listing names itself a sample, from a reserved .example shop that cannot exist.
    for (const l of SAMPLE_LISTINGS) assert.match(`${l.title} ${l.shop}`, /^Sample: .+ sample-shop-(one|two)\.example$/);
    // The whole example, prepared and searched through the real merchant, with the network unavailable.
    const example = createFamilyTrip({ clock: mutableClock(NOV_8) });
    assert.equal(typeof (await example.prepare()), 'function');
    const found = await example.merchant.search({ query: 'stove', budgetCents: 3200 });
    assert.deepEqual([found.provider, found.results.map((r) => [r.title, r.priceCents, r.usable])], ['Example catalogue', [['Sample: Camp stove', 3000, true]]]);
    assert.deepEqual(example.merchant.status(), { mode: 'sample', provider: 'Example catalogue', label: 'Example catalogue: invented shops, listings and prices (not Channel3)' });
  } finally { globalThis.fetch = realFetch; }
});

test('the CLI starts the example only when asked, ignores configured keys, and refuses unknown options', { timeout: 30_000 }, async () => {
  // As demo.test.mjs does: this process's environment plus invented settings the demo must ignore.
  const env = { ...process.env, OUR_CASTLE_ENV_FILE: 'none', PORT: '3010', HOST: '0.0.0.0', PAYPAL_CLIENT_ID: 'invented-client', PAYPAL_CLIENT_SECRET: 'invented-secret',
    PAYPAL_ENV: 'sandbox', AI_API_KEY: 'invented-key', CHANNEL3_API_KEY: 'invented-key', KIT_OPENAI_API_KEY: 'invented-key', KIT_COHERE_API_KEY: 'invented-key' };
  const child = spawn(process.execPath, [script, '--family-trip'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', stderr = ''; child.stderr.on('data', (b) => { stderr += b; });
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The example did not print its URL')), 20_000);
      child.once('exit', () => { clearTimeout(timer); reject(new Error('The example exited early: ' + stderr)); });
      child.stdout.on('data', (b) => { output += b; const found = output.match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[0]; if (found && /Press Ctrl\+C/.test(output)) { clearTimeout(timer); resolve(found); } });
    });
    assert.notEqual(new URL(url).port, '3010');
    assert.match(output, /Example family trip · an invented family, two sample shops and invented prices · simulated payments · rules planner\./);
    assert.match(output, /No provider is contacted and no key or saved record is read\./);
    const status = await (await fetch(url + '/api/status')).json();
    assert.deepEqual([status.example.id, status.merchant.mode, status.payments.mode, status.ai.mode, status.kit.mode], ['family-trip', 'sample', 'example', 'example', 'off']);
    const s = await (await fetch(url + '/api/state')).json();
    assert.deepEqual([s.kitPlan.preference.mode, s.kitPlan.lines.flatMap((l) => l.candidates).length], ['off', 6]);
    // On the real clock the goal's date is seven weeks after the day the example started, so it starts in the future,
    // and the planner's answer for a $90 one-off is the same two kits whatever that day is.
    assert.equal(daysBetween(s.familyChoices.today, s.goal.targetDate), 49);
    const compared = await (await fetch(url + '/api/kit/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: 'm_rowan', revision: s.kitPlan.revision, choicesRevision: s.familyChoices.revision, reserveCents: 9000 }) })).json();
    assert.deepEqual([compared.status, compared.kits.map((k) => k.totalCents), compared.kits.map((k) => daysBetween(s.familyChoices.today, k.finish.finishDate))], ['ok', [15000, 18000], [42, 49]]);
    const exit = once(child, 'exit'); child.kill('SIGINT');
    assert.deepEqual(await exit, [0, null]);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit; }
  }
  const wrong = spawn(process.execPath, [script, '--familytrip'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let said = ''; wrong.stderr.on('data', (b) => { said += b; });
  assert.deepEqual(await once(wrong, 'exit'), [2, null]);
  assert.match(said, /Unknown option: --familytrip/);
  assert.match(said, /npm run demo -- --family-trip/);
});
