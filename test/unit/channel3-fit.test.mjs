import test from 'node:test';
import assert from 'node:assert/strict';
import { FIT_INSPECT_LIMIT, createMerchant, fitRequestBody, normalizeCategories, normalizeCategory, normalizeSearch, searchRequestBody } from '../../server/merchant/channel3.mjs';
import { createFakeChannel3, fakeSearchResponse } from '../helpers/fake-channel3.mjs';
import { FIT_CATEGORY, FIT_DETAIL, fitCatalog, fitProduct, fitProducts } from '../helpers/fit-catalog.mjs';

// The family-fit side of the Channel3 adapter, against fake responses shaped like the published contract. Every
// category, handle, value and product here is an invented test fixture, not Channel3's live taxonomy.
const KEY = 'test-channel3-key-not-real-fit';
const rejects = (promise, code) => assert.rejects(promise, (e) => { assert.equal(e.code, code, e.message); return true; });
const NEED = { category: { slug: 'fixture-tents', title: 'Tents (test fixture)', path: ['Outdoor (test fixture)', 'Tents (test fixture)'] },
  mustHaves: [{ key: 'fixture-capacity', name: 'Sleeps (test fixture)', accepted: ['4 person', '6 person'], allowed: ['1 person', '2 person', '4 person', '6 person'] }] };

test('category lists are bounded, safe and in the catalog’s order; must-haves are enumerated non-color attributes only', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ slug: `fixture-kind-${i}`, title: `Kind ${i}`, path: [{ slug: `fixture-kind-${i}`, title: `Kind ${i}` }] }));
  const kinds = normalizeCategories({ categories: [{ slug: '../etc', title: 'Bad' }, { slug: 'fixture-a', title: '' }, FIT_CATEGORY, FIT_CATEGORY, ...many] });
  assert.equal(kinds.length, 5);
  assert.deepEqual(kinds[0], { slug: 'fixture-tents', title: 'Tents (test fixture)', path: [{ slug: 'fixture-outdoor', title: 'Outdoor (test fixture)' }, { slug: 'fixture-tents', title: 'Tents (test fixture)' }] });
  assert.throws(() => normalizeCategories({ categories: 'nope' }), (e) => e.code === 'merchant_malformed');
  const detail = normalizeCategory({ ...FIT_DETAIL, attributes: [...FIT_DETAIL.attributes,
    { slug: 'Bad Key', name: 'Spaces', values: ['a'] }, { slug: 'fixture-season', name: 'Duplicate', values: ['x'] },
    { slug: 'fixture-doors', name: 'Doors‮ (test fixture)', values: ['1', '1', '2', '', 7] }] }, 'fixture-tents');
  assert.deepEqual(detail.attributes, [
    { key: 'fixture-capacity', name: 'Sleeps (test fixture)', values: ['1 person', '2 person', '4 person', '6 person'] },
    { key: 'fixture-season', name: 'Season rating (test fixture)', values: ['3-season', '4-season'] },
    { key: 'fixture-doors', name: 'Doors (test fixture)', values: ['1', '2'] }]);
  assert.throws(() => normalizeCategory(FIT_DETAIL, 'fixture-tarps'), (e) => e.code === 'merchant_malformed');
});

test('the fit request carries words, taxonomy values, a ceiling and the locale; the ordinary request is unchanged', () => {
  assert.deepEqual(fitRequestBody({ query: 'tent', need: NEED, ceilingCents: 15000 }), { query: 'tent', limit: 12,
    filters: { category_ids: ['fixture-tents'], attributes: { 'fixture-capacity': ['4 person', '6 person'] }, price: { max_price: 150 } },
    config: { country: 'US', currency: 'USD', language: 'en' } });
  assert.deepEqual(fitRequestBody({ query: 'tent', need: { category: null, mustHaves: [] }, ceilingCents: 12050 }),
    { query: 'tent', limit: 12, filters: { price: { max_price: 120.5 } }, config: { country: 'US', currency: 'USD', language: 'en' } });
  assert.deepEqual(searchRequestBody({ query: 'tent', budgetCents: null }), { query: 'tent', limit: 3, config: { country: 'US', currency: 'USD', language: 'en' } });
  // Catalog facts are read only when asked, bounded, and never include color or unsafe keys.
  const product = fitProduct('fixtureFacts', 'Test fixture: Facts', 99, { color: ['Green'], 'Bad Key': ['x'], 'fixture-capacity': ['4 person', '4 person', 'x'.repeat(80)] });
  assert.equal('catalog' in normalizeSearch(fakeSearchResponse([product]))[0], false);
  const { catalog } = normalizeSearch(fakeSearchResponse([product]), { withFacts: true })[0];
  assert.deepEqual(Object.keys(catalog.attributes), ['fixture-capacity']);
  assert.deepEqual([catalog.attributes['fixture-capacity'].length, catalog.attributes['fixture-capacity'][1].length], [2, 60]);
  assert.deepEqual(catalog.category, { slug: 'fixture-tents', title: 'Tents (test fixture)', path: ['fixture-outdoor', 'fixture-tents'] });
});

test('one fit search inspects at most twelve products, shows at most three suitable ones, and never retries or loosens', async () => {
  const products = Array.from({ length: 15 }, (_, i) => fitProduct(`fixtureFit${String(i).padStart(2, '0')}`, `Test fixture: Tent ${i}`, 50 + i, { 'fixture-capacity': [i % 2 ? '4 person' : '2 person'] }));
  const catalog = fitCatalog({ products });
  const merchant = createMerchant({ apiKey: KEY, fetch: catalog.fetch });
  await merchant.findCategories({ query: 'tent' });
  await merchant.category('fixture-tents');
  const need = merchant.buildNeed({ category: 'fixture-tents', mustHaves: [{ key: 'fixture-capacity', values: ['6 person', '4 person'] }] });
  assert.deepEqual(need.mustHaves[0].accepted, ['4 person', '6 person'], 'values keep the catalog’s order');
  const calls = catalog.calls.length;
  const found = await merchant.fitSearch({ query: 'tent', need, ceilingCents: 15000, context: { ceilingCents: 15000, targetDate: '2026-12-20', reserveCents: 9000, on: '2026-11-08' } });
  assert.equal(found.inspected, FIT_INSPECT_LIMIT);
  // Products 1, 3, 5, 7, 9 and 11 sleep four (the inspected twelve); the cheapest three are shown, lowest price first.
  assert.deepEqual(found.results.map((r) => r.productId), ['fixtureFit01', 'fixtureFit03', 'fixtureFit05']);
  assert.equal(found.moreSuitable, 3);
  assert.equal(found.others.length, 6);
  assert.equal(catalog.calls.length, calls + 1, 'one page, no relaxed retry');
  assert.equal(found.results.some((r) => 'catalog' in r), false);
  // A result with no suitable item is an empty list, never a looser one.
  const none = merchant.buildNeed({ category: 'fixture-tents', mustHaves: [{ key: 'fixture-capacity', values: ['6 person'] }] });
  const empty = await merchant.fitSearch({ query: 'tent', need: none, ceilingCents: 15000, context: {} });
  assert.deepEqual([empty.results, catalog.calls.length], [[], calls + 2]);
});

test('a category must have been listed by the catalog here; its must-haves are reused, and a not-connected merchant calls nothing', async () => {
  const catalog = fitCatalog();
  const merchant = createMerchant({ apiKey: KEY, fetch: catalog.fetch });
  await rejects(merchant.category('fixture-tents'), 'category_unknown');
  assert.equal(catalog.calls.length, 0);
  await merchant.findCategories({ query: 'tent' });
  await merchant.category('fixture-tents');
  const again = await merchant.category('fixture-tents');
  assert.deepEqual([again.cached, catalog.calls.length], [true, 2]);
  assert.throws(() => merchant.buildNeed({ category: 'fixture-tarps', mustHaves: [] }), (e) => e.code === 'category_needs_check');
  await rejects(merchant.findCategories({ query: 'tent https://evil.test' }), 'invalid_query');
  const off = createMerchant({ apiKey: null });
  await rejects(off.findCategories({ query: 'tent' }), 'merchant_not_connected');
  const failing = createMerchant({ apiKey: KEY, fetch: createFakeChannel3((url, init, n) => new Response('{}', { status: 401 })).fetch });
  await rejects(failing.findCategories({ query: 'tent' }), 'merchant_auth');
});

test('review F1: concurrent fit searches share only the public catalog call; each caller keeps its own context and draft references', async () => {
  const catalog = fitCatalog();
  const merchant = createMerchant({ apiKey: KEY, fetch: catalog.fetch });
  await merchant.findCategories({ query: 'tent' });
  await merchant.category('fixture-tents');
  const need = merchant.buildNeed({ category: 'fixture-tents', mustHaves: [{ key: 'fixture-capacity', values: ['4 person', '6 person'] }] });
  // Identical public request (words, kind, must-haves, ceiling); different private planning context per caller.
  const contextA = { ceilingCents: 15000, targetDate: '2026-12-20', reserveCents: 9000, on: '2026-11-08' };
  const contextB = { ceilingCents: 15000, targetDate: '2027-01-03', reserveCents: 15000, on: '2026-11-08' };
  const calls = catalog.calls.length;
  const release = catalog.hold();
  const pendingA = merchant.fitSearch({ query: 'tent', need, ceilingCents: 15000, context: contextA });
  const pendingB = merchant.fitSearch({ query: 'tent', need, ceilingCents: 15000, context: contextB });
  release();
  const [a, b] = await Promise.all([pendingA, pendingB]);
  assert.equal(catalog.calls.length, calls + 1, 'one public catalog call is still shared');
  assert.deepEqual(a.results.map((r) => r.fit.context), [contextA, contextA]);
  assert.deepEqual(b.results.map((r) => r.fit.context), [contextB, contextB]);
  // Each caller's results are its own drafts: no reference is shared, and each draft keeps its caller's context.
  const refs = (found) => found.results.flatMap((r) => [r.draftId, r.referenceId]);
  assert.equal(refs(a).some((id) => refs(b).includes(id)), false);
  assert.deepEqual(merchant.draft(b.results[0].draftId).fit.context, contextB);
  assert.deepEqual(merchant.draft(a.results[0].draftId).fit.context, contextA);
  // The public facts are the same for both.
  assert.deepEqual(a.results.map((r) => [r.productId, r.priceCents, r.fit.status]), b.results.map((r) => [r.productId, r.priceCents, r.fit.status]));
});

test('review F1, same pattern in refresh: concurrent checks of one fit item share the look-up, but each keeps its own context and draft', async () => {
  const catalog = fitCatalog();
  const merchant = createMerchant({ apiKey: KEY, fetch: catalog.fetch });
  await merchant.findCategories({ query: 'tent' });
  await merchant.category('fixture-tents');
  const need = merchant.buildNeed({ category: 'fixture-tents', mustHaves: [{ key: 'fixture-capacity', values: ['4 person', '6 person'] }] });
  const contextA = { ceilingCents: 15000, targetDate: '2026-12-20', reserveCents: 9000, on: '2026-11-08' };
  const contextB = { ceilingCents: 15000, targetDate: '2027-01-03', reserveCents: 15000, on: '2026-11-08' };
  const a = await merchant.fitSearch({ query: 'tent', need, ceilingCents: 15000, context: contextA });
  const b = await merchant.fitSearch({ query: 'tent', need, ceilingCents: 15000, context: contextB });
  const calls = catalog.calls.length;
  const [ra, rb] = await Promise.all([merchant.refresh(merchant.draft(a.results[0].referenceId)), merchant.refresh(merchant.draft(b.results[0].referenceId))]);
  assert.equal(catalog.calls.length, calls + 1, 'one shared look-up');
  assert.deepEqual([ra.results[0].fit.context, rb.results[0].fit.context], [contextA, contextB]);
  assert.notEqual(ra.results[0].referenceId, rb.results[0].referenceId);
  assert.deepEqual(merchant.draft(rb.results[0].referenceId).fit.context, contextB);
});

// Review F3: a judged result rests on what the catalog reported for the item. A newer read of the same offer that reports
// something else for the kind of item or a must-have is newer evidence, so the earlier judgement cannot be reused.
const expiredRef = (e) => e.status === 410 && e.code === 'merchant_draft_expired';
const CONTEXT = { ceilingCents: 15000, targetDate: '2026-12-20', reserveCents: 9000, on: '2026-11-08' };
const sleepsTwo = (id, title, price) => fitProduct(id, title, price, { 'fixture-capacity': ['2 person'] });
async function fitReady(merchant) {
  await merchant.findCategories({ query: 'tent' });
  await merchant.category('fixture-tents');
  return merchant.buildNeed({ category: 'fixture-tents', mustHaves: [{ key: 'fixture-capacity', values: ['4 person', '6 person'] }] });
}

test('review F3: a newer check that contradicts a must-have expires the earlier fit draft; harmless or order-only changes keep it', async () => {
  const catalog = fitCatalog({ products: [
    fitProduct('fixtureTent4pA', 'Test fixture: Four-person tent A', 120, { 'fixture-capacity': ['4 person'] }),
    fitProduct('fixtureTentWide', 'Test fixture: Four- or six-person tent', 140, { 'fixture-capacity': ['4 person', '6 person'], 'fixture-season': ['3-season'] }),
  ] });
  const merchant = createMerchant({ apiKey: KEY, fetch: catalog.fetch });
  const need = await fitReady(merchant);
  const found = await merchant.fitSearch({ query: 'tent', need, ceilingCents: 15000, context: CONTEXT });
  const [tentA, wide] = found.results;
  assert.deepEqual(found.results.map((r) => [r.productId, r.fit.status]), [['fixtureTent4pA', 'suitable'], ['fixtureTentWide', 'suitable']]);
  // Harmless: a new title, picture and tracking link, the same values in another order, and a fact the need does not use.
  const renamed = fitProduct('fixtureTentWide', 'Test fixture: Roomy tent (renamed)', 140, { 'fixture-capacity': ['6 person', '4 person'], 'fixture-season': ['4-season'] });
  renamed.images = [{ url: 'https://cdn.trychannel3.com/fake-test-image-0002', is_main_image: true, alt_text: 'Roomy tent' }];
  renamed.offers[0].url = 'https://buy.trychannel3.com/fake/fixtureTentWide-new-tracking-link';
  catalog.lookup.set('fixtureTentWide', renamed);
  const kept = await merchant.refresh(merchant.draft(wide.referenceId));
  assert.deepEqual([kept.results[0].title, kept.results[0].fit.status], ['Test fixture: Roomy tent (renamed)', 'suitable']);
  assert.equal(merchant.draft(wide.draftId).fit.status, 'suitable', 'the earlier draft is still usable');
  // Contradicted: the same offer (retailer, price, stock and selection) now reports that it sleeps two.
  catalog.lookup.set('fixtureTent4pA', sleepsTwo('fixtureTent4pA', 'Test fixture: Four-person tent A', 120));
  const checked = await merchant.refresh(merchant.draft(tentA.referenceId));
  assert.deepEqual([checked.results[0].fit.status, checked.results[0].fit.check.mustHaves[0].found], ['not_suitable', ['2 person']]);
  assert.throws(() => merchant.draft(tentA.draftId), expiredRef, 'the earlier "sleeps four" judgement cannot be reused');
  assert.equal(merchant.draft(checked.results[0].referenceId).fit.status, 'not_suitable', 'the newer check is the current judgement');
});

test('review F3: an older fit search answered after that check cannot bring the contradicted must-have back', async () => {
  const catalog = fitCatalog();
  const merchant = createMerchant({ apiKey: KEY, fetch: catalog.fetch });
  const need = await fitReady(merchant);
  const first = await merchant.fitSearch({ query: 'tent', need, ceilingCents: 15000, context: CONTEXT });
  const release = catalog.hold();
  const late = merchant.fitSearch({ query: 'four person tent', need, ceilingCents: 15000, context: CONTEXT }); // asked first, answered last
  try {
    catalog.lookup.set('fixtureTent4pA', sleepsTwo('fixtureTent4pA', 'Test fixture: Four-person tent A', 120));
    const checked = await merchant.refresh(merchant.draft(first.results[0].referenceId));
    assert.equal(checked.results[0].fit.status, 'not_suitable');
    release();
    // The slower answer still says tent A sleeps four. It is older than the check, so it is refused, not shown as suitable.
    await assert.rejects(late, expiredRef);
    assert.throws(() => merchant.draft(first.results[0].draftId), expiredRef);
  } finally { release(); await late.catch(() => {}); }
});

test('review F3: an older check of a fit item answered after a newer search cannot bring the contradicted must-have back', async () => {
  const products = fitProducts();
  const catalog = fitCatalog({ products });
  let gate = null;
  const fetch = async (url, init) => {
    const response = await catalog.fetch(url, init); // answered as the catalog was when asked, delivered later
    if (gate && String(url).includes('/v1/products/')) { const wait = gate; gate = null; await wait; }
    return response;
  };
  let open;
  const merchant = createMerchant({ apiKey: KEY, fetch });
  const need = await fitReady(merchant);
  const first = await merchant.fitSearch({ query: 'tent', need, ceilingCents: 15000, context: CONTEXT });
  gate = new Promise((resolve) => { open = resolve; });
  const slow = merchant.refresh(merchant.draft(first.results[0].referenceId)); // tent A still sleeps four when asked
  try {
    products[1] = sleepsTwo('fixtureTent4pA', 'Test fixture: Four-person tent A', 120);
    const newer = await merchant.fitSearch({ query: 'four person tent', need, ceilingCents: 15000, context: CONTEXT });
    assert.equal(newer.results.some((r) => r.productId === 'fixtureTent4pA'), false, 'the newer search sees two person');
    open();
    await assert.rejects(slow, expiredRef);
  } finally { open(); await slow.catch(() => {}); }
});

test('review F3: an ordinary result keeps its offer when a newer check changes the item’s facts, but no longer carries the replaced facts', async () => {
  const catalog = fitCatalog();
  const merchant = createMerchant({ apiKey: KEY, fetch: catalog.fetch });
  const ordinary = await merchant.search({ query: 'tent', budgetCents: 15000 });
  const tent = ordinary.results.find((r) => r.productId === 'fixtureTent4pA');
  assert.deepEqual(merchant.draft(tent.draftId).catalog.attributes, { 'fixture-capacity': ['4 person'] });
  catalog.lookup.set('fixtureTent4pA', sleepsTwo('fixtureTent4pA', 'Test fixture: Four-person tent A', 120));
  const checked = await merchant.refresh(merchant.draft(tent.referenceId));
  // Ordinary behaviour is unchanged: the same offer is still a usable draft, and the cached search still answers.
  assert.deepEqual([merchant.draft(tent.draftId).usable, merchant.draft(tent.draftId).priceCents], [true, 12000]);
  assert.equal((await merchant.search({ query: 'tent', budgetCents: 15000 })).cached, true);
  // Only the newer check carries what the catalog reports now; the earlier result no longer carries "sleeps four".
  assert.deepEqual(merchant.draft(checked.results[0].referenceId).catalog.attributes, { 'fixture-capacity': ['2 person'] });
  assert.equal(merchant.draft(tent.draftId).catalog, null);
  assert.equal(catalog.calls.length, 2);
});
