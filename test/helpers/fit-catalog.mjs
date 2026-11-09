// A fake Channel3 catalog for family-fit tests, shaped like the published contract (github.com/channel3-ai/skills, commit
// db55b30, skills/channel3-api/references/api-reference.md): category search, category detail, product search and product
// look-up. Everything here is invented and labelled as a test fixture. It is not Channel3's live taxonomy, and no handle
// or value here is a claim about a real category. The search ignores every filter, as a provider may.
import { createFakeChannel3, fakeProduct, fakeSearchResponse } from './fake-channel3.mjs';

export const FIT_CATEGORY = { slug: 'fixture-tents', title: 'Tents (test fixture)', has_children: false,
  path: [{ slug: 'fixture-outdoor', title: 'Outdoor (test fixture)' }, { slug: 'fixture-tents', title: 'Tents (test fixture)' }] };
export const FIT_TARPS = { slug: 'fixture-tarps', title: 'Tarps (test fixture)', has_children: false,
  path: [{ slug: 'fixture-outdoor', title: 'Outdoor (test fixture)' }, { slug: 'fixture-tarps', title: 'Tarps (test fixture)' }] };
export const FIT_DETAIL = { ...FIT_CATEGORY, description: 'Invented for tests.', children: [], attributes: [
  { slug: 'color', name: 'Color', values: ['Green', 'Orange'] },
  { slug: 'fixture-capacity', name: 'Sleeps (test fixture)', values: ['1 person', '2 person', '4 person', '6 person'] },
  { slug: 'fixture-season', name: 'Season rating (test fixture)', values: ['3-season', '4-season'] },
  { slug: 'fixture-weight', name: 'Packed weight (test fixture)', values: [] },
] };

export const fitProduct = (id, title, price, attrs, { currency = 'USD', availability = 'InStock', category = FIT_CATEGORY } = {}) => fakeProduct({ id, title,
  category, structured_attributes: attrs, images: [],
  offers: [{ url: `https://buy.trychannel3.com/fake/${id}`, domain: 'example-outfitter.com', price: { price, currency }, availability, condition: 'new' }] });

/** The task's example items: one cheap unsuitable tent, two suitable ones, and one each of every reason not to suggest. */
export const fitProducts = () => [
  fitProduct('fixtureTent2p', 'Test fixture: Two-person tent', 90, { 'fixture-capacity': ['2 person'], color: ['Green'] }),
  fitProduct('fixtureTent4pA', 'Test fixture: Four-person tent A', 120, { 'fixture-capacity': ['4 person'] }),
  fitProduct('fixtureTentNoFact', 'Test fixture: Tent with no capacity fact', 130, {}),
  fitProduct('fixtureTent4pB', 'Test fixture: Four-person tent B', 150, { 'fixture-capacity': ['4 person'] }),
  fitProduct('fixtureTentEur', 'Test fixture: Four-person tent priced in euros', 110, { 'fixture-capacity': ['4 person'] }, { currency: 'EUR' }),
  fitProduct('fixtureTentOut', 'Test fixture: Six-person tent, out of stock', 140, { 'fixture-capacity': ['6 person'] }, { availability: 'OutOfStock' }),
  fitProduct('fixtureTent6p', 'Test fixture: Six-person tent', 180, { 'fixture-capacity': ['6 person'] }),
  fitProduct('fixtureTarp', 'Test fixture: Four-person tarp shelter', 60, { 'fixture-capacity': ['4 person'] }, { category: FIT_TARPS }),
];

/**
 * The fake transport. `catalog.lookup` may replace the product a look-up returns (an explicit price check), and
 * `catalog.hold()` makes the next product search wait until the returned release function is called (a late answer).
 */
export function fitCatalog({ products = fitProducts() } = {}) {
  let held = null;
  const lookup = new Map(); // product id -> product a look-up returns instead of the search fixture
  const fake = createFakeChannel3(async (url) => {
    if (url.includes('/v1/categories/search')) return { categories: [FIT_CATEGORY, FIT_TARPS] };
    if (url.endsWith('/v1/categories/fixture-tents')) return FIT_DETAIL;
    if (url.endsWith('/v1/categories/fixture-tarps')) return { ...FIT_TARPS, description: null, children: [], attributes: [] };
    const product = /\/v1\/products\/([^?]+)/.exec(url);
    if (product) {
      const id = decodeURIComponent(product[1]);
      return lookup.get(id) ?? products.find((p) => p.id === id);
    }
    if (held) { const wait = held; held = null; await wait; }
    return fakeSearchResponse(products);
  });
  return Object.assign(fake, {
    lookup,
    hold() { let release; held = new Promise((resolve) => { release = resolve; }); return release; },
  });
}
