import test from 'node:test';
import assert from 'node:assert/strict';
import { createMerchant } from '../../server/merchant/channel3.mjs';
import { createFakeChannel3, fakeProduct, fakeSearchResponse } from '../helpers/fake-channel3.mjs';
import { familyWith, mutableClock, startServer } from '../helpers/family-http.mjs';

// Finding a purchase that fits the family, over real HTTP in family mode. The merchant is the real Channel3 code over a
// FAKE transport. Its taxonomy, attribute handles, values and products are invented test fixtures, labelled as such:
// they are not a claim about Channel3's live tent category. The figures are the task's example:
// - local day Nov 8, 2026, goal date Dec 20 (week 6), $60.00 recorded, a household weekly amount of $30.00;
// - Rowan offers $20.00 a week and Ash $10.00; a one-off $90.00 is tried, so the planning price ceiling is $150.00.
// Expected cents and dates are written out here, not computed by the code under test.
const CATEGORY = { slug: 'fixture-tents', title: 'Tents (test fixture)', path: [{ slug: 'fixture-outdoor', title: 'Outdoor (test fixture)' }, { slug: 'fixture-tents', title: 'Tents (test fixture)' }], has_children: false };
const DETAIL = { ...CATEGORY, description: 'Invented for tests.', children: [], attributes: [
  { slug: 'color', name: 'Color', values: ['Green', 'Orange'] },
  { slug: 'fixture-capacity', name: 'Sleeps (test fixture)', values: ['1 person', '2 person', '4 person', '6 person'] },
  { slug: 'fixture-season', name: 'Season rating (test fixture)', values: ['3-season', '4-season'] },
  { slug: 'fixture-weight', name: 'Packed weight (test fixture)', values: [] },
] };
const tent = (id, title, price, attrs, { currency = 'USD', availability = 'InStock', category = CATEGORY } = {}) => fakeProduct({ id, title,
  category, structured_attributes: attrs, images: [],
  offers: [{ url: `https://buy.trychannel3.com/fake/${id}`, domain: 'example-outfitter.com', price: { price, currency }, availability, condition: 'new' }] });
const TARP_CATEGORY = { slug: 'fixture-tarps', title: 'Tarps (test fixture)', path: [{ slug: 'fixture-outdoor', title: 'Outdoor (test fixture)' }, { slug: 'fixture-tarps', title: 'Tarps (test fixture)' }], has_children: false };
// The catalog ignores every filter, as a provider may: the server must still check each item itself.
const PRODUCTS = [
  tent('fixtureTent2p', 'Test fixture: Two-person tent', 90, { 'fixture-capacity': ['2 person'], color: ['Green'] }),
  tent('fixtureTent4pA', 'Test fixture: Four-person tent A', 120, { 'fixture-capacity': ['4 person'] }),
  tent('fixtureTentNoFact', 'Test fixture: Tent with no capacity fact', 130, {}),
  tent('fixtureTent4pB', 'Test fixture: Four-person tent B', 150, { 'fixture-capacity': ['4 person'] }),
  tent('fixtureTentEur', 'Test fixture: Four-person tent priced in euros', 110, { 'fixture-capacity': ['4 person'] }, { currency: 'EUR' }),
  tent('fixtureTentOut', 'Test fixture: Six-person tent, out of stock', 140, { 'fixture-capacity': ['6 person'] }, { availability: 'OutOfStock' }),
  tent('fixtureTent6p', 'Test fixture: Six-person tent', 180, { 'fixture-capacity': ['6 person'] }),
  tent('fixtureTarp', 'Test fixture: Four-person tarp shelter', 60, { 'fixture-capacity': ['4 person'] }, { category: TARP_CATEGORY }),
];
function catalog() {
  return createFakeChannel3((url) => {
    if (url.includes('/v1/categories/search')) return { categories: [CATEGORY, TARP_CATEGORY] };
    if (url.endsWith('/v1/categories/fixture-tents')) return DETAIL;
    return fakeSearchResponse(PRODUCTS);
  });
}
const MONEY_TABLES = ['payment_orders', 'payment_captures', 'payment_refunds', 'deferred_refunds', 'order_checks', 'ledger_entries', 'webhook_events'];
const records = (db) => JSON.stringify([MONEY_TABLES.map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()), db.prepare('SELECT * FROM goals').all(),
  db.prepare('SELECT * FROM goal_items').all(), db.prepare('SELECT * FROM plans').all(), db.prepare('SELECT * FROM achievements').all(),
  db.prepare('SELECT * FROM family_offers ORDER BY rowid').all(), db.prepare('SELECT * FROM family_choices ORDER BY rowid').all()]);

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
  return { s, fake, clock, ...people, state };
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
