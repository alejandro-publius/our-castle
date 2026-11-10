import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { MIGRATIONS, openDatabase } from '../../server/db.mjs';
import { createMerchant } from '../../server/merchant/channel3.mjs';
import { fitCatalog, fitProduct, fitProducts } from '../helpers/fit-catalog.mjs';
import { browser, familyWith, mutableClock, startServer } from '../helpers/family-http.mjs';

// Finding a purchase that fits the family, over real HTTP in family mode. The merchant is the real Channel3 code over a
// FAKE transport. Its taxonomy, attribute handles, values and products are invented test fixtures, labelled as such:
// they are not a claim about Channel3's live tent category. The figures are the task's example:
// - local day Nov 8, 2026, goal date Dec 20 (week 6), $60.00 recorded, a household weekly amount of $30.00;
// - Rowan offers $20.00 a week and Ash $10.00; a one-off $90.00 is tried, so the planning price ceiling is $150.00.
// Expected cents and dates are written out here, not computed by the code under test.
const root = fileURLToPath(new URL('../../', import.meta.url));
const MONEY_TABLES = ['payment_orders', 'payment_captures', 'payment_refunds', 'deferred_refunds', 'order_checks', 'ledger_entries', 'webhook_events'];
const records = (db) => JSON.stringify([MONEY_TABLES.map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()), db.prepare('SELECT * FROM goals').all(),
  db.prepare('SELECT * FROM goal_items').all(), db.prepare('SELECT * FROM plans').all(), db.prepare('SELECT * FROM achievements').all(),
  db.prepare('SELECT * FROM family_offers ORDER BY rowid').all(), db.prepare('SELECT * FROM family_choices ORDER BY rowid').all()]);
const CAPACITY = [{ key: 'fixture-capacity', values: ['4 person', '6 person'] }];
const titles = (rows) => rows.map((r) => r.title);

async function family({ catalog = fitCatalog() } = {}) {
  const clock = mutableClock('2026-11-08T12:00:00');
  const s = await startServer({ clock, merchant: createMerchant({ apiKey: 'test-key-not-real', fetch: catalog.fetch, clock }) });
  const people = await familyWith(s, [['Ash', 'adult'], ['Wren', 'child']]);
  const { owner } = people;
  const state = async (b = owner) => (await b.call('GET', '/api/state')).json;
  const goal = await owner.call('PUT', '/api/goal', { name: 'Camping gear', targetCents: 30000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-20', expectedGoalRevision: (await state()).merchantGoalRevision });
  assert.equal(goal.status, 200, JSON.stringify(goal.json));
  assert.equal((await owner.call('PUT', '/api/family-choices/offer', { weeklyCents: 2000 })).status, 200);
  assert.equal((await people.Ash.call('PUT', '/api/family-choices/offer', { weeklyCents: 1000 })).status, 200);
  // Kinds of item and their must-haves: explicit look-ups the later searches rely on.
  const ready = async (b = owner) => {
    assert.equal((await b.call('POST', '/api/merchant/categories', { query: 'tent' })).status, 200);
    assert.equal((await b.call('POST', '/api/merchant/category', { slug: 'fixture-tents' })).status, 200);
  };
  const fit = async (body = {}, b = owner) => b.call('POST', '/api/family-choices/fit', { query: 'tent', category: 'fixture-tents', mustHaves: CAPACITY, reserveCents: 9000,
    revision: (await state(b)).familyChoices.revision, ...body });
  return { s, fake: catalog, catalog, clock, ...people, state, ready, fit };
}

test('a family-fit search recommends only suitable items that fit the family’s date (a feature gap before this branch)', async () => {
  const f = await family();
  const { s, owner, fake } = f;
  try {
    // Today's ordinary search: words and a budget the family must work out by hand. It shows the first three products the
    // catalog sent, including the two-person tent, and carries no capacity fact or date. It stays available, unchanged.
    const ordinary = await owner.call('POST', '/api/merchant/search', { query: 'tent', budgetCents: 15000 });
    assert.equal(ordinary.status, 200, JSON.stringify(ordinary.json));
    assert.deepEqual(ordinary.json.results.map((r) => [r.title, r.priceCents, r.usable]), [
      ['Test fixture: Two-person tent', 9000, true], ['Test fixture: Four-person tent A', 12000, true], ['Test fixture: Tent with no capacity fact', 13000, true]]);
    assert.equal(ordinary.json.results.some((r) => 'fit' in r || 'facts' in r), false);
    assert.deepEqual(fake.calls.at(-1).body, { query: 'tent', limit: 3, config: { country: 'US', currency: 'USD', language: 'en' }, filters: { price: { max_price: 150 } } });

    const before = records(s.db), calls = fake.calls.length;
    const st = await f.state();
    // 1. What kind of item: catalog categories for the family's own words, chosen explicitly.
    const categories = await owner.call('POST', '/api/merchant/categories', { query: 'tent' });
    assert.equal(categories.status, 200, JSON.stringify(categories.json));
    assert.deepEqual(categories.json.categories.map((c) => [c.slug, c.title, c.path]), [
      ['fixture-tents', 'Tents (test fixture)', ['Outdoor (test fixture)', 'Tents (test fixture)']],
      ['fixture-tarps', 'Tarps (test fixture)', ['Outdoor (test fixture)', 'Tarps (test fixture)']]]);
    // 2. The category's own must-haves: enumerated, non-color attributes only, with the catalog's allowed values.
    const detail = await owner.call('POST', '/api/merchant/category', { slug: 'fixture-tents' });
    assert.equal(detail.status, 200, JSON.stringify(detail.json));
    assert.deepEqual(detail.json.category.attributes, [
      { key: 'fixture-capacity', name: 'Sleeps (test fixture)', values: ['1 person', '2 person', '4 person', '6 person'] },
      { key: 'fixture-season', name: 'Season rating (test fixture)', values: ['3-season', '4-season'] }]);
    // 3. The fit search: the server derives the price ceiling from the offers, the date and the one-off amount.
    const fit = await owner.call('POST', '/api/family-choices/fit', { query: 'tent', category: 'fixture-tents',
      mustHaves: [{ key: 'fixture-capacity', values: ['4 person', '6 person'] }], reserveCents: 9000, revision: st.familyChoices.revision });
    assert.equal(fit.status, 200, JSON.stringify(fit.json));
    assert.deepEqual(fit.json.ceiling, { ceilingCents: 15000, familyCeilingCents: 15000, progressCents: 6000, addableCents: 9000, weeks: 6, capacityCents: 3000,
      reserveCents: 9000, targetDate: '2026-12-20', budgetCents: null, limitedBy: 'family' });
    assert.deepEqual(fit.json.results.map((r) => [r.title, r.priceCents, r.finishDate, r.fit.status]), [
      ['Test fixture: Four-person tent A', 12000, '2026-12-13', 'suitable'],
      ['Test fixture: Four-person tent B', 15000, '2026-12-20', 'suitable']]);
    // Only public words, catalog taxonomy values, the price ceiling and the locale left the server.
    assert.deepEqual(fake.calls.slice(calls).map((c) => [c.method, c.url.replace('https://api.trychannel3.com', ''), c.body]), [
      ['GET', '/v1/categories/search?query=tent&limit=5', null],
      ['GET', '/v1/categories/fixture-tents', null],
      ['POST', '/v1/search', { query: 'tent', limit: 12, filters: { category_ids: ['fixture-tents'], attributes: { 'fixture-capacity': ['4 person', '6 person'] }, price: { max_price: 150 } },
        config: { country: 'US', currency: 'USD', language: 'en' } }]]);
    assert.equal(records(s.db), before, 'looking up categories and searching wrote nothing');
  } finally {
    await s.close();
  }
});

test('every other item gets one honest reason; a $120.00 one-off or a lower typed limit lowers the ceiling, and nothing is loosened', async () => {
  const f = await family();
  const { s, owner, fake } = f;
  try {
    await f.ready();
    const first = (await f.fit()).json;
    // Known mismatches first, then what is unknown; the catalog's own facts only, never a title word.
    assert.deepEqual(first.others.map((o) => [o.title, o.status, o.reason.code]), [
      ['Test fixture: Two-person tent', 'not_suitable', 'must_have'],
      ['Test fixture: Tent with no capacity fact', 'unknown', 'must_have_missing'],
      ['Test fixture: Four-person tent priced in euros', 'not_suitable', 'currency'],
      ['Test fixture: Six-person tent, out of stock', 'not_suitable', 'out_of_stock'],
      ['Test fixture: Six-person tent', 'not_suitable', 'over_ceiling'],
      ['Test fixture: Four-person tarp shelter', 'not_suitable', 'category']]);
    assert.deepEqual([first.inspected, first.moreSuitable], [8, 0]);
    const why = first.results[0].fit;
    assert.deepEqual([why.check.status, why.check.category.status, why.check.mustHaves.map((m) => [m.name, m.found, m.status])], ['meets', 'match', [['Sleeps (test fixture)', ['4 person'], 'match']]]);
    assert.equal('catalog' in first.results[0], false, 'the catalog’s raw facts stay on the server');

    // R = $120.00: the ceiling is $60.00 + 2 × $30.00 = $120.00. Only the $120.00 tent fits, still finishing Dec 20.
    const lower = await f.fit({ reserveCents: 12000 });
    assert.equal(lower.status, 200, JSON.stringify(lower.json));
    assert.deepEqual([lower.json.ceiling.ceilingCents, lower.json.ceiling.addableCents], [12000, 6000]);
    assert.deepEqual(lower.json.results.map((r) => [r.title, r.priceCents, r.finishDate]), [['Test fixture: Four-person tent A', 12000, '2026-12-20']]);
    // Over the lower limit comes first among known mismatches, so it is the reason given even where a fact is also missing.
    assert.deepEqual(lower.json.others.map((o) => [o.title, o.reason.code]).filter(([, code]) => code === 'over_ceiling').map(([t]) => t),
      ['Test fixture: Tent with no capacity fact', 'Test fixture: Four-person tent B', 'Test fixture: Six-person tent, out of stock', 'Test fixture: Six-person tent']);
    assert.equal(titles(lower.json.results).includes('Test fixture: Two-person tent'), false, 'the cheap two-person tent never fills the gap');
    assert.equal(fake.calls.at(-1).body.filters.price.max_price, 120);
    f.clock.advance(61_000); // the existing limit allows six catalog calls a minute
    // A lower price limit the adult typed applies too.
    const typed = await f.fit({ budgetCents: 13000 });
    assert.deepEqual([typed.json.ceiling.ceilingCents, typed.json.ceiling.familyCeilingCents, typed.json.ceiling.limitedBy, titles(typed.json.results)],
      [13000, 15000, 'budget', ['Test fixture: Four-person tent A']]);
    // Without a kind of item, only price, currency and stock are checked: no must-have is claimed.
    const plain = await f.fit({ category: null, mustHaves: [] });
    assert.deepEqual(plain.json.results.map((r) => [r.title, r.fit.check.category.status, r.fit.check.mustHaves.length]),
      [['Test fixture: Four-person tarp shelter', 'not_chosen', 0], ['Test fixture: Two-person tent', 'not_chosen', 0], ['Test fixture: Four-person tent A', 'not_chosen', 0]]);
    assert.deepEqual([plain.json.moreSuitable, fake.calls.at(-1).body.filters], [2, { price: { max_price: 150 } }]);
    // A kind of item with no checkable must-haves is said plainly.
    assert.deepEqual((await owner.call('POST', '/api/merchant/category', { slug: 'fixture-tarps' })).json.category.attributes, []);
  } finally {
    await s.close();
  }
});

test('the chosen item keeps why it was chosen through the family choice, review, schedule proposal and use; reload and a second member see it', async () => {
  const f = await family();
  const { s, owner, Ash: ash, Wren: wren } = f;
  try {
    await f.ready();
    const found = (await f.fit()).json;
    const offersBefore = JSON.stringify(s.db.prepare('SELECT member_id, weekly_cents FROM family_offers ORDER BY rowid').all());
    // The page sends only the draft reference: the need and evidence are the server's own copy of the judged result.
    const added = await owner.call('POST', '/api/family-choices', { draftId: found.results[0].draftId, expectedGoalId: found.goalId, fit: { status: 'suitable', forged: true } });
    assert.equal(added.status, 200, JSON.stringify(added.json));
    const choice = added.json.state.familyChoices.choices[0];
    assert.deepEqual(choice.need, {
      category: { slug: 'fixture-tents', title: 'Tents (test fixture)', path: ['Outdoor (test fixture)', 'Tents (test fixture)'] },
      mustHaves: [{ key: 'fixture-capacity', name: 'Sleeps (test fixture)', accepted: ['4 person', '6 person'], allowed: ['1 person', '2 person', '4 person', '6 person'] }],
      check: { status: 'meets', category: 'match', mustHaves: [{ key: 'fixture-capacity', found: ['4 person'], status: 'match' }], checkedAt: choice.checkedAt },
      search: { ceilingCents: 15000, targetDate: '2026-12-20', reserveCents: 9000, on: '2026-11-08' },
    });
    // Every member reads the same reason, child included.
    for (const b of [ash, wren]) assert.deepEqual((await f.state(b)).familyChoices.choices[0].need, choice.need);
    // Review it with the same one-off amount, then save the goal with the reviewed schedule, then use it.
    const st = await f.state();
    const review = await owner.call('POST', '/api/family-choices/review', { choiceId: choice.id, revision: st.familyChoices.revision, reserveCents: 9000 });
    assert.equal(review.status, 200, JSON.stringify(review.json));
    assert.deepEqual([review.json.need, 'catalog' in review.json.item, 'fit' in review.json.item], [choice.need, false, false]);
    const saved = await owner.call('POST', '/api/merchant/goal', { draftId: review.json.item.draftId, goalId: st.goal.id, expectedGoalRevision: st.merchantGoalRevision,
      goal: { name: 'Four-person tent', targetCents: 12000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-20' },
      familyChoice: { choiceId: choice.id, revision: review.json.revision }, schedule: { reserveCents: 9000, revision: review.json.schedule.revision } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual(saved.json.plan.family.choice.need, choice.need);
    assert.deepEqual(saved.json.plan.contributions.map((c) => [c.date, c.amountCents]), [['2026-11-15', 0], ['2026-11-22', 0], ['2026-11-29', 0], ['2026-12-06', 3000], ['2026-12-13', 3000], ['2026-12-20', 0]]);
    const used = await owner.call('POST', `/api/plans/${saved.json.plan.id}/accept`, {});
    assert.deepEqual([used.status, used.json.state.nextStep.date, used.json.state.nextStep.plannedCents], [200, '2026-12-06', 3000]);
    for (const b of [owner, ash]) {
      const seen = await f.state(b); // a reload and the other adult
      assert.deepEqual([seen.acceptedPlanId, seen.plan.family.choice.need], [saved.json.plan.id, choice.need]);
    }
    assert.equal(JSON.stringify(s.db.prepare('SELECT member_id, weekly_cents FROM family_offers ORDER BY rowid').all()), offersBefore, 'no member’s offer changed');
  } finally {
    await s.close();
  }
});

test('an explicit check that finds a must-have no longer met says so, and a proposal resting on it is refused', async () => {
  const catalog = fitCatalog();
  const f = await family({ catalog });
  const { s, owner } = f;
  try {
    await f.ready();
    const found = (await f.fit()).json;
    // In Market Town, checking a fit result again judges it again: no old "suitable" label is kept.
    catalog.lookup.set('fixtureTent4pA', fitProduct('fixtureTent4pA', 'Test fixture: Four-person tent A', 120, { 'fixture-capacity': ['2 person'] }));
    const again = await owner.call('POST', '/api/merchant/refresh', { referenceId: found.results[0].referenceId, goalId: found.goalId });
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.deepEqual([again.json.results[0].fit.status, again.json.results[0].fit.problems[0].code, again.json.results[0].fit.check.mustHaves[0].found], ['not_suitable', 'must_have', ['2 person']]);
    catalog.lookup.clear();
    // A family choice from the first result, a schedule proposed for the current goal, then the item's facts change.
    const added = await owner.call('POST', '/api/family-choices', { draftId: found.results[1].draftId, expectedGoalId: found.goalId });
    const choice = added.json.state.familyChoices.choices[0];
    assert.equal(choice.need.check.status, 'meets');
    const st = await f.state();
    const review = await owner.call('POST', '/api/family-choices/review', { choiceId: choice.id, revision: st.familyChoices.revision, reserveCents: 9000 });
    const saved = await owner.call('POST', '/api/merchant/goal', { draftId: review.json.item.draftId, goalId: st.goal.id, expectedGoalRevision: st.merchantGoalRevision,
      goal: { name: 'Four-person tent B', targetCents: 15000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-20' },
      familyChoice: { choiceId: choice.id, revision: review.json.revision }, schedule: { reserveCents: 9000, revision: review.json.schedule.revision } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    catalog.lookup.set('fixtureTent4pB', fitProduct('fixtureTent4pB', 'Test fixture: Four-person tent B', 150, { 'fixture-capacity': ['2 person'] }));
    const checked = await owner.call('POST', '/api/family-choices/refresh', { choiceId: choice.id });
    assert.deepEqual([checked.status, checked.json.usable, checked.json.needStatus], [200, true, 'misses']);
    const now = checked.json.state.familyChoices.choices[0].need;
    assert.deepEqual([now.check.status, now.check.mustHaves], ['misses', [{ key: 'fixture-capacity', found: ['2 person'], status: 'mismatch' }]]);
    assert.deepEqual(now.search, choice.need.search, 'the original search stays as dated context');
    const stale = await owner.call('POST', `/api/plans/${saved.json.plan.id}/accept`, {});
    assert.deepEqual([stale.status, stale.json.error.code, stale.json.error.issues.map((i) => i.code)], [409, 'plan_stale', ['need_changed']]);
    assert.equal((await f.state()).acceptedPlanId, null);
  } finally {
    await s.close();
  }
});

test('only adults search, from catalog-listed kinds and values; children, other families, stale figures and bad input are refused before any provider call', async () => {
  const f = await family();
  const other = await familyWith(f.s);
  const { s, owner, Ash: ash, Wren: wren, fake } = f;
  try {
    await f.ready();
    const st = await f.state();
    const before = records(s.db), calls = fake.calls.length;
    const ownerId = st.access.me.memberId;
    const base = { query: 'tent', category: 'fixture-tents', mustHaves: CAPACITY, reserveCents: 9000, revision: st.familyChoices.revision };
    for (const [b, url, body, status, code] of [
      [wren, '/api/family-choices/fit', base, 403, 'adult_required'],
      [wren, '/api/merchant/categories', { query: 'tent' }, 403, 'adult_required'],
      [wren, '/api/merchant/category', { slug: 'fixture-tents' }, 403, 'adult_required'],
      [ash, '/api/family-choices/fit', { ...base, memberId: ownerId }, 403, 'member_mismatch'],
      [other.owner, '/api/family-choices/fit', { ...base, goalId: st.goal.id }, 403, 'scope_mismatch'],
      [owner, '/api/family-choices/fit', { ...base, revision: 'fc1_not_current' }, 409, 'choices_changed'],
      [owner, '/api/family-choices/fit', { ...base, revision: undefined }, 409, 'choices_changed'],
      [owner, '/api/family-choices/fit', { ...base, reserveCents: -1 }, 400, 'invalid_one_off'],
      [owner, '/api/family-choices/fit', { ...base, budgetCents: 99 }, 400, 'invalid_budget'],
      [owner, '/api/family-choices/fit', { ...base, category: 'fixture-unseen' }, 409, 'category_needs_check'],
      [owner, '/api/family-choices/fit', { ...base, category: 'fixture-tarps' }, 409, 'category_needs_check'],
      [owner, '/api/family-choices/fit', { ...base, mustHaves: [{ key: 'color', values: ['Green'] }] }, 400, 'invalid_need'],
      [owner, '/api/family-choices/fit', { ...base, mustHaves: [{ key: 'fixture-capacity', values: ['4 people'] }] }, 400, 'invalid_need'],
      [owner, '/api/family-choices/fit', { ...base, mustHaves: [{ key: 'fixture-capacity', values: [] }] }, 400, 'invalid_need'],
      [owner, '/api/family-choices/fit', { ...base, mustHaves: [{ key: 'fixture-weight', values: ['1 kg'] }] }, 400, 'invalid_need'],
      [owner, '/api/family-choices/fit', { ...base, mustHaves: [...CAPACITY, { key: 'fixture-season', values: ['4-season'] }, { key: 'fixture-capacity', values: ['6 person'] }] }, 400, 'invalid_need'],
      [owner, '/api/family-choices/fit', { ...base, category: null }, 400, 'invalid_need'],
      [owner, '/api/family-choices/fit', { ...base, query: 'tent https://evil.test/a' }, 400, 'invalid_query'],
      [owner, '/api/merchant/category', { slug: 'fixture-never-listed' }, 409, 'category_unknown'],
    ]) {
      const r = await b.call('POST', url, body);
      assert.deepEqual([r.status, r.json?.error?.code], [status, code], `${url} ${JSON.stringify(body).slice(0, 140)}`);
    }
    assert.equal(fake.calls.length, calls, 'no refused request reached the provider');
    assert.equal(records(s.db), before, 'and none wrote anything');
    assert.equal((await browser(s.origin).call('POST', '/api/family-choices/fit', base)).status, 401);
    assert.equal((await owner.call('POST', '/api/family-choices/fit', base, { csrf: false })).json.error.code, 'csrf_failed');

    // Truthful refusals when there is no planning ceiling. Nothing is raised or extended to make one.
    const refusal = async (body = {}) => { const r = await f.fit(body); return [r.status, r.json?.error?.code]; };
    assert.deepEqual(await refusal({ reserveCents: 25000 }), [200, undefined]); // the $60.00 recorded alone still covers a $60.00 price
    assert.equal((await owner.call('POST', '/api/family-choices/offer/withdraw', {})).status, 200);
    assert.equal((await ash.call('POST', '/api/family-choices/offer/withdraw', {})).status, 200);
    assert.deepEqual(await refusal(), [409, 'no_offers']);
    assert.equal((await ash.call('PUT', '/api/family-choices/offer', { weeklyCents: 1000 })).status, 200);
    let now = await f.state();
    assert.equal((await owner.call('PUT', '/api/goal', { name: 'Camping gear', targetCents: 30000, startingCents: 0, weeklyBudgetCents: 0, targetDate: '2026-12-20', expectedGoalRevision: now.merchantGoalRevision })).status, 200);
    assert.deepEqual(await refusal(), [409, 'no_capacity']);
    now = await f.state();
    assert.equal((await owner.call('PUT', '/api/goal', { name: 'Camping gear', targetCents: 30000, startingCents: 0, weeklyBudgetCents: 3000, targetDate: '2026-12-20', expectedGoalRevision: now.merchantGoalRevision })).status, 200);
    assert.deepEqual(await refusal({ reserveCents: 6000 }), [409, 'ceiling_too_low']); // $0 recorded, Ash's $10.00 × 6 weeks all taken by the one-off
    f.clock.advance(37 * 86_400_000); // Dec 15: the date is under a week away
    assert.equal((await owner.signIn()).done.status, 200);
    assert.deepEqual(await refusal({ reserveCents: 0 }), [409, 'date_too_soon']);
  } finally {
    await s.close();
  }
});

test('a provider answer that arrives after another adult changed their offer is not shown as current', async () => {
  const catalog = fitCatalog();
  const f = await family({ catalog });
  const { s, owner, Ash: ash } = f;
  try {
    await f.ready();
    const release = catalog.hold();
    const pending = f.fit();
    while (!catalog.calls.some((c) => c.method === 'POST' && c.url.endsWith('/v1/search'))) await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await ash.call('PUT', '/api/family-choices/offer', { weeklyCents: 1500 })).status, 200);
    release();
    const late = await pending;
    assert.deepEqual([late.status, late.json.error.code], [409, 'choices_changed']);
    // Searching again with the current figures uses the new ceiling: $60.00 + 6 × $30.00 − $90.00, the household amount still lower.
    const fresh = await f.fit();
    assert.deepEqual([fresh.status, fresh.json.ceiling.ceilingCents], [200, 15000]);
  } finally {
    await s.close();
  }
});

test('review F1: two families searching at once share one catalog call, but each keeps its own date, one-off amount and references', async () => {
  const catalog = fitCatalog();
  const clock = mutableClock('2026-11-08T12:00:00');
  const shop = createMerchant({ apiKey: 'test-key-not-real', fetch: catalog.fetch, clock });
  const arrivals = []; // each family-fit search reaching the shared merchant, with its private context
  const merchant = { ...shop, fitSearch: (args) => { arrivals.push(args.context); return shop.fitSearch(args); } };
  const s = await startServer({ clock, merchant });
  try {
    // Family A: Dec 20, a one-off $90.00. Family B: Jan 3, a one-off $150.00. Both have $60.00 recorded and offers of
    // $20.00 + $10.00, so both ceilings are $150.00 and both requests to the catalog are identical.
    const families = [];
    for (const [date, reserveCents] of [['2026-12-20', 9000], ['2027-01-03', 15000]]) {
      const people = await familyWith(s, [['Ash', 'adult']]);
      const st = (await people.owner.call('GET', '/api/state')).json;
      assert.equal((await people.owner.call('PUT', '/api/goal', { name: 'Camping gear', targetCents: 30000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: date, expectedGoalRevision: st.merchantGoalRevision })).status, 200);
      assert.equal((await people.owner.call('PUT', '/api/family-choices/offer', { weeklyCents: 2000 })).status, 200);
      assert.equal((await people.Ash.call('PUT', '/api/family-choices/offer', { weeklyCents: 1000 })).status, 200);
      assert.equal((await people.owner.call('POST', '/api/merchant/categories', { query: 'tent' })).status, 200);
      assert.equal((await people.owner.call('POST', '/api/merchant/category', { slug: 'fixture-tents' })).status, 200);
      families.push({ ...people, date, reserveCents, revision: (await people.owner.call('GET', '/api/state')).json.familyChoices.revision });
    }
    const [a, b] = families;
    const before = records(s.db), calls = catalog.calls.length;
    const release = catalog.hold();
    const search = (f) => f.owner.call('POST', '/api/family-choices/fit', { query: 'tent', category: 'fixture-tents', mustHaves: CAPACITY, reserveCents: f.reserveCents, revision: f.revision });
    const pending = [search(a), search(b)];
    while (arrivals.length < 2) await new Promise((resolve) => setImmediate(resolve)); // both are waiting on the one call
    release();
    const [foundA, foundB] = (await Promise.all(pending)).map((r) => { assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; });
    assert.equal(catalog.calls.length, calls + 1, 'one shared catalog call');
    assert.deepEqual([foundA.ceiling.targetDate, foundA.ceiling.reserveCents, foundA.ceiling.ceilingCents], ['2026-12-20', 9000, 15000]);
    assert.deepEqual([foundB.ceiling.targetDate, foundB.ceiling.reserveCents, foundB.ceiling.ceilingCents], ['2027-01-03', 15000, 15000]);
    // The same two tents, each finishing on its own family's weeks: A's one-off takes three weeks, B's five.
    assert.deepEqual(foundA.results.map((r) => [r.priceCents, r.finishDate, r.fit.context.targetDate, r.fit.context.reserveCents]), [[12000, '2026-12-13', '2026-12-20', 9000], [15000, '2026-12-20', '2026-12-20', 9000]]);
    assert.deepEqual(foundB.results.map((r) => [r.priceCents, r.finishDate, r.fit.context.targetDate, r.fit.context.reserveCents]), [[12000, '2026-12-27', '2027-01-03', 15000], [15000, '2027-01-03', '2027-01-03', 15000]]);
    const refs = (found) => found.results.flatMap((r) => [r.draftId, r.referenceId]);
    assert.equal(refs(foundA).some((id) => refs(foundB).includes(id)), false, 'no reference is shared between families');
    assert.equal(records(s.db), before, 'searching wrote nothing');
    // Each family saves its own result: the stored reason carries its own search, never the other family's.
    const add = (f, found) => f.owner.call('POST', '/api/family-choices', { draftId: found.results[0].draftId, expectedGoalId: found.goalId });
    const savedB = await add(b, foundB);
    assert.equal(savedB.status, 200, JSON.stringify(savedB.json));
    assert.deepEqual(savedB.json.state.familyChoices.choices[0].need.search, { ceilingCents: 15000, targetDate: '2027-01-03', reserveCents: 15000, on: '2026-11-08' });
    const savedA = await add(a, foundA);
    assert.deepEqual(savedA.json.state.familyChoices.choices[0].need.search, { ceilingCents: 15000, targetDate: '2026-12-20', reserveCents: 9000, on: '2026-11-08' });
    // A family cannot use a reference the server showed only to the other family.
    const foreign = await b.owner.call('POST', '/api/family-choices', { draftId: foundA.results[1].draftId, expectedGoalId: foundB.goalId });
    assert.deepEqual([foreign.status, foreign.json.error.code], [410, 'merchant_draft_expired']);
    // Only the two explicit family choices were written: no money, goal, plan, deed or offer record changed.
    const [money0, goals0, items0, plans0, deeds0, offers0] = JSON.parse(before), [money1, goals1, items1, plans1, deeds1, offers1, choices1] = JSON.parse(records(s.db));
    assert.deepEqual([money1, goals1, items1, plans1, deeds1, offers1], [money0, goals0, items0, plans0, deeds0, offers0]);
    assert.equal(choices1.length, 2);
  } finally {
    await s.close();
  }
});

// Review F3: after an explicit check finds that an item no longer meets a must-have, no reference read before that check
// can make the family choice suitable again, save it as the goal, or revive the schedule that rested on it.
const TENT_A = ['fixtureTent4pA', 'Test fixture: Four-person tent A', 120], TENT_B = ['fixtureTent4pB', 'Test fixture: Four-person tent B', 150];
const lose = (catalog, [id, title, price]) => catalog.lookup.set(id, fitProduct(id, title, price, { 'fixture-capacity': ['2 person'] }));
// A family choice from the fit search, saved as the goal with its proposed schedule.
async function chosenAndProposed(f, [, title, price]) {
  const { owner } = f;
  await f.ready();
  const found = (await f.fit()).json;
  const result = found.results.find((r) => r.title === title);
  const added = await owner.call('POST', '/api/family-choices', { draftId: result.draftId, expectedGoalId: found.goalId });
  const choice = added.json.state.familyChoices.choices[0];
  assert.deepEqual([choice.title, choice.need.check.status], [title, 'meets']);
  const st = await f.state();
  const review = await owner.call('POST', '/api/family-choices/review', { choiceId: choice.id, revision: st.familyChoices.revision, reserveCents: 9000 });
  const goal = { name: title, targetCents: price * 100, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-20' };
  const saved = await owner.call('POST', '/api/merchant/goal', { draftId: review.json.item.draftId, goalId: st.goal.id, expectedGoalRevision: st.merchantGoalRevision, goal,
    familyChoice: { choiceId: choice.id, revision: review.json.revision }, schedule: { reserveCents: 9000, revision: review.json.schedule.revision } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  return { found, result, choice, goal, plan: saved.json.plan };
}
const staleCodes = async (owner, plan) => {
  const r = await owner.call('POST', `/api/plans/${plan.id}/accept`, {});
  return [r.status, r.json.error?.code, r.json.error?.issues?.map((i) => i.code)];
};

test('review F3: after a check finds a must-have lost, the earlier fit reference cannot make the choice suitable again or save the goal', async () => {
  const catalog = fitCatalog();
  const f = await family({ catalog });
  const { s, owner } = f;
  try {
    const { found, result, choice, goal, plan } = await chosenAndProposed(f, TENT_B);
    lose(catalog, TENT_B);
    const checked = await owner.call('POST', '/api/family-choices/refresh', { choiceId: choice.id });
    assert.deepEqual([checked.status, checked.json.needStatus], [200, 'misses']);
    const before = records(s.db);
    // The reference from the first search still says "sleeps 4", at the same retailer, price and stock.
    const again = await owner.call('POST', '/api/family-choices', { draftId: result.draftId, expectedGoalId: found.goalId });
    assert.deepEqual([again.status, (await f.state()).familyChoices.choices[0].need.check.status], [410, 'misses']);
    assert.equal(again.json.error.code, 'merchant_draft_expired');
    const st = await f.state();
    const saved = await owner.call('POST', '/api/merchant/goal', { draftId: result.draftId, goalId: st.goal.id, expectedGoalRevision: st.merchantGoalRevision, goal });
    assert.deepEqual([saved.status, saved.json.error.code], [410, 'merchant_draft_expired']);
    assert.equal(records(s.db), before, 'nothing was written');
    assert.deepEqual(await staleCodes(owner, plan), [409, 'plan_stale', ['need_changed']]);
  } finally {
    await s.close();
  }
});

test('review F3: an ordinary result read before that check stays usable but cannot bring the lost must-have back', async () => {
  const catalog = fitCatalog();
  const f = await family({ catalog });
  const { s, owner } = f;
  try {
    const { choice, plan } = await chosenAndProposed(f, TENT_A);
    // An ordinary Market Town search, read while tent A still reported sleeping four.
    const ordinary = await owner.call('POST', '/api/merchant/search', { query: 'tent', budgetCents: 15000 });
    const tentA = ordinary.json.results.find((r) => r.title === TENT_A[1]);
    assert.equal(tentA.usable, true);
    lose(catalog, TENT_A);
    const checked = await owner.call('POST', '/api/family-choices/refresh', { choiceId: choice.id });
    assert.deepEqual([checked.status, checked.json.needStatus], [200, 'misses']);
    // Ordinary behaviour stays: the same offer can still be added, and it updates the line. Its older facts do not replace
    // the newer check, so the choice still does not meet the family's needs and the schedule stays out of date.
    const again = await owner.call('POST', '/api/family-choices', { draftId: tentA.draftId, expectedGoalId: ordinary.json.goalId });
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.deepEqual([again.json.outcome, again.json.state.familyChoices.choices[0].need.check.status], ['updated', 'misses']);
    assert.deepEqual(await staleCodes(owner, plan), [409, 'plan_stale', ['need_changed']]);
  } finally {
    await s.close();
  }
});

test('review F3: a slower price check answered after a newer search updated the choice cannot bring the lost must-have back', async () => {
  const products = fitProducts();
  const catalog = fitCatalog({ products });
  let gate = null, open = () => {};
  const fetch = async (url, init) => {
    const response = await catalog.fetch(url, init); // answered as the catalog was when asked, delivered later
    if (gate && String(url).includes('/v1/products/')) { const wait = gate; gate = null; await wait; }
    return response;
  };
  const f = await family({ catalog: { ...catalog, fetch } });
  const { s, owner } = f;
  let slow = null;
  try {
    const { choice, plan } = await chosenAndProposed(f, TENT_A);
    gate = new Promise((resolve) => { open = resolve; });
    slow = owner.call('POST', '/api/family-choices/refresh', { choiceId: choice.id }); // asked while tent A sleeps four
    while (!catalog.calls.some((c) => c.url.includes('/v1/products/'))) await new Promise((resolve) => setImmediate(resolve));
    // Meanwhile the catalog says two person, an ordinary search reads that, and the choice is updated from it.
    products[1] = fitProduct(TENT_A[0], TENT_A[1], TENT_A[2], { 'fixture-capacity': ['2 person'] });
    const ordinary = await owner.call('POST', '/api/merchant/search', { query: 'tent', budgetCents: 15000 });
    const newer = await owner.call('POST', '/api/family-choices', { draftId: ordinary.json.results.find((r) => r.title === TENT_A[1]).draftId, expectedGoalId: ordinary.json.goalId });
    assert.equal(newer.json.state.familyChoices.choices[0].need.check.status, 'misses');
    open();
    const late = await slow;
    assert.equal(late.status, 200, JSON.stringify(late.json));
    assert.deepEqual([late.json.needStatus, late.json.state.familyChoices.choices[0].need.check.status], ['misses', 'misses']);
    assert.deepEqual(await staleCodes(owner, plan), [409, 'plan_stale', ['need_changed']]);
  } finally {
    open();
    await slow?.catch(() => {});
    await s.close();
  }
});

test('a schema-9 database gains only the need column (and later kit/exchange tables); every earlier row is unchanged', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'our-castle-family-fit-migration-'));
  const file = path.join(dir, 'before.sqlite');
  try {
    const step = MIGRATIONS.findIndex((m) => m.id === 'family-choice-needs');
    assert.equal(step, 9, 'the family-choice needs are step 10');
    const old = new DatabaseSync(file);
    MIGRATIONS.slice(0, step).forEach((m, i) => { if (typeof m === 'string') old.exec(m); else m.ensure(old); old.exec(`PRAGMA user_version = ${i + 1}`); });
    old.exec(`INSERT INTO households (id, name, play_mode, crest_field, crest_charge, is_example, setup_complete, created_at) VALUES ('hh_old', 'House of Alder', 'family', 'cobalt', 'stag', 0, 1, '2026-11-01T12:00:00.000Z');
      INSERT INTO members (id, household_id, display_name, role, is_example, sort) VALUES ('m_old', 'hh_old', 'Rowan', 'adult', 0, 0);
      INSERT INTO goals (id, household_id, name, target_cents, currency, target_date, weekly_budget_cents, created_at) VALUES ('goal_old', 'hh_old', 'Garden', 30000, 'USD', '2026-12-29', 3000, '2026-11-01T12:00:00.000Z');
      INSERT INTO family_choices (id, household_id, goal_id, product_id, title, merchant, url, price_cents, currency, availability, condition, selection_json, checked_at, draft_id, added_by, added_at)
        VALUES ('fc_000000000000000000000001', 'hh_old', 'goal_old', 'p1', 'Old choice', 'example-outfitter.com', 'https://buy.trychannel3.com/fake/p1', 12000, 'USD', 'InStock', 'new', '[]', '2026-11-01T12:00:00.000Z', NULL, 'm_old', '2026-11-01T12:00:00.000Z');
      INSERT INTO family_offers (goal_id, member_id, weekly_cents, updated_at) VALUES ('goal_old', 'm_old', 2000, '2026-11-01T12:00:00.000Z');`);
    const tables = (d) => d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
    const rows = (d, names) => Object.fromEntries(names.map((t) => [t, d.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all().map((r) => ({ ...r }))]));
    const beforeTables = tables(old), before = rows(old, beforeTables);
    old.close();
    const db = openDatabase(file);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
    assert.deepEqual(tables(db), [...beforeTables, 'exchange_circles', 'exchange_invites', 'exchange_members', 'exchange_offers', 'exchange_requests', 'goal_kits', 'kit_candidates', 'kit_lists', 'kit_selections'].sort(), 'only the subsequent kit and exchange tables are new');
    const after = rows(db, beforeTables);
    assert.deepEqual(after.family_choices, before.family_choices.map((r) => ({ ...r, need_json: null })), 'the old choice gains an empty need');
    for (const t of beforeTables.filter((n) => n !== 'family_choices')) assert.deepEqual(after[t], before[t], t);
    db.close();
    const again = openDatabase(file);
    assert.equal(again.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
    again.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('example mode: the labelled example adult can search for the family’s fit; a child persona cannot', async () => {
  const catalog = fitCatalog();
  const clock = mutableClock('2026-11-08T12:00:00');
  const db = openDatabase(':memory:');
  const app = createApp({ config: loadConfig({}, { root }), db, clock, root, merchant: createMerchant({ apiKey: 'test-key-not-real', fetch: catalog.fetch, clock }) });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => { const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Origin: base }, body: body && JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
  try {
    let st = (await call('GET', '/api/state')).json;
    assert.equal((await call('PUT', '/api/goal', { name: 'Camping gear', targetCents: 30000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-20', expectedGoalRevision: st.merchantGoalRevision })).status, 200);
    assert.equal((await call('PUT', '/api/family-choices/offer', { weeklyCents: 3000, memberId: 'm_rowan' })).status, 200);
    assert.equal((await call('POST', '/api/merchant/categories', { query: 'tent' })).status, 200);
    assert.equal((await call('POST', '/api/merchant/category', { slug: 'fixture-tents' })).status, 200);
    st = (await call('GET', '/api/state')).json;
    const body = { query: 'tent', category: 'fixture-tents', mustHaves: CAPACITY, reserveCents: 9000, revision: st.familyChoices.revision };
    assert.equal((await call('POST', '/api/family-choices/fit', { ...body, memberId: 'm_wren' })).json.error.code, 'adult_required');
    assert.equal((await call('POST', '/api/family-choices/fit', { ...body, memberId: 'm_nobody' })).json.error.code, 'invalid_member');
    const found = await call('POST', '/api/family-choices/fit', { ...body, memberId: 'm_rowan' });
    assert.deepEqual([found.status, found.json.ceiling.ceilingCents, titles(found.json.results)], [200, 15000, ['Test fixture: Four-person tent A', 'Test fixture: Four-person tent B']]);
  } finally {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); db.close();
  }
});
