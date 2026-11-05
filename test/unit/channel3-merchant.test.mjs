import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { CHANNEL3_SEARCH_URL, createMerchant, normalizeSearch, searchRequestBody, validateSearch } from '../../server/merchant/channel3.mjs';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { createClock } from '../../server/household.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXED_NOW, contribution, setupDomain } from '../helpers/setup.mjs';
import { FAKE_IMAGE, createFakeChannel3, fakeProduct, fakeSearchResponse, hangingFetch } from '../helpers/fake-channel3.mjs';

// All Channel3 answers below are fakes shaped like the documented /v1/search response. None proves a live call.
const KEY = 'test-channel3-key-not-real-5e1b';
const rejects = (promise, code) => assert.rejects(promise, (e) => { assert.equal(e.code, code, e.message); return true; });

test('only the typed words, an optional budget and the goal currency are sent, to the documented endpoint', async () => {
  assert.deepEqual(validateSearch({ query: '  four person\u0007 tent  ' }), { query: 'four person tent', budgetCents: null });
  assert.throws(() => validateSearch({ query: 'a' }), /few words/);
  assert.throws(() => validateSearch({ query: 'x'.repeat(81) }), /under 80/);
  assert.throws(() => validateSearch({ query: 'tent https://evil.test/a' }), /rather than pasting a link/);
  assert.throws(() => validateSearch({ query: 'tent', budgetCents: 99 }), /between \$1\.00/);
  assert.throws(() => validateSearch({ query: 'tent', budgetCents: 12.5 }), /between \$1\.00/);
  assert.deepEqual(searchRequestBody({ query: 'tent', budgetCents: null }), { query: 'tent', limit: 3, config: { country: 'US', currency: 'USD', language: 'en' } });
  assert.deepEqual(searchRequestBody({ query: 'tent', budgetCents: 20050 }).filters, { price: { max_price: 200.5 } });

  const fake = createFakeChannel3();
  const merchant = createMerchant({ apiKey: KEY, fetch: fake.fetch });
  await merchant.search({ query: 'four person tent', budgetCents: 20000 });
  assert.equal(fake.calls.length, 1);
  const [call] = fake.calls;
  assert.equal(call.url, CHANNEL3_SEARCH_URL);
  assert.equal(call.url, 'https://api.trychannel3.com/v1/search');
  assert.equal(call.method, 'POST');
  assert.equal(call.redirect, 'error');
  assert.deepEqual(Object.keys(call.headers).sort(), ['Accept', 'Content-Type', 'x-api-key']);
  assert.equal(call.headers['x-api-key'], KEY);
  assert.deepEqual(call.body, { query: 'four person tent', limit: 3, config: { country: 'US', currency: 'USD', language: 'en' }, filters: { price: { max_price: 200 } } });
});

test('valid results become at most three rows with a usable USD offer, safe links and Channel3-hosted images only', () => {
  const products = [
    fakeProduct(),
    fakeProduct({ id: 'fakeLamp02', title: 'Test fixture: <b>Lantern</b>\u202e', images: [{ url: 'https://images.example-retailer.test/lamp.jpg', is_main_image: true }], offers: [
      { url: 'javascript:alert(1)', domain: 'bad.example.com', price: { price: 1, currency: 'USD' }, availability: 'InStock' },
      { url: 'http://insecure.example.com/lamp', domain: 'insecure.example.com', price: { price: 2, currency: 'USD' }, availability: 'InStock' },
      { url: 'https://buy.trychannel3.com/fake/lamp', domain: 'example-lamps.com', price: { price: 24, currency: 'USD' }, availability: 'InStock', condition: 'used' },
    ] }),
    fakeProduct({ id: 'fakeBag03', title: 'Test fixture: Sleeping bag', offers: [] }),
    fakeProduct({ id: 'fakeFour04', title: 'Test fixture: A fourth product' }),
    { id: 'bad id with spaces', title: 'Dropped' },
  ];
  const rows = normalizeSearch(fakeSearchResponse(products), { budgetCents: 20000 });
  assert.equal(rows.length, 3);
  const [tent, lamp, bag] = rows;
  // Within budget and in stock beats the cheaper out-of-stock offer; the returned availability is kept as returned.
  assert.deepEqual([tent.merchant, tent.priceCents, tent.currency, tent.availability, tent.otherOffers, tent.usable], ['example-outfitter.com', 18950, 'USD', 'InStock', 1, true]);
  assert.deepEqual(tent.image, { url: FAKE_IMAGE, alt: 'Green dome tent' });
  assert.equal(tent.brand, 'Fixture Outdoors');
  // Script and plain-http links are dropped; text stays text (escaped by the browser); bidi controls are removed.
  assert.deepEqual([lamp.url, lamp.merchant, lamp.priceCents, lamp.condition, lamp.otherOffers], ['https://buy.trychannel3.com/fake/lamp', 'example-lamps.com', 2400, 'used', 0]);
  assert.equal(lamp.title, 'Test fixture: <b>Lantern</b>');
  assert.equal(lamp.image, null, 'a merchant-hosted image is not shown');
  // No offer: the missing price stays missing and the row cannot become a goal.
  assert.deepEqual([bag.priceCents, bag.currency, bag.availability, bag.usable, bag.unusableReason], [null, null, null, false, 'No price was returned for this item.']);
});

test('non-USD, malformed and out-of-range prices are never converted or invented', () => {
  const [eur] = normalizeSearch(fakeSearchResponse([fakeProduct({ offers: [{ url: 'https://buy.trychannel3.com/x', domain: 'example.de', price: { price: 99, currency: 'EUR' }, availability: 'InStock' }] })]));
  assert.deepEqual([eur.priceCents, eur.currency, eur.usable, eur.unusableReason], [9900, 'EUR', false, 'Priced in EUR; the goal is kept in USD.']);
  const [noPrice] = normalizeSearch(fakeSearchResponse([fakeProduct({ offers: [{ url: 'https://buy.trychannel3.com/x', domain: 'example.com', price: { price: 'free', currency: 'USD' }, availability: 'Maybe' }] })]));
  assert.deepEqual([noPrice.priceCents, noPrice.availability, noPrice.usable], [null, null, false]);
  const [huge] = normalizeSearch(fakeSearchResponse([fakeProduct({ offers: [{ url: 'https://buy.trychannel3.com/x', domain: 'example.com', price: { price: 250000, currency: 'USD' }, availability: 'InStock' }] })]));
  assert.equal(huge.usable, false);
  for (const body of [null, {}, { products: 'none' }, []]) assert.throws(() => normalizeSearch(body), /could not read/);
});

test('provider errors, malformed bodies, timeouts and network failures are short honest states', async () => {
  const cases = [
    [401, { detail: 'API key was provided but is invalid.' }, 'merchant_auth'],
    [402, { detail: 'You have used all of your free credits.' }, 'merchant_credits'],
    [422, { detail: [{ msg: 'bad' }] }, 'merchant_rejected'],
    [429, { detail: 'slow down' }, 'merchant_rate_limited'],
    [500, { detail: 'Internal Server Error' }, 'merchant_unavailable'],
    [504, { detail: 'Timed out' }, 'merchant_unavailable'],
  ];
  for (const [status, body, code] of cases) {
    const fake = createFakeChannel3((_, __, ___) => new Response(JSON.stringify(body), { status }));
    await rejects(createMerchant({ apiKey: KEY, fetch: fake.fetch }).search({ query: 'tent' }), code);
  }
  const notJson = createFakeChannel3(() => new Response('<html>oops</html>', { status: 200 }));
  await rejects(createMerchant({ apiKey: KEY, fetch: notJson.fetch }).search({ query: 'tent' }), 'merchant_malformed');
  const wrongShape = createFakeChannel3(() => ({ items: [] }));
  await rejects(createMerchant({ apiKey: KEY, fetch: wrongShape.fetch }).search({ query: 'tent' }), 'merchant_malformed');
  const hang = hangingFetch();
  const started = Date.now();
  await rejects(createMerchant({ apiKey: KEY, fetch: hang.fetch, timeoutMs: 60 }).search({ query: 'tent' }), 'merchant_timeout');
  assert.ok(Date.now() - started < 2000);
  await rejects(createMerchant({ apiKey: KEY, fetch: async () => { throw new TypeError('fetch failed'); } }).search({ query: 'tent' }), 'merchant_unreachable');
});

test('a missing key is a plain "not connected" state and makes no request', async () => {
  const fake = createFakeChannel3();
  const merchant = createMerchant({ apiKey: null, fetch: fake.fetch });
  assert.equal(merchant.status().mode, 'off');
  assert.match(merchant.status().setup, /CHANNEL3_API_KEY/);
  await rejects(merchant.search({ query: 'tent' }), 'merchant_not_connected');
  assert.equal(fake.calls.length, 0);
  assert.equal(loadConfig({}).merchant.mode, 'off');
  assert.deepEqual(loadConfig({ CHANNEL3_API_KEY: '  ' }).merchant, { mode: 'off' });
  assert.equal(loadConfig({ CHANNEL3_API_KEY: KEY }).merchant.mode, 'live');
});

test('repeat searches reuse a short cache, concurrent ones share a request, and bursts are limited', async () => {
  let t = Date.parse('2026-11-04T12:00:00Z');
  const clock = { iso: () => new Date(t).toISOString() };
  let release;
  const gate = new Promise((r) => { release = r; });
  const fake = createFakeChannel3(async (_, __, n) => { if (n === 1) await gate; return fakeSearchResponse(); });
  const merchant = createMerchant({ apiKey: KEY, fetch: fake.fetch, clock, maxSearchesPerMinute: 3 });
  const both = Promise.all([merchant.search({ query: 'Tent' }), merchant.search({ query: 'tent ' })]);
  release();
  const [a, b] = await both;
  assert.equal(fake.calls.length, 1);
  assert.equal(a.checkedAt, b.checkedAt);
  const again = await merchant.search({ query: 'tent' });
  assert.equal(again.cached, true);
  assert.equal(fake.calls.length, 1);
  await merchant.search({ query: 'lantern' });
  await merchant.search({ query: 'stove' });
  await rejects(merchant.search({ query: 'kayak' }), 'merchant_busy');
  assert.equal(fake.calls.length, 3);
  // After the cache window a fresh search asks Channel3 again (prices change).
  t += 3 * 60_000;
  await merchant.search({ query: 'tent' });
  assert.equal(fake.calls.length, 4);
});

test('a draft is the server’s own copy of a usable shown result and expires', async () => {
  let t = Date.parse('2026-11-04T12:00:00Z');
  const clock = { iso: () => new Date(t).toISOString() };
  const fake = createFakeChannel3(() => fakeSearchResponse([fakeProduct(), fakeProduct({ id: 'fakeNone', offers: [] })]));
  const merchant = createMerchant({ apiKey: KEY, fetch: fake.fetch, clock });
  const res = await merchant.search({ query: 'tent' });
  const [usable, unusable] = res.results;
  assert.match(usable.draftId, /^c3d_[0-9a-f]{24}$/);
  assert.equal(unusable.draftId, null);
  assert.equal(merchant.draft(usable.draftId).productId, 'fakeTent01');
  assert.equal(merchant.draft(usable.draftId).checkedAt, '2026-11-04T12:00:00.000Z');
  assert.throws(() => merchant.draft('c3d_forged'), (e) => e.code === 'merchant_draft_expired');
  t += 31 * 60_000;
  assert.throws(() => merchant.draft(usable.draftId), (e) => e.code === 'merchant_draft_expired');
});

// ---------- routes, with the real app and example data ----------
const root = fileURLToPath(new URL('../../', import.meta.url));
async function startServer({ respond, apiKey = KEY } = {}) {
  const db = openDatabase(':memory:');
  const clock = createClock(FIXED_NOW);
  const fake = createFakeChannel3(respond);
  const merchant = apiKey ? createMerchant({ apiKey, fetch: fake.fetch, clock }) : null;
  const app = createApp({ config: loadConfig({}, { root }), db, clock, merchant, root });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const response = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    let json = null; try { json = JSON.parse(text); } catch { /* html */ }
    return { status: response.status, json, text, headers: response.headers };
  };
  return { call, fake, db, close: () => new Promise((r) => { server.close(r); db.close(); }) };
}
const goalFrom = (state, overrides = {}) => ({
  name: state.goal.name, targetCents: state.goal.targetCents, startingCents: state.progress.startingCents,
  weeklyBudgetCents: state.goal.weeklyBudgetCents, targetDate: state.goal.targetDate, ...overrides,
});
const counts = (db) => db.prepare(`SELECT (SELECT COUNT(*) FROM ledger_entries) AS ledger, (SELECT COUNT(*) FROM payment_orders) AS orders,
  (SELECT COUNT(*) FROM achievements) AS achievements`).get();

test('searching changes nothing; only an explicitly confirmed draft changes the goal, with provenance and no money', async () => {
  const s = await startServer();
  try {
    let state = (await s.call('POST', '/api/setup', { playMode: 'family', name: 'House of Alder', crest: { field: 'cobalt', charge: 'stag' } })).json.state;
    assert.equal(state.modes.merchant.mode, 'live');
    assert.equal(state.goalItem, null);
    // The page allows Channel3-hosted product images, nothing broader.
    const csp = (await s.call('GET', '/')).headers.get('content-security-policy');
    assert.match(csp, /img-src 'self' data: https:\/\/\*\.trychannel3\.com;/);

    const before = { goal: state.goal, counts: counts(s.db) };
    const found = await s.call('POST', '/api/merchant/search', { query: 'four person tent', budgetCents: 20000 });
    assert.equal(found.status, 200);
    assert.equal(found.json.results.length, 1);
    const [tent] = found.json.results;
    assert.equal(tent.priceCents, 18950);
    // The request body sent to Channel3 holds no household name, member, ledger or goal data.
    const sent = JSON.stringify(s.fake.calls[0].body);
    for (const secret of ['Alder', 'Rowan', 'Wren', state.goal.name, 'hh_demo']) assert.ok(!sent.includes(secret), secret);
    state = (await s.call('GET', '/api/state')).json;
    assert.deepEqual(state.goal, before.goal, 'search does not change the goal');
    assert.deepEqual(counts(s.db), before.counts);

    // Confirmed save: the goal takes the item name and price; progress, ledger, orders and areas are unchanged.
    // $60 is reported toward the goal: a $189.50 goal would open the Manor (25%) at once, so the merchant refuses it
    // and names the smallest amount that opens nothing. Nothing changes.
    let res = await s.call('POST', '/api/merchant/goal', { draftId: tent.draftId, goalId: state.goal.id, goal: goalFrom(state, { name: 'Family dome tent', targetCents: 18950 }) });
    assert.deepEqual([res.status, res.json.error.code], [409, 'merchant_would_open_areas']);
    assert.match(res.json.error.message, /would open Manor from progress already tracked.*at least \$240\.01/);
    assert.equal(res.json.error.minTargetCents, 24001);
    assert.deepEqual(counts(s.db), before.counts);
    const saved = await s.call('POST', '/api/merchant/goal', { draftId: tent.draftId, goalId: state.goal.id, goal: goalFrom(state, { name: 'Family dome tent', targetCents: 24001 }) });
    assert.equal(saved.status, 200, saved.text);
    const after = saved.json.state;
    assert.deepEqual([after.goal.name, after.goal.targetCents], ['Family dome tent', 24001]);
    assert.equal(after.progress.progressCents, state.progress.progressCents);
    // No ledger entry or payment order is created. The existing goal save may record an already-open keepsake
    // (the porch, open at 10% by progress), but no area opens.
    const now = counts(s.db);
    assert.deepEqual([now.ledger, now.orders], [before.counts.ledger, before.counts.orders]);
    assert.deepEqual(s.db.prepare('SELECT key FROM achievements').all().map((r) => r.key), ['estate:porch']);
    assert.deepEqual(after.rewards.realm.districts.filter((d) => d.open).map((d) => d.id), state.rewards.realm.districts.filter((d) => d.open).map((d) => d.id));
    assert.deepEqual(after.goalItem, {
      provider: 'Channel3', productId: 'fakeTent01', title: 'Test fixture: Four-person dome tent', merchant: 'example-outfitter.com',
      url: 'https://buy.trychannel3.com/fake/tent-a', priceCents: 18950, currency: 'USD', availability: 'InStock',
      checkedAt: tent.checkedAt, savedAt: new Date(FIXED_NOW).toISOString(),
    });
    // Renaming the goal through the ordinary editor detaches the item rather than mislabelling the new goal.
    const renamed = await s.call('PUT', '/api/goal', goalFrom(after, { name: 'Something else' }));
    assert.equal(renamed.json.state.goalItem, null);
  } finally { await s.close(); }
});

test('the merchant cannot lower the goal into areas, undercut the price, use a stale goal or an expired draft', async () => {
  const s = await startServer({ respond: () => fakeSearchResponse([fakeProduct({ offers: [{ url: 'https://buy.trychannel3.com/fake/lamp', domain: 'example-lamps.com', price: { price: 40, currency: 'USD' }, availability: 'InStock' }] })]) });
  try {
    const state = (await s.call('POST', '/api/setup', { playMode: 'family', name: 'House of Alder', crest: { field: 'cobalt', charge: 'stag' } })).json.state;
    const [item] = (await s.call('POST', '/api/merchant/search', { query: 'lantern' })).json.results;
    const before = counts(s.db);
    // $60 is already reported; a $40 goal would open areas immediately.
    let res = await s.call('POST', '/api/merchant/goal', { draftId: item.draftId, goalId: state.goal.id, goal: goalFrom(state, { name: 'Lantern', targetCents: 4000 }) });
    assert.deepEqual([res.status, res.json.error.code], [409, 'merchant_would_open_areas']);
    assert.match(res.json.error.message, /Areas open only through progress/);
    res = await s.call('POST', '/api/merchant/goal', { draftId: item.draftId, goalId: state.goal.id, goal: goalFrom(state, { name: 'Lantern', targetCents: 3999, startingCents: 0 }) });
    assert.deepEqual([res.status, res.json.error.code], [400, 'merchant_goal_below_price']);
    res = await s.call('POST', '/api/merchant/goal', { draftId: item.draftId, goalId: 'goal_other', goal: goalFrom(state, { name: 'Lantern', targetCents: 30000 }) });
    assert.deepEqual([res.status, res.json.error.code], [409, 'goal_changed']);
    res = await s.call('POST', '/api/merchant/goal', { draftId: 'c3d_000000000000000000000000', goalId: state.goal.id, goal: goalFrom(state, { name: 'Lantern', targetCents: 30000 }) });
    assert.deepEqual([res.status, res.json.error.code], [410, 'merchant_draft_expired']);
    // Existing goal validation still applies (here: the name).
    res = await s.call('POST', '/api/merchant/goal', { draftId: item.draftId, goalId: state.goal.id, goal: goalFrom(state, { name: 'L', targetCents: 30000 }) });
    assert.deepEqual([res.status, res.json.error.code], [400, 'invalid_goal']);
    const now = (await s.call('GET', '/api/state')).json;
    assert.deepEqual([now.goal.name, now.goal.targetCents, now.goalItem], [state.goal.name, state.goal.targetCents, null]);
    assert.deepEqual(counts(s.db), before);
  } finally { await s.close(); }
});

test('without a key the routes say "not connected" and Channel3 is never called', async () => {
  const s = await startServer({ apiKey: null });
  try {
    const status = (await s.call('GET', '/api/status')).json;
    assert.equal(status.merchant.mode, 'off');
    const res = await s.call('POST', '/api/merchant/search', { query: 'tent' });
    assert.deepEqual([res.status, res.json.error.code], [503, 'merchant_not_connected']);
    assert.equal((await s.call('POST', '/api/merchant/search', { query: 'https://example.com/x' })).json.error.code, 'invalid_query');
    assert.equal(s.fake.calls.length, 0);
  } finally { await s.close(); }
});

test('the goal_items migration is additive: an existing version-two household keeps every record', () => {
  // A synthetic fixture in a fresh temporary folder, never the owner's file. The folder is left in place.
  const file = join(mkdtempSync(join(tmpdir(), 'castle-merchant-migration-')), 'example.sqlite');
  const s = setupDomain({ file });
  s.service.simulateContribution({ ...contribution({ amountCents: 1500 }), outcome: 'completed' });
  let db = s.db;
  const snapshot = (d) => ['households', 'members', 'goals', 'ledger_entries', 'payment_orders', 'payment_captures', 'achievements', 'plans']
    .map((t) => [t, d.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]);
  db.exec('DROP TABLE goal_items; PRAGMA user_version = 2;');
  const before = snapshot(db);
  db.close();
  db = openDatabase(file);
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
    assert.deepEqual(snapshot(db), before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM goal_items').get().n, 0);
  } finally { db.close(); }
});
