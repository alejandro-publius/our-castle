// The playable family-trip example: `npm run demo -- --family-trip`.
//
// Everything in this file is authored and invented: the family (Rowan, Ash and Wren), both shops, all six listings and
// their prices, weights and stock. It exists so a visitor without any provider key can try a complete-kit decision and
// its repair. It is used only by the demo runner (scripts/demo.mjs); `npm start` and the family runner never load it.
//
// What is real: the planning. The example hands the EXISTING services their inputs and nothing else:
// - Market Town is the real merchant (server/merchant/channel3.mjs: validation, bounded calls, drafts, freshness) over a
//   local transport that answers from the six listings below, inside this process. No socket is opened, and the
//   merchant reports itself as an example catalogue, never as Channel3.
// - The starting state is saved through the same functions the page's own routes call (house, weekly offers, kit list,
//   "Add for <item>"), with each acting member read from the household's records.
// No kit, total, date, comparison or repair is written here: the existing solver and family arithmetic compute those when
// a visitor asks.
import { createMerchant } from '../server/merchant/channel3.mjs';
import { DEMO_HOUSEHOLD_ID, EXAMPLE_DEFAULTS, getActiveGoal, getMember, setupHousehold } from '../server/household.mjs';
import { saveOffer } from '../server/family-choices.mjs';
import { kitView, saveKit } from '../server/kit/list.mjs';
import { addCandidate, kitPlanView } from '../server/kit/planner.mjs';

// ---- The example catalogue: six invented listings from two invented shops ----
// `.example` is a reserved name (RFC 2606): no such shop can exist, and the page never offers these as links.
export const SAMPLE_SHOPS = Object.freeze(['sample-shop-one.example', 'sample-shop-two.example']);
const listing = (id, title, dollars, weight, shop, words) => Object.freeze({ id, title, dollars, weight: Object.freeze(weight), shop: SAMPLE_SHOPS[shop], words: Object.freeze(words) });
export const SAMPLE_LISTINGS = Object.freeze([
  listing('sampleTentDome', 'Sample: Dome tent, four-person', 80, { number: 3, unit: 'kg' }, 0, ['tent']),
  listing('sampleTentLight', 'Sample: Light tent, four-person', 110, { number: 1.8, unit: 'kg' }, 1, ['tent']),
  listing('sampleBagSynthetic', 'Sample: Sleeping bag, synthetic', 20, { number: 800, unit: 'g' }, 0, ['sleeping bag', 'bag']),
  listing('sampleBagDown', 'Sample: Sleeping bag, down', 30, { number: 500, unit: 'g' }, 1, ['sleeping bag', 'bag']),
  listing('sampleStoveCamp', 'Sample: Camp stove', 30, { number: 600, unit: 'g' }, 0, ['stove']),
  listing('sampleStoveCompact', 'Sample: Compact stove', 35, { number: 300, unit: 'g' }, 1, ['stove']),
]);
/** What the merchant says it is in this example, on the page and in /api/status. */
export const SAMPLE_CATALOGUE = Object.freeze({ mode: 'sample', provider: 'Example catalogue', label: 'Example catalogue: invented shops, listings and prices (not Channel3)' });

// One listing in the product shape the merchant reads (Channel3's documented Product and ProductOffer): one offer, in
// stock, priced in USD, with its listed weight. No picture, so the page draws its ordinary empty frame.
const asProduct = (l) => ({
  id: l.id, title: l.title, description: 'An invented listing for the Our Castle family-trip example. Not a real product.',
  brands: [{ id: 'sample', name: 'Invented for this example' }], images: [],
  offers: [{ url: `https://${l.shop}/${l.id}`, domain: l.shop, price: { price: l.dollars, currency: 'USD' }, availability: 'InStock', condition: 'new', dimensions: { weight: { ...l.weight } } }],
});

/**
 * The local transport: a fetch-shaped function for the merchant, answered from SAMPLE_LISTINGS in this process.
 * - a search returns the listings whose kind of item the words name, within any price limit asked;
 * - a product look-up returns that listing as it is now (the explicit "Check price");
 * - "cheaper options" returns cheaper listings of the same kind;
 * - the example has no category lists, so a look-up for kinds of item finds none.
 * It reads no file and opens no connection; `calls` counts what was asked, for the checks.
 */
export function createSampleCatalogue() {
  const calls = { search: 0, product: 0, similar: 0, other: 0 };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const within = (l, max) => typeof max !== 'number' || l.dollars <= max;
  const page = (listings, limit) => ({ products: listings.slice(0, Number.isSafeInteger(limit) && limit > 0 ? limit : 3).map(asProduct), next_page_token: null });
  async function fetch(url, init = {}) {
    const { pathname } = new URL(String(url));
    const method = init.method ?? 'GET';
    const body = () => { try { return JSON.parse(init.body ?? '{}') ?? {}; } catch { return {}; } };
    const product = /^\/v1\/products\/([^/]+)$/.exec(pathname);
    if (product && method === 'GET') {
      calls.product += 1;
      const found = SAMPLE_LISTINGS.find((l) => l.id === decodeURIComponent(product[1]));
      return found ? json(200, asProduct(found)) : json(404, { detail: 'Not in the example catalogue.' });
    }
    if (pathname === '/v1/search' && method === 'POST') {
      calls.search += 1;
      const asked = body(), words = String(asked.query ?? '').toLowerCase();
      return json(200, page(SAMPLE_LISTINGS.filter((l) => l.words.some((w) => words.includes(w)) && within(l, asked.filters?.price?.max_price)), asked.limit));
    }
    if (pathname === '/v1/similar' && method === 'POST') {
      calls.similar += 1;
      const asked = body(), source = SAMPLE_LISTINGS.find((l) => l.id === asked.product_id);
      return json(200, page(SAMPLE_LISTINGS.filter((l) => source && l.id !== source.id && l.words[0] === source.words[0] && within(l, asked.filters?.price?.max_price)), asked.limit));
    }
    calls.other += 1;
    if (pathname === '/v1/categories/search' && method === 'GET') return json(200, { categories: [] });
    return json(404, { detail: 'The example catalogue does not answer this.' });
  }
  return { fetch, calls };
}

/**
 * Market Town for the example: the real merchant over the local transport, labelled as an example catalogue wherever it
 * names itself. The key argument only tells the merchant it has a catalogue; this placeholder is not a credential, and
 * the only thing it is ever handed to is the function above.
 */
export function createSampleMerchant({ clock, catalogue = createSampleCatalogue() } = {}) {
  const merchant = createMerchant({ apiKey: 'no-key-local-example-catalogue', fetch: catalogue.fetch, clock });
  const labelled = (answer) => async (...args) => ({ ...(await answer(...args)), provider: SAMPLE_CATALOGUE.provider });
  return {
    ...merchant, catalogue,
    status: () => ({ ...SAMPLE_CATALOGUE }),
    search: labelled(merchant.search), refresh: labelled(merchant.refresh), alternatives: labelled(merchant.alternatives),
    fitSearch: labelled(merchant.fitSearch), findCategories: labelled(merchant.findCategories), category: labelled(merchant.category),
  };
}

// ---- The example family and its starting state ----
/** The worked example's figures (docs/KIT-PLANNER.md): the default example household, a second adult and a seven-week date. */
export const FAMILY_TRIP = Object.freeze({
  id: 'family-trip',
  title: 'Example family trip',
  // $60 reported, $30 a week, $300 goal, as the default example; the goal's date is seven weeks after the day it starts.
  defaults: Object.freeze({ ...EXAMPLE_DEFAULTS, weeks: 7, members: Object.freeze({
    solo: EXAMPLE_DEFAULTS.members.solo,
    family: Object.freeze([{ id: 'm_rowan', name: 'Rowan', role: 'adult' }, { id: 'm_ash', name: 'Ash', role: 'adult' }, { id: 'm_wren', name: 'Wren', role: 'child' }]),
  }) }),
  offers: Object.freeze([{ memberId: 'm_rowan', weeklyCents: 2000 }, { memberId: 'm_ash', weeklyCents: 1000 }]),
  kit: Object.freeze([
    { name: '4-person tent', quantity: 1, ownedQuantity: 0 }, { name: 'sleeping bag', quantity: 2, ownedQuantity: 0 },
    { name: 'torch', quantity: 2, ownedQuantity: 2 }, { name: 'stove', quantity: 1, ownedQuantity: 0 },
  ]),
  // Who adds the listings, and how many items each listing gives. The planner never infers that count: it is recorded as
  // an adult's own reading of a listing. Here it is part of the authored example, recorded as Rowan's.
  listedBy: 'm_rowan',
  perListing: 1,
});

/**
 * The example a demo server runs: its identity, the example household's defaults, its merchant, and `prepare`.
 * `prepare` asks the example catalogue for each item still to get (as "Find listings for <item>" does) and returns a
 * function that saves the starting state. Preparing changes nothing, so a refused search leaves the household as it was;
 * the returned function only writes, so the server can run it in one transaction (on start, and after a reset).
 * Every write goes through the service the page's own route calls, so the family's rules hold here too: a scenario that
 * had a child offer, list or add a listing is refused by those services, and nothing of it is saved (`scenario` exists
 * so a test can prove that).
 */
export function createFamilyTrip({ clock, merchant = createSampleMerchant({ clock }), scenario = FAMILY_TRIP } = {}) {
  const { id, title, defaults } = scenario;
  async function prepare() {
    const found = new Map();
    for (const line of scenario.kit.filter((l) => l.quantity > l.ownedQuantity)) {
      found.set(line.name, (await merchant.search({ query: line.name, budgetCents: null })).results.filter((r) => r.draftId));
    }
    return function saveStartingState({ db }) {
      const householdId = DEMO_HOUSEHOLD_ID, goal = getActiveGoal(db, householdId);
      // The acting member and their role come from the household's records, as the page's routes read them.
      const actor = (memberId) => {
        const member = getMember(db, householdId, memberId);
        if (!member) throw new Error(`The family-trip example has no member ${memberId}.`);
        return { memberId: member.id, role: member.role };
      };
      setupHousehold(db, householdId, { playMode: 'family', name: defaults.householdName, crest: defaults.crest }, defaults);
      for (const offer of scenario.offers) saveOffer(db, { householdId, goalId: goal.id, actor: actor(offer.memberId), weeklyCents: offer.weeklyCents }, clock);
      const adult = actor(scenario.listedBy);
      saveKit(db, { householdId, goalId: goal.id, actor: adult, expectedRevision: kitView(db, goal).revision, items: scenario.kit.map((line) => ({ ...line, from: 'typed' })) }, clock);
      const plan = () => kitPlanView(db, { householdId, goal, now: clock.now().getTime() });
      for (const line of plan().lines) {
        for (const result of found.get(line.name) ?? []) {
          addCandidate(db, { householdId, goalId: goal.id, actor: adult, revision: plan().revision, lineId: line.lineId, item: merchant.draft(result.draftId), draftId: result.draftId, perListing: scenario.perListing }, clock);
        }
      }
    };
  }
  return { id, title, defaults, merchant, prepare };
}
