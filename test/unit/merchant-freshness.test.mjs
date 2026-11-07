import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { createClock } from '../../server/household.mjs';
import { createMerchant, normalizeProduct, normalizeSearch } from '../../server/merchant/channel3.mjs';
import { createFakeChannel3, fakeProduct, fakeSearchResponse } from '../helpers/fake-channel3.mjs';

// Invented catalog responses only. Tests never contact Channel3, PayPal or a model.
const root = fileURLToPath(new URL('../../', import.meta.url));
const KEY = 'fixture-only-not-a-provider-key';
const product = (price = 189.5, availability = 'InStock', extra = {}) => fakeProduct({
  offers: [{ ...fakeProduct().offers[0], price: { price, currency: 'USD' }, availability }], ...extra,
});
const expired = (fn) => assert.throws(fn, (error) => error.status === 410 && error.code === 'merchant_draft_expired');
const gate = () => {
  let release;
  const promise = new Promise((r) => { release = r; });
  return { promise, release };
};

async function serverFor(respond) {
  const db = openDatabase(':memory:');
  const clock = createClock('2026-11-03T12:00:00');
  const fake = createFakeChannel3(respond);
  const merchant = createMerchant({ apiKey: KEY, fetch: fake.fetch, clock });
  const app = createApp({ config: loadConfig({}, { root }), db, clock, root, merchant });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://localhost:${server.address().port}`;
  return {
    db, fake, merchant,
    async call(method, route, body) {
      const res = await fetch(origin + route, {
        method, headers: { Origin: origin, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, json: await res.json() };
    },
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => { db.close(); resolve(); }); }),
  };
}

const goalBody = (s, extra = {}) => ({
  name: s.goal.name, targetCents: s.goal.targetCents, startingCents: s.progress.startingCents,
  targetDate: s.goal.targetDate, weeklyBudgetCents: s.goal.weeklyBudgetCents, ...extra,
});

test('a refreshed higher price invalidates the older draft before a goal write; the reviewed fresh draft can save', async () => {
  let current = product();
  const s = await serverFor((url) => url.includes('/products/') ? current : fakeSearchResponse([current]));
  try {
    const before = (await s.call('GET', '/api/state')).json;
    const found = (await s.call('POST', '/api/merchant/search', { query: 'family tent' })).json;
    const original = found.results[0];
    current = product(249);
    const fresh = await s.call('POST', '/api/merchant/refresh', { goalId: found.goalId, referenceId: original.referenceId });
    assert.equal(fresh.status, 200);
    const payload = { draftId: original.draftId, goalId: found.goalId, expectedGoalRevision: found.goalRevision, goal: goalBody(before, { name: 'Family tent', targetCents: 18950 }) };
    const refused = await s.call('POST', '/api/merchant/goal', payload);
    assert.equal(refused.status, 410, 'a tab holding the old price must review a current result before writing');
    assert.equal(refused.json.error.code, 'merchant_draft_expired');
    assert.deepEqual((await s.call('GET', '/api/state')).json, before, 'a refused stale draft changes no goal, plan, progress or receipt');
    const saved = await s.call('POST', '/api/merchant/goal', {
      ...payload, draftId: fresh.json.results[0].draftId, goal: goalBody(before, { name: 'Family tent', targetCents: 24900 }),
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.state.goalItem.priceCents, 24900);
    assert.equal(saved.json.state.goal.targetCents, 24900);
    const money = (state) => state.ledger.goalEntries.map(({ label: _label, ...entry }) => entry);
    assert.deepEqual(money(saved.json.state), money(before)); // An ordinary goal save relabels the example starting report.
    assert.deepEqual(saved.json.state.contributions, before.contributions);
    assert.equal(s.fake.calls.length, 2, 'only the explicit search and refresh reached the fake catalog');
  } finally { await s.close(); }
});

test('out-of-stock refresh removes the old usable draft and its cached search result', async () => {
  let current = product();
  const fake = createFakeChannel3((url) => url.includes('/products/') ? current : fakeSearchResponse([current]));
  const merchant = createMerchant({ apiKey: KEY, fetch: fake.fetch });
  const first = await merchant.search({ query: 'family tent' });
  const id = first.results[0].draftId;
  current = product(249, 'OutOfStock');
  const checked = await merchant.refresh(merchant.draft(id));
  assert.equal(checked.results[0].usable, false);
  assert.equal(checked.results[0].draftId, null);
  expired(() => merchant.draft(id));
  assert.equal(fake.calls.length, 2, 'invalidation never triggers an automatic search');
  const searched = await merchant.search({ query: 'family tent' });
  assert.equal(searched.cached, undefined);
  assert.equal(searched.results[0].availability, 'OutOfStock');
  assert.equal(fake.calls.length, 3, 'the explicit repeat search reads the catalog instead of reviving the old offer');
});

test('a catalog 404 expires the old offer without replacing it or starting a fallback search', async () => {
  const fake = createFakeChannel3((url) => url.includes('/products/') ? new Response('{}', { status: 404 }) : fakeSearchResponse([product()]));
  const merchant = createMerchant({ apiKey: KEY, fetch: fake.fetch });
  const first = await merchant.search({ query: 'family tent' });
  const id = first.results[0].draftId;
  await assert.rejects(merchant.refresh(merchant.draft(id)), (error) => error.code === 'merchant_item_missing');
  expired(() => merchant.draft(id));
  assert.equal(fake.calls.length, 2);
});

test('an unchanged offer with a refreshed tracking link keeps the earlier reviewed draft usable', async () => {
  const fresh = product(); fresh.offers[0].url = 'https://buy.trychannel3.com/fake/new-tracking-link';
  const fake = createFakeChannel3((url) => url.includes('/products/') ? fresh : fakeSearchResponse([product()]));
  const merchant = createMerchant({ apiKey: KEY, fetch: fake.fetch });
  const first = await merchant.search({ query: 'family tent' });
  const checked = await merchant.refresh(merchant.draft(first.results[0].draftId));
  assert.equal(checked.results[0].url, fresh.offers[0].url);
  assert.equal(merchant.draft(first.results[0].draftId).priceCents, 18950);
  assert.equal((await merchant.search({ query: 'family tent' })).cached, true);
  assert.equal(fake.calls.length, 2);
});

test('another retailer, condition or selected size is not invalidated by an offer changing', async () => {
  const large = [{ name: 'Size', label: 'Large' }], small = [{ name: 'Size', label: 'Small' }];
  const variants = [
    product(190, 'InStock', { variants: { selected: large } }),
    product(190, 'InStock', { variants: { selected: small } }),
    product(190, 'InStock', { variants: { selected: large }, offers: [{ ...product(190).offers[0], domain: 'another-retailer.example' }] }),
    product(190, 'InStock', { variants: { selected: large }, offers: [{ ...product(190).offers[0], condition: 'used' }] }),
  ];
  let index = 0;
  const fake = createFakeChannel3((url) => url.includes('/products/')
    ? product(230, 'InStock', { variants: { selected: large } }) : fakeSearchResponse([variants[index++]]));
  const merchant = createMerchant({ apiKey: KEY, fetch: fake.fetch });
  const shown = [];
  for (const query of ['large tent', 'small tent', 'other retailer', 'used tent']) shown.push((await merchant.search({ query })).results[0]);
  await merchant.refresh(merchant.draft(shown[0].draftId));
  expired(() => merchant.draft(shown[0].draftId));
  for (const row of shown.slice(1)) assert.equal(merchant.draft(row.draftId).priceCents, 19000);
  assert.equal((await merchant.search({ query: 'small tent' })).cached, true);
  assert.equal(fake.calls.length, 5);
});

test('a failed or malformed refresh does not invent a price change or invalidate the last usable result', async () => {
  for (const response of [new Response('{}', { status: 503 }), { id: 'wrong-product' }, new Response('not-json', { status: 200 })]) {
    const fake = createFakeChannel3((url) => url.includes('/products/') ? response : fakeSearchResponse([product()]));
    const merchant = createMerchant({ apiKey: KEY, fetch: fake.fetch });
    const first = await merchant.search({ query: 'family tent' });
    await assert.rejects(merchant.refresh(merchant.draft(first.results[0].draftId)));
    assert.equal(merchant.draft(first.results[0].draftId).priceCents, 18950);
    assert.equal((await merchant.search({ query: 'family tent' })).cached, true);
    assert.equal(fake.calls.length, 2);
  }
});

test('a slow older search cannot recreate a cheaper draft after a newer refresh changes the price', async () => {
  const entered = gate(), finish = gate();
  let queries = 0, current = product();
  const fake = createFakeChannel3(async (url) => {
    if (url.includes('/products/')) return current;
    if (++queries === 2) { const snapshot = current; entered.release(); await finish.promise; return fakeSearchResponse([snapshot]); }
    return fakeSearchResponse([current]);
  });
  const merchant = createMerchant({ apiKey: KEY, fetch: fake.fetch });
  const first = await merchant.search({ query: 'family tent' });
  const pending = merchant.search({ query: 'four person tent' });
  try {
    await entered.promise;
    current = product(249);
    const checked = await merchant.refresh(merchant.draft(first.results[0].draftId));
    finish.release();
    await assert.rejects(pending, (error) => error.code === 'merchant_draft_expired');
    assert.equal(merchant.draft(checked.results[0].draftId).priceCents, 24900);
    const repeated = await merchant.search({ query: 'four person tent' });
    assert.equal(repeated.results[0].priceCents, 24900);
    assert.equal(repeated.cached, undefined, 'the slow obsolete response was never cached');
    assert.equal(fake.calls.length, 4);
  } finally { finish.release(); await pending.catch(() => {}); }
});

test('a slow older refresh cannot expire a newer search result or restore a cheaper draft', async () => {
  const entered = gate(), finish = gate();
  let current = product();
  const fake = createFakeChannel3(async (url) => {
    const snapshot = current;
    if (url.includes('/products/')) { entered.release(); await finish.promise; return snapshot; }
    return fakeSearchResponse([snapshot]);
  });
  const merchant = createMerchant({ apiKey: KEY, fetch: fake.fetch });
  const first = await merchant.search({ query: 'family tent' });
  const pending = merchant.refresh(merchant.draft(first.results[0].draftId));
  try {
    await entered.promise;
    current = product(249);
    const newer = await merchant.search({ query: 'four person tent' });
    finish.release();
    await assert.rejects(pending, (error) => error.code === 'merchant_draft_expired');
    assert.equal(merchant.draft(newer.results[0].draftId).priceCents, 24900);
    assert.equal((await merchant.search({ query: 'four person tent' })).cached, true);
    assert.equal(fake.calls.length, 3);
  } finally { finish.release(); await pending.catch(() => {}); }
});

test('a late response with equal offer facts remains usable and identical refreshes still share one call', async () => {
  const entered = gate(), finish = gate();
  const fake = createFakeChannel3(async (url) => {
    if (url.includes('/products/')) { entered.release(); await finish.promise; return product(); }
    return fakeSearchResponse([product()]);
  });
  const merchant = createMerchant({ apiKey: KEY, fetch: fake.fetch });
  const first = await merchant.search({ query: 'family tent' });
  const reference = merchant.draft(first.results[0].draftId);
  const pending = Promise.all([merchant.refresh(reference), merchant.refresh({ ...reference, priceCents: 21000 })]);
  try {
    await entered.promise;
    const later = await merchant.search({ query: 'four person tent' });
    finish.release();
    const answers = await pending;
    assert.deepEqual(answers.map((r) => r.results[0].previousPriceCents), [18950, 21000]);
    for (const row of [first.results[0], later.results[0], ...answers.map((r) => r.results[0])]) assert.equal(merchant.draft(row.draftId).priceCents, 18950);
    assert.equal(fake.calls.length, 3);
  } finally { finish.release(); await pending.catch(() => {}); }
});

// Channel3 hydrates OptionValue.available on detail, independently of the listing's availability.
const selectedTent = (value) => product(189.5, 'InStock', { variants: {
  selected: [{ name: 'Size', label: 'Large' }],
  options: [{ name: 'Size', values: [
    { label: 'Large', ...value },
    { label: 'Small', exists: false, available: 'OutOfStock' },
  ] }],
} });

for (const [description, value] of [
  ['out of stock', { exists: true, available: 'OutOfStock' }],
  ['no longer available', { exists: false, available: null }],
]) test(`a selected configuration that is ${description} cannot save a goal despite an in-stock offer`, async () => {
  let current = selectedTent({ exists: true, available: null });
  const s = await serverFor((url) => url.includes('/products/') ? current : fakeSearchResponse([current]));
  try {
    const before = (await s.call('GET', '/api/state')).json;
    const found = (await s.call('POST', '/api/merchant/search', { query: 'large family tent' })).json;
    const original = found.results[0];
    assert.equal(original.usable, true, 'search stock is unknown per option; the listing can still be reviewed');
    current = selectedTent(value);
    const fresh = await s.call('POST', '/api/merchant/refresh', { goalId: found.goalId, referenceId: original.referenceId });
    assert.equal(fresh.status, 200);
    const checked = fresh.json.results[0];
    assert.equal(checked.usable, false, 'listing stock cannot override an explicitly unavailable selected configuration');
    assert.equal(checked.draftId, null);
    assert.match(checked.unusableReason, /selected size or colour/i);
    assert.equal(checked.availability, value.available === 'OutOfStock' ? 'OutOfStock' : null);
    const payload = { goalId: found.goalId, expectedGoalRevision: found.goalRevision,
      goal: goalBody(before, { name: 'Large family tent', targetCents: 18950 }) };
    assert.equal((await s.call('POST', '/api/merchant/goal', { ...payload, draftId: original.draftId })).status, 410);
    const bypass = await s.call('POST', '/api/merchant/goal', { ...payload, draftId: checked.referenceId });
    assert.equal(bypass.status, 400, 'the unusable reference cannot bypass the disabled goal action');
    assert.equal(bypass.json.error.code, 'merchant_price_unusable');
    assert.deepEqual((await s.call('GET', '/api/state')).json, before, 'no goal, plan, credit, deed or saved item changes');
    assert.equal(s.fake.calls.length, 2, 'only the explicit search and detail lookup ran');

    current = selectedTent({ exists: true, available: 'InStock' });
    const restored = await s.call('POST', '/api/merchant/refresh', { goalId: found.goalId, referenceId: checked.referenceId });
    assert.equal(restored.status, 200);
    assert.equal(restored.json.results[0].usable, true);
    const saved = await s.call('POST', '/api/merchant/goal', { ...payload, draftId: restored.json.results[0].draftId });
    assert.equal(saved.status, 200, 'a separately reviewed, available configuration can be explicitly saved');
    assert.deepEqual(saved.json.state.goalItem.selection, [{ name: 'Size', label: 'Large' }]);
    assert.equal(saved.json.state.progress.progressCents, before.progress.progressCents);
    assert.deepEqual(saved.json.state.contributions, before.contributions);
    assert.equal(s.fake.calls.length, 3);
  } finally { await s.close(); }
});

test('unselected unavailable values and unknown option stock do not block an available selected configuration', () => {
  for (const value of [{ exists: true, available: 'InStock' }, { exists: true, available: null }, { exists: true }]) {
    const raw = selectedTent(value);
    const [shown] = normalizeSearch(fakeSearchResponse([raw]));
    const refreshed = normalizeProduct(raw, shown);
    assert.equal(shown.usable, true);
    assert.equal(refreshed.usable, true);
    assert.equal(refreshed.availability, 'InStock');
  }
  for (const variants of [null, {}, { options: null, selected: [] }]) {
    assert.equal(normalizeSearch(fakeSearchResponse([product(189.5, 'InStock', { variants })]))[0].usable, true);
  }
  const out = selectedTent({ exists: true, available: 'InStock' });
  out.offers[0].availability = 'OutOfStock';
  assert.equal(normalizeSearch(fakeSearchResponse([out]))[0].usable, false, 'variant stock cannot revive an unavailable retailer offer');
});
