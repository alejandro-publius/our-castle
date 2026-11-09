// A fake Channel3 catalog for the kit planner, shaped like the published contract (github.com/channel3-ai/skills, commit
// db55b30, skills/channel3-api/references/api-reference.md): product search and product look-up, with each offer's
// documented `dimensions.weight` ({ number, unit }). Everything here is invented and labelled as a test fixture: the six
// listings are the task's acceptance example (kit-planning-acceptance-20261109.json), not real products, prices or shops.
import { createFakeChannel3, fakeProduct, fakeSearchResponse } from './fake-channel3.mjs';

export const kitProduct = (id, title, dollars, grams, domain, { availability = 'InStock', unit = 'g' } = {}) => fakeProduct({
  id, title, brands: [{ id: 'fixture', name: 'Fixture Outfitters (test)' }], images: [],
  offers: [{ url: `https://buy.trychannel3.com/fake/${id}`, domain, price: { price: dollars, currency: 'USD' }, availability, condition: 'new',
    dimensions: grams === null ? null : { weight: { number: unit === 'kg' ? grams / 1000 : grams, unit } } }],
});

/** The acceptance example's listings, by the words a family would search: tent A/B, sleeping bag A/B, stove A/B. */
export const kitProducts = () => ({
  tent: [kitProduct('fixtureTentA', 'Test fixture: Tent A, four-person dome', 80, 3000, 'fixture-a.test', { unit: 'kg' }),
    kitProduct('fixtureTentB', 'Test fixture: Tent B, four-person ultralight', 110, 1800, 'fixture-b.test')],
  'sleeping bag': [kitProduct('fixtureBagA', 'Test fixture: Sleeping bag A', 20, 800, 'fixture-a.test'),
    kitProduct('fixtureBagB', 'Test fixture: Sleeping bag B, down', 30, 500, 'fixture-b.test')],
  stove: [kitProduct('fixtureStoveA', 'Test fixture: Stove A', 30, 600, 'fixture-a.test'),
    kitProduct('fixtureStoveB', 'Test fixture: Stove B, compact', 35, 300, 'fixture-b.test')],
});

/**
 * The fake transport: a search returns the listings for the first fixture word in the query; a look-up returns one
 * product, or `catalog.lookup.get(id)` when a test sets a newer answer (an explicit price check).
 */
export function kitCatalog({ products = kitProducts() } = {}) {
  const all = Object.values(products).flat();
  const lookup = new Map();
  const fake = createFakeChannel3(async (url, init) => {
    const product = /\/v1\/products\/([^?]+)/.exec(url);
    if (product) {
      const id = decodeURIComponent(product[1]);
      return lookup.get(id) ?? all.find((p) => p.id === id);
    }
    const query = String(JSON.parse(init.body ?? '{}').query ?? '').toLowerCase();
    const word = Object.keys(products).find((k) => query.includes(k));
    return fakeSearchResponse(word ? products[word] : []);
  });
  return Object.assign(fake, { lookup, count: (path) => fake.calls.filter((c) => c.url.includes(path)).length });
}
