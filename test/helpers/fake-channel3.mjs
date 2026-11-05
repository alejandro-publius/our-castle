// Fake Channel3 transport for tests. Responses follow the documented /v1/search schema
// (https://channel3.ai/docs/openapi/openapi.json, SearchResponse/Product/ProductOffer/Price). Nothing here is a real
// Channel3 answer; product ids, prices and links are invented for the tests and labelled as such.

export const FAKE_IMAGE = 'https://cdn.trychannel3.com/fake-test-image-0001';

export function fakeProduct(overrides = {}) {
  return {
    id: 'fakeTent01',
    title: 'Test fixture: Four-person dome tent',
    description: 'Invented for tests.',
    brands: [{ id: 'b1', name: 'Fixture Outdoors' }],
    images: [{ url: 'https://images.example-retailer.test/tent.jpg', cleaned_url: FAKE_IMAGE, is_main_image: true, alt_text: 'Green dome tent' }],
    offers: [
      { url: 'https://buy.trychannel3.com/fake/tent-a', domain: 'www.example-outfitter.com', price: { price: 189.5, compare_at_price: null, currency: 'USD' }, availability: 'InStock', condition: 'new', max_commission_rate: 0.05 },
      { url: 'https://buy.trychannel3.com/fake/tent-b', domain: 'example-camping.com', price: { price: 149.99, currency: 'USD' }, availability: 'OutOfStock', condition: 'new' },
    ],
    ...overrides,
  };
}

export function fakeSearchResponse(products = [fakeProduct()]) {
  return { products, next_page_token: null };
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * A fetch replacement that records every call. `respond` gets (url, init, call number) and returns a Response,
 * a plain object (sent as JSON 200), or throws.
 */
export function createFakeChannel3(respond = () => fakeSearchResponse()) {
  const calls = [];
  async function fetch(url, init = {}) {
    calls.push({ url: String(url), method: init.method, headers: { ...init.headers }, body: init.body ? JSON.parse(init.body) : null, redirect: init.redirect });
    const out = await respond(String(url), init, calls.length);
    return out instanceof Response ? out : json(200, out);
  }
  return { fetch, calls, json };
}

/** A fetch that never answers until aborted, like a provider that hangs. */
export function hangingFetch() {
  const calls = [];
  return {
    calls,
    fetch: (url, init) => new Promise((_, reject) => {
      calls.push(String(url));
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  };
}
