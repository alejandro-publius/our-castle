// Comparing complete kits (task 019) over real HTTP, in family mode. The merchant is the real Channel3 code over a FAKE
// catalog of invented listings (test/helpers/kit-catalog.mjs); the solver is the compiled Rust program when it is built
// (KIT_SOLVER_REQUIRED=1 makes that mandatory, as CI does), otherwise the built-in reference. No provider is contacted.
// The family figures are kit-planning-acceptance-20261109.json's: $60 recorded, $30 a week, Rowan $20 + Ash $10 a week,
// goal date Dec 27 seen from Nov 8 (seven weeks); the list is 1 tent, 2 sleeping bags, 2 torches (both at home), 1 stove.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS, openDatabase } from '../../server/db.mjs';
import { DomainError } from '../../server/household.mjs';
import { createMerchant } from '../../server/merchant/channel3.mjs';
import { createKitSolver } from '../../server/kit/solver.mjs';
import { createKitReranker } from '../../server/kit/rerank.mjs';
import { kitDescription } from '../../server/kit/planner.mjs';
import { familyWith, mutableClock, startServer } from '../helpers/family-http.mjs';
import { kitCatalog, kitProduct } from '../helpers/kit-catalog.mjs';
import { fitCatalog, fitProduct } from '../helpers/fit-catalog.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const required = process.env.KIT_SOLVER_REQUIRED === '1';
const MONEY_TABLES = ['payment_orders', 'payment_captures', 'payment_refunds', 'deferred_refunds', 'order_checks', 'ledger_entries', 'webhook_events', 'family_offers'];
const money = (db) => JSON.stringify(MONEY_TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
const LIST = [{ name: '4-person tent', quantity: 1, ownedQuantity: 0 }, { name: 'sleeping bag', quantity: 2, ownedQuantity: 0 },
  { name: 'torch', quantity: 2, ownedQuantity: 2 }, { name: 'stove', quantity: 1, ownedQuantity: 0 }];

async function planFamily({ catalog = kitCatalog(), progress = 6000, weekly = 3000, offers = [2000, 1000], list = LIST, solver = null, reranker = null } = {}) {
  const clock = mutableClock('2026-11-08T12:00:00');
  const merchant = createMerchant({ apiKey: 'test-key-not-real', fetch: catalog.fetch, clock });
  const kitSolver = solver ?? createKitSolver({ root, engine: required ? 'native' : 'auto' });
  const s = await startServer({ clock, merchant, extra: { kitSolver, kitReranker: reranker } });
  const people = await familyWith(s, [['Ash', 'adult'], ['Wren', 'child']]);
  const { owner, Ash: ash } = people;
  const state = async (b = owner) => (await b.call('GET', '/api/state')).json;
  const goal = await owner.call('PUT', '/api/goal', { name: 'Camping gear', targetCents: 30000, startingCents: progress, weeklyBudgetCents: weekly, targetDate: '2026-12-27',
    expectedGoalRevision: (await state()).merchantGoalRevision });
  assert.equal(goal.status, 200, JSON.stringify(goal.json));
  if (offers[0]) assert.equal((await owner.call('PUT', '/api/family-choices/offer', { weeklyCents: offers[0] })).status, 200);
  if (offers[1]) assert.equal((await ash.call('PUT', '/api/family-choices/offer', { weeklyCents: offers[1] })).status, 200);
  const saved = await owner.call('PUT', '/api/kit', { goalId: (await state()).goal.id, expectedRevision: 0, items: list.map((l) => ({ ...l, needs: null, from: 'typed' })) });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const lineOf = async (name, b = owner) => (await state(b)).kitPlan.lines.find((l) => l.name === name);
  // Search a line's words, then add the result with this title for that line, with the adult's own count per listing.
  async function add(lineName, title, { b = owner, perListing = 1 } = {}) {
    const found = await b.call('POST', '/api/merchant/search', { query: lineName.replace('4-person ', '') });
    assert.equal(found.status, 200, JSON.stringify(found.json));
    const r = found.json.results.find((x) => x.title.includes(title));
    const st = await state(b);
    return b.call('POST', '/api/kit/listings', { draftId: r.draftId, lineId: st.kitPlan.lines.find((l) => l.name === lineName).lineId, perListing, revision: st.kitPlan.revision });
  }
  const compare = async (reserveCents = 0, b = owner) => {
    const st = await state(b);
    return b.call('POST', '/api/kit/compare', { revision: st.kitPlan.revision, choicesRevision: st.familyChoices.revision, reserveCents });
  };
  const choose = async (card, b = owner) => b.call('PUT', '/api/kit/choice', { revision: (await state(b)).kitPlan.revision, lines: card.lines.map((l) => ({ lineId: l.lineId, candidateId: l.candidateId })) });
  return { s, catalog, clock, kitSolver, ...people, state, lineOf, add, compare, choose };
}
const ACCEPTANCE = [['4-person tent', 'Tent A'], ['4-person tent', 'Tent B'], ['sleeping bag', 'Sleeping bag A'], ['sleeping bag', 'Sleeping bag B'], ['stove', 'Stove A'], ['stove', 'Stove B']];
const summary = (card) => ({ labels: card.labels, totalCents: card.totalCents, weightMg: card.weightMg, retailers: card.retailers, finish: card.finish.finishDate,
  status: card.finish.status, lines: card.lines.map((l) => `${l.name}: ${l.title.replace('Test fixture: ', '')} ×${l.listings}`) });
// A fake Cohere transport for the real adapter: it records each request and answers with `reply(body)`. holdNext() makes the
// next call wait until the test opens it, so the test can change the family's records while Cohere is "answering".
function fakeCohere(reply) {
  const sent = [];
  let gate = null;
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    const g = gate; gate = null;
    if (g) { g.reached(); await g.opened; }
    const out = fake.reply(body);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const fake = { sent, reply, holdNext: () => (gate = waitPoint()), reranker: createKitReranker({ apiKey: 'fake-cohere-key-not-real', fetch }) };
  return fake;
}
// A point a request waits at: `held` resolves once it is reached, and the request goes on after open().
function waitPoint() {
  const g = {};
  g.held = new Promise((r) => { g.reached = r; });
  g.opened = new Promise((r) => { g.open = r; });
  return g;
}
const rankAll = (body) => ({ results: body.documents.map((_, index) => ({ index, relevance_score: 0.5 })) });

test('only adults add listings, for lines still to get, with their own count per listing; owned lines are skipped and nothing is guessed', async () => {
  const f = await planFamily();
  const { s, catalog, owner, Wren: wren } = f;
  try {
    const before = money(s.db);
    for (const [line, title] of ACCEPTANCE) {
      const added = await f.add(line, title);
      assert.deepEqual([added.status, added.json.outcome], [200, 'added'], JSON.stringify(added.json));
    }
    assert.equal(catalog.count('/v1/search'), 3, 'one search per line still to get (a repeated search is the cached public page); none for the torches already at home');
    const tent = await f.lineOf('4-person tent');
    assert.deepEqual(tent.candidates.map((c) => [c.title, c.priceCents, c.weightMg, c.perListing, c.perListingBy, c.merchant, c.issue]), [
      ['Test fixture: Tent A, four-person dome', 8000, 3_000_000, 1, 'Rowan', 'fixture-a.test', null],
      ['Test fixture: Tent B, four-person ultralight', 11000, 1_800_000, 1, 'Rowan', 'fixture-b.test', null]]);
    assert.equal((await f.lineOf('torch')).remaining, 0);
    // The count per listing is the adult's, never a default: without it, nothing is added.
    const found = (await owner.call('POST', '/api/merchant/search', { query: 'stove' })).json.results[0];
    const st = await f.state();
    const stove = st.kitPlan.lines.find((l) => l.name === 'stove').lineId, torch = st.kitPlan.lines.find((l) => l.name === 'torch').lineId;
    for (const [body, code] of [
      [{ lineId: stove }, 'invalid_per_listing'], [{ lineId: stove, perListing: 0 }, 'invalid_per_listing'], [{ lineId: stove, perListing: 1.5 }, 'invalid_per_listing'],
      [{ lineId: torch, perListing: 1 }, 'kit_line_owned'], [{ lineId: 'ki_0000000000000000', perListing: 1 }, 'kit_line_gone'],
      [{ lineId: stove, perListing: 1, revision: 'kp1_stale' }, 'kit_plan_changed'],
    ]) {
      const r = await owner.call('POST', '/api/kit/listings', { draftId: found.draftId, revision: st.kitPlan.revision, ...body });
      assert.equal(r.json.error.code, code, JSON.stringify(body));
    }
    // The same listing again updates its line (here: a two-pack count); it is never a second listing.
    const again = await owner.call('POST', '/api/kit/listings', { draftId: found.draftId, lineId: stove, perListing: 2, revision: st.kitPlan.revision });
    assert.deepEqual([again.json.outcome, (await f.lineOf('stove')).candidates.map((c) => c.perListing)], ['updated', [2, 1]]);
    // A child reads the shared listings but cannot add, remove or check one.
    assert.equal((await f.state(wren)).kitPlan.lines.find((l) => l.name === 'stove').candidates.length, 2);
    for (const [path, body] of [['/api/kit/listings', { draftId: found.draftId, lineId: stove, perListing: 1 }], ['/api/kit/listings/remove', { candidateId: tent.candidates[0].id }],
      ['/api/kit/listings/refresh', { candidateId: tent.candidates[0].id }]]) {
      assert.deepEqual([(await wren.call('POST', path, body)).json.error.code], ['adult_required'], path);
    }
    assert.equal(money(s.db), before, 'no money, offer or ledger record changed');
  } finally { await s.close(); }
});

test('the comparison reproduces the literal example: $150 and $180 fit $180 by Dec 20 and Dec 27; a $120 one-off leaves only the $150 kit, and the $180 kit would finish Jan 3', async () => {
  const f = await planFamily();
  const { s, catalog, kitSolver, owner } = f;
  try {
    for (const [line, title] of ACCEPTANCE) assert.equal((await f.add(line, title)).status, 200);
    const calls = catalog.calls.length, before = money(s.db), revision = (await f.state()).revision;
    const wide = await f.compare(9000);
    assert.equal(wide.status, 200, JSON.stringify(wide.json));
    const w = wide.json;
    assert.deepEqual([w.status, w.ceiling.ceilingCents, w.ceiling.targetDate], ['ok', 18000, '2026-12-27']);
    assert.deepEqual(w.pool, { lines: 3, listings: 6, combinations: 8, feasible: 5, weightComparable: true });
    assert.deepEqual(w.kits.map(summary), [
      { labels: ['lowest_total', 'fewest_retailers'], totalCents: 15000, weightMg: 5_200_000, retailers: 1, finish: '2026-12-20', status: 'fits',
        lines: ['4-person tent: Tent A, four-person dome ×1', 'sleeping bag: Sleeping bag A ×2', 'stove: Stove A ×1'] },
      { labels: ['lower_weight'], totalCents: 18000, weightMg: 4_000_000, retailers: 2, finish: '2026-12-27', status: 'fits',
        lines: ['4-person tent: Tent B, four-person ultralight ×1', 'sleeping bag: Sleeping bag A ×2', 'stove: Stove A ×1'] }],
    'two distinct kits: the one-retailer winner is the lowest total again, so a third is not invented');
    assert.equal(w.kits[0].lines[1].lineCents, 4000, 'two sleeping bags at $20');
    // One change to the one-off amount: everything is recomputed from the same listings, with no catalog call.
    const tight = (await f.compare(12000)).json;
    assert.deepEqual([tight.ceiling.ceilingCents, tight.pool.feasible, tight.kits.map(summary)], [15000, 1, [{ labels: ['lowest_total', 'lower_weight', 'fewest_retailers'],
      totalCents: 15000, weightMg: 5_200_000, retailers: 1, finish: '2026-12-27', status: 'fits', lines: ['4-person tent: Tent A, four-person dome ×1', 'sleeping bag: Sleeping bag A ×2', 'stove: Stove A ×1'] }]]);
    // With the lighter $180 kit chosen, the same one-off makes it late: it would finish Jan 3 at the same offers, $30 short by
    // Dec 27, and the smallest change (switch the tent) is the $150 kit, which still finishes by Dec 27.
    assert.equal((await f.choose(w.kits[1])).status, 200);
    const repaired = (await f.compare(12000)).json;
    assert.deepEqual([repaired.current.totalCents, repaired.current.finish], [18000,
      { status: 'late', finishDate: '2027-01-03', finishWeek: 8, shortfallCents: 3000, weeksLate: 1, deadline: '2026-12-27' }]);
    assert.deepEqual(repaired.kits.map((k) => [k.labels, k.totalCents, k.changes]), [[['smallest_change', 'lowest_total', 'lower_weight', 'fewest_retailers'], 15000, 1]]);
    assert.deepEqual(repaired.kits[0].lines.map((l) => (l.switched ? `${l.name}: ${l.switched.title.replace('Test fixture: ', '')} → ${l.title.replace('Test fixture: ', '')}` : `${l.name}: unchanged`)),
      ['4-person tent: Tent B, four-person ultralight → Tent A, four-person dome', 'sleeping bag: unchanged', 'stove: unchanged']);
    assert.equal(catalog.calls.length, calls, 'comparing makes no catalog call');
    assert.equal(money(s.db), before, 'comparing and choosing change no money, offer or ledger record');
    if (required) assert.ok(kitSolver.stats.native >= 3 && kitSolver.stats.reference === 0, 'every comparison ran the compiled Rust solver');
    assert.equal(revision === (await f.state()).revision, false, 'choosing a kit is shared live');
    const quiet = (await f.state()).revision;
    await f.compare(9000);
    assert.equal((await f.state()).revision, quiet, 'a comparison writes nothing and notifies no one');
    void owner;
  } finally { await s.close(); }
});

test('a kept listing stays fixed: the $160 kit is repaired for $140 by switching one line, beside the $130 kit that switches two', async () => {
  const fixture = (id, title, dollars, domain) => kitProduct(id, `Test fixture: ${title}`, dollars, null, domain);
  const catalog = kitCatalog({ products: {
    tent: [fixture('fxTent90', 'Tent at $90', 90, 'fixture-a.test'), fixture('fxTent70', 'Tent at $70', 70, 'fixture-c.test')],
    'sleeping bag': [fixture('fxBag20', 'Sleeping bag at $20', 20, 'fixture-a.test'), fixture('fxBag10', 'Sleeping bag at $10', 10, 'fixture-c.test')],
    stove: [fixture('fxStove30', 'Stove at $30', 30, 'fixture-a.test'), fixture('fxStove20', 'Stove at $20', 20, 'fixture-c.test')],
  } });
  // production-replanning-commerce-research-20261109.json: $20 recorded plus $20 a week for seven weeks is $160; a $20 one-off leaves $140.
  const f = await planFamily({ catalog, progress: 2000, weekly: 2000, offers: [2000] });
  const { s, owner } = f;
  try {
    for (const [line, title] of [['4-person tent', '$90'], ['4-person tent', '$70'], ['sleeping bag', '$20'], ['sleeping bag', '$10'], ['stove', '$30'], ['stove', '$20']]) {
      assert.equal((await f.add(line, title)).status, 200);
    }
    const first = (await f.compare(0)).json;
    assert.equal(first.kits[0].totalCents, 11000, 'the lowest total uses the $70 tent');
    // The family deliberately chooses the $160 kit and keeps its $90 tent.
    const plan = (await f.state()).kitPlan;
    const pick = (name, price) => ({ lineId: plan.lines.find((l) => l.name === name).lineId, candidateId: plan.lines.find((l) => l.name === name).candidates.find((c) => c.priceCents === price).id });
    const chose = await owner.call('PUT', '/api/kit/choice', { revision: plan.revision, lines: [pick('4-person tent', 9000), pick('sleeping bag', 2000), pick('stove', 3000)] });
    assert.equal(chose.status, 200, JSON.stringify(chose.json));
    const tentLine = plan.lines.find((l) => l.name === '4-person tent').lineId;
    assert.equal((await owner.call('PUT', '/api/kit/keep', { revision: (await f.state()).kitPlan.revision, lineId: tentLine, kept: true })).status, 200);
    const fits = (await f.compare(0)).json;
    assert.deepEqual([fits.current.totalCents, fits.current.fits, fits.kits.every((k) => k.lines[0].title.includes('$90'))], [16000, true, true], 'kept: every kit keeps the $90 tent');
    const changed = (await f.compare(2000)).json;
    assert.deepEqual([changed.ceiling.ceilingCents, changed.current.totalCents, changed.current.fits, changed.current.finish.shortfallCents], [14000, 16000, false, 2000]);
    assert.deepEqual(changed.kits.map((k) => [k.labels, k.totalCents, k.changes, k.lines.map((l) => (l.switched ? 'switched' : l.kept ? 'kept' : 'same'))]), [
      [['smallest_change'], 14000, 1, ['kept', 'switched', 'same']],
      [['lowest_total', 'fewest_retailers'], 13000, 2, ['kept', 'switched', 'switched']]]);
    assert.deepEqual(changed.kits[0].lines[1].switched, { candidateId: pick('sleeping bag', 2000).candidateId, title: 'Test fixture: Sleeping bag at $20', merchant: 'fixture-a.test', listings: 2, lineCents: 4000 });
    assert.ok(changed.kits.every((k) => !k.lines[0].title.includes('$70')), 'the cheaper $70 tent is never offered while the $90 tent is kept');
    // Deliberate only: a kept line cannot be switched or its listing removed until an adult stops keeping it.
    const switchTent = await owner.call('PUT', '/api/kit/choice', { revision: (await f.state()).kitPlan.revision, lines: [pick('4-person tent', 7000), pick('sleeping bag', 1000), pick('stove', 3000)] });
    assert.equal(switchTent.json.error.code, 'kit_line_kept');
    assert.equal((await owner.call('POST', '/api/kit/listings/remove', { candidateId: pick('4-person tent', 9000).candidateId })).json.error.code, 'kit_listing_kept');
    // Choosing the repair keeps the tent kept; nothing else changed by itself.
    assert.equal((await f.choose(changed.kits[0])).status, 200);
    const after = (await f.state()).kitPlan.selection.lines;
    assert.deepEqual(after.map((l) => [l.kept, l.chosenBy]), [[true, 'Rowan'], [false, 'Rowan'], [false, 'Rowan']].slice(0, after.length));
  } finally { await s.close(); }
});

test('an incomplete list, a kit that does not fit and a list with nothing to buy are said plainly, with no total filled in', async () => {
  const f = await planFamily();
  const { s, owner } = f;
  try {
    const none = (await f.compare(9000)).json;
    assert.deepEqual([none.status, none.missing.map((m) => m.name), none.kits], ['incomplete', ['4-person tent', 'sleeping bag', 'stove'], undefined]);
    for (const [line, title] of ACCEPTANCE.slice(0, 4)) await f.add(line, title);
    const partly = (await f.compare(9000)).json;
    assert.deepEqual([partly.status, partly.missing.map((m) => m.name), partly.ready, partly.needed], ['incomplete', ['stove'], 2, 3]);
    for (const [line, title] of ACCEPTANCE.slice(4)) await f.add(line, title);
    // A one-off so large that no complete kit fits: the closest kit says what keeping the gear or keeping the date means.
    const short = (await f.compare(15000)).json;
    assert.deepEqual([short.status, short.kits, short.closest.totalCents, short.closest.finish.status, short.closest.finish.finishDate, short.closest.finish.shortfallCents],
      ['none_fits', [], 15000, 'late', '2027-01-03', 3000]);
    // Everything already at home: nothing remains to buy on this list, and no zero goal can be made from it.
    const st = await f.state();
    const all = st.kit.items.map(({ id, name, needs, quantity }) => ({ id, name, needs, quantity, ownedQuantity: quantity }));
    assert.equal((await owner.call('PUT', '/api/kit', { goalId: st.goal.id, expectedRevision: st.kit.revision, items: all })).status, 200);
    const owned = (await f.compare(9000)).json;
    assert.equal(owned.status, 'nothing_to_buy');
    const review = await owner.call('POST', '/api/kit/review', { revision: (await f.state()).kitPlan.revision, choicesRevision: (await f.state()).familyChoices.revision, reserveCents: 0 });
    assert.deepEqual([review.status, review.json.error.code], [409, 'nothing_to_buy']);
    assert.equal((await f.state()).goal.targetCents, 30000, 'the goal is unchanged');
  } finally { await s.close(); }
});

test('review needs fresh catalog answers; adoption saves the goal, the kit and its family schedule in one transaction, and a later price change makes the schedule stale', async () => {
  const f = await planFamily();
  const { s, catalog, clock, owner, Ash: ash } = f;
  try {
    for (const [line, title] of ACCEPTANCE) await f.add(line, title);
    const shown = (await f.compare(9000)).json;
    assert.equal((await f.choose(shown.kits[0])).status, 200);
    const ledger = JSON.stringify(s.db.prepare('SELECT * FROM ledger_entries ORDER BY rowid').all());
    const reviewBody = async () => { const st = await f.state(); return { revision: st.kitPlan.revision, choicesRevision: st.familyChoices.revision, reserveCents: 9000 }; };
    const review = await owner.call('POST', '/api/kit/review', await reviewBody());
    assert.equal(review.status, 200, JSON.stringify(review.json));
    const r = review.json;
    assert.deepEqual([r.goal, r.kit.totalCents, r.schedule.outcome, r.schedule.finishDate, r.schedule.proposable], [
      { targetCents: 15000, targetDate: '2026-12-27', weeklyBudgetCents: 3000 }, 15000, 'on_time', '2026-12-20', true]);
    assert.equal((await f.state()).goal.targetCents, 30000, 'reviewing saves nothing');
    // Another adult's offer changes after the review: the adoption is refused as a whole, and nothing is saved.
    const st = await f.state();
    const adopt = (extra = {}) => owner.call('POST', '/api/kit/adopt', { goalId: st.goal.id, expectedGoalRevision: st.merchantGoalRevision,
      goal: { name: 'Camping gear', targetCents: 15000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-27' },
      kit: { revision: r.revision, choicesRevision: r.choicesRevision }, schedule: { reserveCents: 9000, revision: r.schedule.revision }, ...extra });
    assert.equal((await ash.call('PUT', '/api/family-choices/offer', { weeklyCents: 1500 })).status, 200);
    const refused = await adopt();
    assert.deepEqual([refused.status, refused.json.error.code, (await f.state()).goal.targetCents], [409, 'choices_changed', 30000]);
    assert.equal((await ash.call('PUT', '/api/family-choices/offer', { weeklyCents: 1000 })).status, 200);
    const fresh = await f.state();
    assert.equal(fresh.familyChoices.revision, r.choicesRevision, 'the same figures again');
    const below = await adopt({ goal: { name: 'Camping gear', targetCents: 14000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-27' } });
    assert.equal(below.json.error.code, 'kit_goal_below_total');
    const saved = await adopt();
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const after = saved.json.state;
    assert.deepEqual([after.goal.targetCents, after.goalKit.totalCents, after.goalKit.lines.map((l) => [l.name, l.listings, l.lineCents]), after.goalItem], [15000, 15000,
      [['4-person tent', 1, 8000], ['sleeping bag', 2, 4000], ['stove', 1, 3000]], null]);
    assert.deepEqual([saved.json.plan.status, saved.json.plan.family.kit, saved.json.plan.family.finishDate], ['proposed', { totalCents: 15000, lineCount: 3 }, '2026-12-20']);
    assert.equal(JSON.stringify(s.db.prepare('SELECT * FROM ledger_entries ORDER BY rowid').all()), ledger, 'adoption pays, credits and approves nothing');
    // Half an hour later the catalog answers have expired: a review asks for a price check first, naming each listing.
    clock.advance(20 * 60_000);
    await f.state(); // activity keeps the half-hour session alive
    clock.advance(11 * 60_000);
    const stale = await owner.call('POST', '/api/kit/review', await reviewBody());
    assert.deepEqual([stale.status, stale.json.error.code, stale.json.error.issues?.length], [409, 'kit_needs_check', 3]);
    // An explicit price check finds the tent dearer: the proposed schedule rests on the old price, so it is stale.
    catalog.lookup.set('fixtureTentA', kitProduct('fixtureTentA', 'Test fixture: Tent A, four-person dome', 85, 3000, 'fixture-a.test', { unit: 'kg' }));
    const tent = (await f.lineOf('4-person tent')).candidates.find((c) => c.title.includes('Tent A'));
    const checked = await owner.call('POST', '/api/kit/listings/refresh', { candidateId: tent.id });
    assert.deepEqual([checked.status, checked.json.usable, checked.json.previousPriceCents, checked.json.priceCents], [200, true, 8000, 8500]);
    assert.deepEqual(checked.json.state.planReview.changes.map((c) => c.code), ['kit_price_changed']);
  } finally { await s.close(); }
});

test('family boundaries: a child reads the shared kit but cannot compare, choose, keep, review or adopt; another family and foreign ids are refused', async () => {
  const f = await planFamily();
  const { s, owner, Wren: wren } = f;
  try {
    for (const [line, title] of ACCEPTANCE) await f.add(line, title);
    const shown = (await f.compare(9000)).json;
    assert.equal((await f.choose(shown.kits[0])).status, 200);
    const child = await f.state(wren);
    assert.equal(child.kitPlan.selection.lines.length, 3, 'a child reads the chosen kit');
    const body = { revision: child.kitPlan.revision, choicesRevision: child.familyChoices.revision, reserveCents: 0 };
    for (const [method, path, extra] of [['POST', '/api/kit/compare', {}], ['POST', '/api/kit/prefer', { preference: 'light' }], ['PUT', '/api/kit/choice', { lines: [] }],
      ['PUT', '/api/kit/keep', { lineId: child.kitPlan.lines[0].lineId, kept: true }], ['POST', '/api/kit/review', {}], ['POST', '/api/kit/adopt', {}]]) {
      const r = await wren.call(method, path, { ...body, ...extra });
      assert.deepEqual([r.status, r.json.error.code], [403, 'adult_required'], path);
    }
    // Another household on the same server sees none of it, and cannot name this one's goal or listings.
    const { owner: stranger } = await familyWith(s, []);
    assert.deepEqual((await stranger.call('GET', '/api/state')).json.kitPlan.lines, [], 'another family has its own, empty kit');
    const mine = (await f.state()).kitPlan;
    assert.equal((await stranger.call('POST', '/api/kit/listings/remove', { candidateId: mine.lines[0].candidates[0].id })).json.error.code, 'kit_listing_gone');
    const foreign = await owner.call('POST', '/api/kit/compare', { ...body, goalId: 'goal_someone_else' });
    assert.deepEqual([foreign.status, foreign.json.error.code], [403, 'scope_mismatch']);
    assert.equal((await owner.call('POST', '/api/kit/listings/remove', { candidateId: 'kc_000000000000000000000000' })).json.error.code, 'kit_listing_gone');
    assert.equal((await owner.call('POST', '/api/kit/listings/remove', { candidateId: '../etc' })).json.error.code, 'invalid_kit_listing');
    assert.ok(mine.lines.every((l) => l.candidates.every((c) => !('url' in c) && !('draftId' in c))), 'the shared view carries no retailer link or catalog reference');
  } finally { await s.close(); }
});

test('a late comparison for figures that changed meanwhile is refused, and a failing solver shows no kit', async () => {
  let release;
  const held = { engine: 'held', stats: {}, async solve(request) { await new Promise((r) => { release = r; }); return held.inner.solve(request); }, inner: createKitSolver({ root, engine: 'reference' }) };
  const f = await planFamily({ solver: held });
  const { s, owner, Ash: ash } = f;
  try {
    for (const [line, title] of ACCEPTANCE) await f.add(line, title);
    const pending = f.compare(9000);
    while (!release) await new Promise((r) => setTimeout(r, 5));
    assert.equal((await ash.call('PUT', '/api/family-choices/offer', { weeklyCents: 1500 })).status, 200);
    release();
    const late = await pending;
    assert.deepEqual([late.status, late.json.error.code], [409, 'kit_plan_changed']);
    held.solve = async () => { throw new DomainError(502, 'kit_solver_failed', 'The kit comparison could not be completed this time. Nothing was changed; try again.'); };
    const failing = await f.compare(9000);
    assert.deepEqual([failing.status, failing.json.error.code, failing.json.kits], [502, 'kit_solver_failed', undefined], 'a failed solve shows no kit');
    void owner;
  } finally { await s.close(); }
});

// Ordering asks Cohere only for a request that still holds once the solver has answered: the session must be the one that
// asked and the family's facts the ones compared. Both are checked before the minute's quota and before any Cohere call,
// on the early return as on the ordering path (the root probe: a member signed out while the solver was held, and the
// fake ranker was still called once).
test('a preference request whose figures changed or whose session ended while comparing makes no Cohere call and spends no quota', async (t) => {
  const cohere = fakeCohere(rankAll);
  const inner = createKitSolver({ root, engine: required ? 'native' : 'auto' });
  let gate = null;
  const solver = { engine: inner.engine, stats: inner.stats, async solve(request, options) {
    const g = gate; gate = null;
    if (g) { g.reached(); await g.opened; }
    return inner.solve(request, options);
  } };
  const f = await planFamily({ solver, reranker: cohere.reranker });
  const { s, owner, Ash: ash } = f;
  try {
    for (const [line, title] of ACCEPTANCE) assert.equal((await f.add(line, title)).status, 200);
    const ask = async (b, reserveCents) => { const st = await f.state(b); return { revision: st.kitPlan.revision, choicesRevision: st.familyChoices.revision, reserveCents, preference: 'light' }; };
    // With a $120 one-off only the $150 kit fits, so there is nothing to order (the early return); with $90 five kits fit.
    for (const [meanwhile, reserveCents, change, expected] of [
      ['Rowan changes their offer (one kit fits)', 12000, () => owner.call('PUT', '/api/family-choices/offer', { weeklyCents: 2500 }), [409, 'kit_plan_changed']],
      ['Rowan changes their offer back (five kits fit)', 9000, () => owner.call('PUT', '/api/family-choices/offer', { weeklyCents: 2000 }), [409, 'kit_plan_changed']],
      ['Ash signs out (five kits fit)', 9000, () => ash.call('POST', '/api/auth/signout', {}), [401, 'session_expired']],
    ]) {
      await t.test(meanwhile, async () => {
        const body = await ask(ash, reserveCents), calls = cohere.sent.length;
        const g = (gate = waitPoint());
        const pending = ash.call('POST', '/api/kit/prefer', body);
        await g.held;
        assert.equal((await change()).status, 200);
        g.open();
        const late = await pending;
        assert.deepEqual([late.status, late.json.error?.code, late.json.preference, late.json.kits], [...expected, undefined, undefined], JSON.stringify(late.json));
        assert.equal(cohere.sent.length - calls, 0, 'no Cohere call');
      });
    }
    await t.test('none of them spent the household’s six orderings a minute', async () => {
      const body = await ask(owner, 9000), calls = cohere.sent.length;
      for (let i = 1; i <= 6; i++) {
        const r = await owner.call('POST', '/api/kit/prefer', body);
        assert.deepEqual([r.status, r.json.preference?.status, r.json.error?.code], [200, 'ok', undefined], `ordering ${i}`);
      }
      assert.equal((await owner.call('POST', '/api/kit/prefer', body)).json.error.code, 'kit_rank_busy');
      assert.equal(cohere.sent.length - calls, 6, 'only the six current requests reached Cohere');
    });
  } finally { await s.close(); }
});

test('ordering by a preference sends only public catalog text and a fixed sentence; a failure leaves the kits as they were', async () => {
  const sent = [];
  let reply = (body) => ({ results: body.documents.map((_, i) => ({ index: body.documents.length - 1 - i, relevance_score: 0.9 - i * 0.1 })) });
  const reranker = createKitReranker({ apiKey: 'fake-cohere-key-not-real', fetch: async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ url, body });
    const out = reply(body);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } });
  const f = await planFamily({ reranker });
  const { s, catalog, owner } = f;
  try {
    for (const [line, title] of ACCEPTANCE) await f.add(line, title);
    const st = await f.state();
    const body = { revision: st.kitPlan.revision, choicesRevision: st.familyChoices.revision, reserveCents: 9000 };
    assert.deepEqual(st.kitPlan.preference.options.map((o) => o.key), ['light', 'sturdy', 'simple', 'warm']);
    assert.equal(st.kitPlan.preference.mode, 'live');
    const calls = catalog.calls.length, before = money(s.db);
    const plain = (await owner.call('POST', '/api/kit/compare', body)).json;
    assert.equal(sent.length, 0, 'comparing never asks the model');
    const ordered = await owner.call('POST', '/api/kit/prefer', { ...body, preference: 'light' });
    assert.equal(ordered.status, 200, JSON.stringify(ordered.json));
    const o = ordered.json;
    assert.equal(sent.length, 1);
    // Only the five kits that fit, lowest totals first, as public titles and retailers; a fixed sentence as the query.
    assert.equal(sent[0].body.documents.length, 5);
    assert.equal(sent[0].body.query, 'camping gear that is lightweight, compact and easy to carry');
    const text = JSON.stringify(sent[0].body);
    for (const secret of ['Rowan', 'Ash', 'Wren', 'Camping gear', '4-person tent', 'sleeping bag:', '2026-12', '9000', '90.00', '150', '180', 'House of']) {
      assert.ok(!text.includes(secret), `nothing like "${secret}" is sent`);
    }
    // Public titles and shops only: how many listings the family needs (two sleeping bags here) is not sent.
    assert.equal(sent[0].body.documents[0], 'Test fixture: Tent A, four-person dome (fixture-a.test); Test fixture: Sleeping bag A (fixture-a.test); Test fixture: Stove A (fixture-a.test)');
    assert.ok(sent[0].body.documents.every((d) => !/×|\d/.test(d)), 'no count or other figure is sent');
    // The fake ranks the last of the five first: it is not among the shown kits, so it takes the least important place.
    assert.deepEqual([o.preference.status, o.preference.label, o.preference.ordered], ['ok', 'Lighter to carry', 5]);
    assert.deepEqual(o.kits.map((k) => [k.labels, k.totalCents]), [[['lowest_total', 'fewest_retailers'], 15000], [['lower_weight', 'preference'], 18000]],
      'the match is the $180 kit already shown, so it is labelled, not added');
    assert.deepEqual(plain.kits.map((k) => k.key), o.kits.map((k) => k.key));
    // A malformed or failed answer: the same kits, said plainly, with no ordering claimed.
    reply = () => ({ results: [{ index: 0, relevance_score: 0.5 }, { index: 0, relevance_score: 0.4 }] });
    const bad = (await owner.call('POST', '/api/kit/prefer', { ...body, preference: 'sturdy' })).json;
    assert.deepEqual([bad.preference.status, bad.kits.map((k) => k.labels)], ['failed', plain.kits.map((k) => k.labels)]);
    assert.match(bad.preference.message, /could not check.*unchanged/);
    reply = () => new Response('{}', { status: 503 });
    assert.equal((await owner.call('POST', '/api/kit/prefer', { ...body, preference: 'simple' })).json.preference.status, 'failed');
    assert.equal((await owner.call('POST', '/api/kit/prefer', { ...body, preference: 'a sentence the family typed' })).json.error.code, 'invalid_preference');
    // At most six orderings a minute for a household: each is a provider call.
    reply = (b) => ({ results: b.documents.map((_, index) => ({ index, relevance_score: 0.5 })) });
    for (let i = 0; i < 3; i++) assert.equal((await owner.call('POST', '/api/kit/prefer', { ...body, preference: 'warm' })).status, 200);
    assert.equal((await owner.call('POST', '/api/kit/prefer', { ...body, preference: 'warm' })).json.error.code, 'kit_rank_busy');
    assert.equal(catalog.calls.length, calls, 'no catalog call');
    assert.equal(money(s.db), before, 'ordering writes nothing');
    // With fewer than two kits that fit, there is nothing to order and no call is made.
    f.clock.advance(61_000);
    const sentBefore = sent.length;
    const tight = await owner.call('POST', '/api/kit/prefer', { ...body, reserveCents: 12000, preference: 'light' });
    assert.deepEqual([tight.json.preference.status, sent.length], ['not_needed', sentBefore]);
  } finally { await s.close(); }
  const off = await planFamily();
  try {
    for (const [line, title] of ACCEPTANCE) await off.add(line, title);
    const st = await off.state();
    assert.equal(st.kitPlan.preference.mode, 'off');
    const r = await off.owner.call('POST', '/api/kit/prefer', { revision: st.kitPlan.revision, choicesRevision: st.familyChoices.revision, reserveCents: 9000, preference: 'light' });
    assert.deepEqual([r.status, r.json.error.code], [503, 'kit_rank_off']);
  } finally { await off.s.close(); }
});

// A Cohere answer or failure is used only for the facts it was asked about. If the family's figures changed while Cohere
// answered, the request is refused either way (the root probe: an offer changed while a failing ranker waited, and the old
// revision came back as a 200). A failure for figures that are still current keeps the fallback: the kits as compared.
test('an ordering that ends after the figures changed is refused whether Cohere failed or answered; a failure for current figures keeps the current kits', async (t) => {
  const cohere = fakeCohere(rankAll);
  const f = await planFamily({ reranker: cohere.reranker });
  const { s, owner, Ash: ash } = f;
  try {
    for (const [line, title] of ACCEPTANCE) assert.equal((await f.add(line, title)).status, 200);
    const ask = async (preference) => { const st = await f.state(); return { revision: st.kitPlan.revision, choicesRevision: st.familyChoices.revision, reserveCents: 9000, preference }; };
    for (const [name, reply, weeklyCents] of [['Cohere fails', () => new Response('{}', { status: 503 }), 1500], ['Cohere answers', rankAll, 1000]]) {
      await t.test(`${name} after Ash changed their offer`, async () => {
        cohere.reply = reply;
        const body = await ask('light');
        const g = cohere.holdNext();
        const pending = owner.call('POST', '/api/kit/prefer', body);
        await g.held;
        assert.equal((await ash.call('PUT', '/api/family-choices/offer', { weeklyCents })).status, 200);
        g.open();
        const late = await pending;
        assert.deepEqual([late.status, late.json.error?.code, late.json.preference, late.json.kits], [409, 'kit_plan_changed', undefined, undefined], JSON.stringify(late.json));
      });
    }
    await t.test('Cohere fails for the figures as they are now', async () => {
      cohere.reply = () => new Response('{}', { status: 503 });
      const body = await ask('sturdy');
      const plain = (await owner.call('POST', '/api/kit/compare', body)).json;
      const failed = await owner.call('POST', '/api/kit/prefer', body);
      assert.equal(failed.status, 200, JSON.stringify(failed.json));
      const j = failed.json;
      assert.deepEqual([j.preference.status, j.preference.matchKey, j.revision, j.choicesRevision], ['failed', undefined, plain.revision, plain.choicesRevision]);
      assert.match(j.preference.message, /HTTP 503.*unchanged/);
      assert.deepEqual(j.kits.map((k) => [k.key, k.labels]), plain.kits.map((k) => [k.key, k.labels]));
    });
    assert.equal(cohere.sent.length, 3, 'one Cohere call for each request');
  } finally { await s.close(); }
});

// Cohere ranking none of the kits is not an order (the root probe's empty reply came back as a match). A reply that ranks
// only some of them still names Cohere's own first choice, and says how many it ranked of how many were sent.
test('an empty Cohere ranking is a failure with no match; a partial one names Cohere’s first choice and how many it ranked', async () => {
  const cohere = fakeCohere(() => ({ results: [] }));
  const f = await planFamily({ reranker: cohere.reranker });
  const { s, owner } = f;
  try {
    for (const [line, title] of ACCEPTANCE) assert.equal((await f.add(line, title)).status, 200);
    const st = await f.state();
    const body = { revision: st.kitPlan.revision, choicesRevision: st.familyChoices.revision, reserveCents: 9000 };
    const plain = (await owner.call('POST', '/api/kit/compare', body)).json;
    const empty = await owner.call('POST', '/api/kit/prefer', { ...body, preference: 'light' });
    assert.equal(empty.status, 200, JSON.stringify(empty.json));
    const e = empty.json;
    assert.deepEqual([e.preference.status, e.preference.matchKey, e.preference.ordered, e.preference.excerpt], ['failed', undefined, undefined, undefined], JSON.stringify(e.preference));
    assert.match(e.preference.message, /ranked none of these kits.*unchanged/);
    assert.deepEqual(e.kits.map((k) => [k.key, k.labels]), plain.kits.map((k) => [k.key, k.labels]), 'no kit is labelled the match');
    // Cohere ranks only the $180 kit, the one of the five with Tent B: it is the match, and one of five is said to be ordered.
    cohere.reply = (b) => ({ results: [{ index: b.documents.findIndex((d) => d.includes('Tent B')), relevance_score: 0.8 }] });
    const partial = (await owner.call('POST', '/api/kit/prefer', { ...body, preference: 'light' })).json;
    assert.deepEqual([partial.preference.status, partial.preference.ordered, partial.preference.sent], ['ok', 1, 5], JSON.stringify(partial.preference));
    assert.deepEqual(partial.kits.map((k) => [k.labels, k.totalCents]), [[['lowest_total', 'fewest_retailers'], 15000], [['lower_weight', 'preference'], 18000]]);
    assert.equal(cohere.sent.length, 2);
  } finally { await s.close(); }
});

// What Cohere reads of a kit is the same whatever the family needs: the root probe's one tent and twenty tents of the
// same public listing gave "1 × …" and "20 × …". Counts, prices, weights and the list's own words stay on this server.
test('a kit’s Cohere description is its public titles and shops only, the same for one listing or twenty', () => {
  const kit = (listings) => ({ lines: [{ lineId: 'ki_0000000000000001', name: 'tents for the family', listings, perListing: 1, bought: listings, surplus: 0,
    priceCents: 8000, lineCents: listings * 8000, weightMg: listings * 3_000_000, kept: false, title: 'Public tent title', merchant: 'shop.test' }] });
  assert.equal(kitDescription(kit(1)), 'Public tent title (shop.test)');
  assert.equal(kitDescription(kit(20)), kitDescription(kit(1)));
});

test('a schema-11 database gains only the three kit-planner tables; every earlier row is unchanged', () => {
  const step = MIGRATIONS.findIndex((m) => m.id === 'kit-planner');
  assert.deepEqual([step, MIGRATIONS.length], [11, 12], 'the kit planner is step 12');
  const dir = mkdtempSync(path.join(tmpdir(), 'our-castle-kit-planner-'));
  const file = path.join(dir, 'schema-11.sqlite');
  const old = new DatabaseSync(file);
  old.exec('PRAGMA foreign_keys = ON');
  MIGRATIONS.slice(0, step).forEach((m, i) => { if (typeof m === 'string') old.exec(m); else m.ensure(old); old.exec(`PRAGMA user_version = ${i + 1}`); });
  old.exec("INSERT INTO households (id, name, play_mode, crest_field, crest_charge, is_example, setup_complete, created_at) VALUES ('hh_kept', 'House Kept', 'family', 'cobalt', 'stag', 0, 1, '2026-11-01T00:00:00.000Z')");
  const tables = (d) => d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  const rows = (d, names) => Object.fromEntries(names.map((t) => [t, d.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map((r) => ({ ...r }))]));
  const beforeTables = tables(old), before = rows(old, beforeTables);
  old.close();
  const db = openDatabase(file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 12);
  assert.deepEqual(tables(db).filter((t) => !beforeTables.includes(t)), ['goal_kits', 'kit_candidates', 'kit_selections']);
  assert.equal(tables(db).length, 27);
  assert.deepEqual(rows(db, beforeTables), before, 'every earlier row is unchanged');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});

test('a listing found for must-haves keeps them as hard needs: once the catalog contradicts one, it is no longer compared', async () => {
  const catalog = fitCatalog();
  const f = await planFamily({ catalog, list: [{ name: '4-person tent', quantity: 1, ownedQuantity: 0 }] });
  const { s, owner } = f;
  try {
    assert.equal((await owner.call('POST', '/api/merchant/categories', { query: 'tent' })).status, 200);
    assert.equal((await owner.call('POST', '/api/merchant/category', { slug: 'fixture-tents' })).status, 200);
    const st = await f.state();
    const found = await owner.call('POST', '/api/family-choices/fit', { query: 'tent', category: 'fixture-tents', mustHaves: [{ key: 'fixture-capacity', values: ['4 person'] }],
      reserveCents: 0, revision: st.familyChoices.revision });
    assert.equal(found.status, 200, JSON.stringify(found.json));
    const tentA = found.json.results.find((r) => r.productId === 'fixtureTent4pA');
    const tentLine = st.kitPlan.lines[0].lineId;
    const added = await owner.call('POST', '/api/kit/listings', { draftId: tentA.draftId, lineId: tentLine, perListing: 1, revision: st.kitPlan.revision });
    assert.equal(added.status, 200, JSON.stringify(added.json));
    const listing = (await f.lineOf('4-person tent')).candidates[0];
    assert.deepEqual([listing.need, listing.issue], [{ category: 'Tents (test fixture)', mustHaves: ['Sleeps (test fixture)'], status: 'meets' }, null]);
    assert.deepEqual((await f.compare(0)).json.kits.map((k) => k.totalCents), [12000]);
    // A price check now reports two-person: the must-have is contradicted, so the listing is not compared and the item is
    // named as missing; the kit list's own words are never treated as a catalog fact.
    catalog.lookup.set('fixtureTent4pA', fitProduct('fixtureTent4pA', 'Test fixture: Four-person tent A', 120, { 'fixture-capacity': ['2 person'] }));
    const checked = await owner.call('POST', '/api/kit/listings/refresh', { candidateId: listing.id });
    assert.equal(checked.status, 200, JSON.stringify(checked.json));
    assert.equal((await f.lineOf('4-person tent')).candidates[0].issue, 'need_misses');
    const after = (await f.compare(0)).json;
    assert.deepEqual([after.status, after.missing.map((m) => m.name)], ['incomplete', ['4-person tent']]);
  } finally { await s.close(); }
});
