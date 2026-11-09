// Market Town merchant: a small, server-only adapter for Channel3 product search.
// Contract checked against Channel3's official OpenAPI document (https://channel3.ai/docs/openapi/openapi.json) and
// guides on 2026-11-04: POST https://api.trychannel3.com/v1/search with an `x-api-key` header. Request fields used:
// `query`, `limit`, `filters.price.max_price` (dollars, offer-level) and `config.{country,currency,language}`.
// Response used: `products[].{id,title,brands,images,offers[].{url,domain,price.{price,currency},availability,condition}}`.
//
// Only search words/budget, public product/retailer/variant references and locale leave this server: never household names,
// members, ledger, bills, other credentials or a user id. Searching is discovery only; nothing here buys, credits
// money, changes a goal or unlocks an area.
//
// Family fit (checked against Channel3's published references at github.com/channel3-ai/skills, commit db55b30, files
// skills/channel3-api/references/api-reference.md, variants.md and skills/product-discovery/SKILL.md):
// - GET /v1/categories/search?query=&limit= returns `categories[]` of `{ slug, title, path: [{ slug, title }] }`;
// - GET /v1/categories/{slug} returns a Category with `attributes[]` of `{ slug, name, values: string[] }`. Values are
//   empty when there is no enumerated set. Color is filtered by image palette, never by attribute.
// - POST /v1/search with `filters.category_ids` (descendants included), `filters.attributes` (OR within a key, AND across
//   keys) and `filters.price.max_price`;
// - products carry `category` (with its root-to-self path) and `structured_attributes`.
// Unknown slugs are silently dropped by Channel3, and a provider may ignore filters. Every item is therefore judged
// here (src/core/family-fit.js), and no filter is relaxed or retried to fill a list. Only the family's own words, public
// taxonomy values, a price ceiling and the locale are sent: never offers, members, dates, progress or the one-off amount.

import { randomBytes } from 'node:crypto';
import { DomainError } from '../household.mjs';
import { MAX_MUST_HAVES, bySuitableOrder, evaluateFit } from '../../src/core/family-fit.js';

export const CHANNEL3_SEARCH_URL = 'https://api.trychannel3.com/v1/search';
const CHANNEL3_BASE = 'https://api.trychannel3.com/v1';
export const MERCHANT_CURRENCY = 'USD'; // The household goal is kept in USD, so searches ask Channel3 for US/USD offers.
export const MAX_RESULTS = 3;
export const CATEGORY_RESULTS = 5; // kinds of item offered for one description
export const FIT_INSPECT_LIMIT = 12; // products inspected from one search page in a family-fit search
export const FIT_MAX_RESULTS = 3; // suitable items shown at most
const MAX_ATTRIBUTES = 16; // must-have choices shown for one kind of item
const MAX_ATTRIBUTE_VALUES = 40;
export const QUERY_LIMITS = Object.freeze({ min: 2, max: 80 });
export const BUDGET_LIMITS = Object.freeze({ minCents: 100, maxCents: 10_000_000 }); // Same bounds as a goal amount.
const DEFAULTS = Object.freeze({
  timeoutMs: 8000,
  cacheTtlMs: 2 * 60_000, // Short: prices and availability change (Channel3 caching guidance).
  draftTtlMs: 30 * 60_000, // How long a shown result can still be saved as a goal before it must be searched again.
  maxSearchesPerMinute: 6,
  maxCacheEntries: 20,
  maxDrafts: 60,
});
const IMAGE_HOST = /(^|\.)trychannel3\.com$/; // Matches the page's img-src allowance; other image hosts are not shown.
const DOMAIN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const PRODUCT_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;
const AVAILABILITY = new Set(['InStock', 'OutOfStock']);
const CATEGORY_SLUG = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const ATTRIBUTE_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const fail = (status, code, message) => new DomainError(status, code, message);

/** One line of plain text: no control characters, collapsed spaces, bounded length. */
export function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Validate what the family asked for. Words only: a link is refused so no remote address is ever fetched. */
export function validateSearch({ query, budgetCents } = {}) {
  const text = cleanText(query, 1000);
  if (text.length < QUERY_LIMITS.min) throw fail(400, 'invalid_query', 'Describe what you are looking for in a few words.');
  if (text.length > QUERY_LIMITS.max) throw fail(400, 'invalid_query', `Keep the search under ${QUERY_LIMITS.max} characters.`);
  if (/(?:https?:\/\/|www\.)\S/i.test(text)) throw fail(400, 'invalid_query', 'Describe the item in words rather than pasting a link.');
  let budget = null;
  if (budgetCents !== undefined && budgetCents !== null) {
    if (!Number.isSafeInteger(budgetCents) || budgetCents < BUDGET_LIMITS.minCents || budgetCents > BUDGET_LIMITS.maxCents) {
      throw fail(400, 'invalid_budget', 'A budget must be between $1.00 and $100,000.00, or left empty.');
    }
    budget = budgetCents;
  }
  return { query: text, budgetCents: budget };
}

/**
 * The family-fit request body:
 * - the family's words;
 * - the chosen catalog category and must-have values, exactly as the catalog listed them;
 * - the server-derived price ceiling;
 * - the locale.
 * It asks for one page of at most twelve products. Nothing about the family is sent.
 */
export function fitRequestBody({ query, need, ceilingCents }) {
  const filters = {};
  if (need.category) filters.category_ids = [need.category.slug];
  if (need.mustHaves.length) filters.attributes = Object.fromEntries(need.mustHaves.map((m) => [m.key, [...m.accepted]]));
  filters.price = { max_price: ceilingCents / 100 };
  return { query, limit: FIT_INSPECT_LIMIT, filters, config: { country: 'US', currency: MERCHANT_CURRENCY, language: 'en' } };
}

/** The exact Channel3 request body: the family's words, an optional ceiling and the goal currency. Nothing else. */
export function searchRequestBody({ query, budgetCents }) {
  const body = { query, limit: MAX_RESULTS, config: { country: 'US', currency: MERCHANT_CURRENCY, language: 'en' } };
  if (budgetCents !== null && budgetCents !== undefined) body.filters = { price: { max_price: budgetCents / 100 } };
  return body;
}

function safeHttpsUrl(value, { imageOnly = false } = {}) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return null;
  if (imageOnly && !IMAGE_HOST.test(url.hostname)) return null;
  return url.href;
}

function toCents(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function readOffer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const url = safeHttpsUrl(raw.url);
  const domain = typeof raw.domain === 'string' ? raw.domain.trim().toLowerCase().replace(/^www\./, '') : '';
  if (!url || !DOMAIN.test(domain)) return null;
  const price = raw.price && typeof raw.price === 'object' ? raw.price : null;
  const cents = toCents(price?.price);
  const currency = typeof price?.currency === 'string' && CURRENCY_CODE.test(price.currency.trim().toUpperCase()) ? price.currency.trim().toUpperCase() : null;
  return {
    url,
    merchant: domain,
    priceCents: cents !== null && currency ? cents : null,
    currency: cents !== null && currency ? currency : null,
    availability: AVAILABILITY.has(raw.availability) ? raw.availability : null,
    condition: raw.condition === 'used' ? 'used' : raw.condition === 'new' ? 'new' : null,
  };
}

// Prefer an offer the goal can use: in USD, within the budget, in stock, then the lowest price.
function rankOffer(offer, budgetCents) {
  return [
    offer.priceCents === null ? 1 : 0,
    offer.currency === MERCHANT_CURRENCY ? 0 : 1,
    budgetCents !== null && offer.priceCents !== null && offer.priceCents > budgetCents ? 1 : 0,
    offer.availability === 'InStock' ? 0 : 1,
    offer.priceCents ?? Number.MAX_SAFE_INTEGER,
  ];
}
const compare = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

function pickImage(images, title) {
  if (!Array.isArray(images)) return null;
  const ordered = [...images.filter((i) => i?.is_main_image), ...images.filter((i) => i && !i.is_main_image)];
  for (const image of ordered.slice(0, 6)) {
    const url = safeHttpsUrl(image.cleaned_url, { imageOnly: true }) ?? safeHttpsUrl(image.url, { imageOnly: true });
    if (url) return { url, alt: cleanText(image.alt_text, 140) || title };
  }
  return null;
}

/** Why a result can or cannot become the goal amount. */
function usability(offer) {
  if (!offer || offer.priceCents === null) return { usable: false, reason: 'No price was returned for this item.' };
  if (offer.currency !== MERCHANT_CURRENCY) return { usable: false, reason: `Priced in ${offer.currency}; the goal is kept in ${MERCHANT_CURRENCY}.` };
  if (offer.availability === 'OutOfStock') return { usable: false, reason: 'This item is out of stock.' };
  if (offer.priceCents < BUDGET_LIMITS.minCents || offer.priceCents > BUDGET_LIMITS.maxCents) return { usable: false, reason: 'This price is outside the goal range ($1.00 to $100,000.00).' };
  return { usable: true, reason: null };
}

// Listing stock and configuration stock are separate Channel3 facts. Detail hydrates `available`; search may leave it
// unknown. Only the effective selection matters, so another size being absent/out of stock must not block this one.
function blockedSelection(variants) {
  const options = Array.isArray(variants?.options) ? variants.options : [];
  for (const { name, label } of readSelection(variants?.selected)) {
    const option = options.find((o) => cleanText(o?.name, 60) === name);
    const value = Array.isArray(option?.values) ? option.values.find((v) => cleanText(v?.label, 100) === label) : null;
    if (value?.exists === false) return { availability: null, reason: 'The selected size or colour is no longer available. Choose another item.' };
    if (value?.available === 'OutOfStock') return { availability: 'OutOfStock', reason: 'The selected size or colour is out of stock.' };
  }
  return null;
}

/**
 * Turn a Channel3 search response into at most three display rows. Anything malformed is dropped rather than guessed;
 * a missing price stays missing. Throws `merchant_malformed` when the body is not a search response at all.
 */
export function normalizeSearch(json, { budgetCents = null, max = MAX_RESULTS, withFacts = false } = {}) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.products)) {
    throw fail(502, 'merchant_malformed', 'Channel3 sent a response this app could not read. Nothing was saved.');
  }
  const results = [];
  for (const product of json.products.slice(0, 30)) {
    if (results.length >= max) break;
    if (!product || typeof product !== 'object') continue;
    const productId = typeof product.id === 'string' && PRODUCT_ID.test(product.id) ? product.id : null;
    const title = cleanText(product.title, 90);
    if (!productId || title.length < 2) continue;
    if (results.some((r) => r.productId === productId)) continue;
    const offers = Array.isArray(product.offers) ? product.offers.slice(0, 50).map(readOffer).filter(Boolean) : [];
    const offer = offers.length ? [...offers].sort((a, b) => compare(rankOffer(a, budgetCents), rankOffer(b, budgetCents)))[0] : null;
    const brand = Array.isArray(product.brands) ? cleanText(product.brands.find((b) => typeof b?.name === 'string')?.name, 60) : '';
    const { usable, reason } = usability(offer);
    const variantBlock = blockedSelection(product.variants);
    results.push({
      productId,
      title,
      brand: brand || null,
      image: pickImage(product.images, title),
      merchant: offer?.merchant ?? null,
      url: offer?.url ?? null,
      priceCents: offer?.priceCents ?? null,
      currency: offer?.currency ?? null,
      availability: variantBlock ? variantBlock.availability : offer?.availability ?? null,
      condition: offer?.condition ?? null,
      selection: readSelection(product.variants?.selected),
      otherOffers: Math.max(0, offers.length - 1),
      overBudget: Boolean(budgetCents !== null && offer?.priceCents !== null && offer?.currency === MERCHANT_CURRENCY && offer.priceCents > budgetCents),
      usable: usable && !variantBlock,
      unusableReason: reason ?? variantBlock?.reason ?? null,
      // The catalog's own category and structured facts, kept on this server to judge a family's must-haves.
      ...(withFacts ? { catalog: readCatalogFacts(product) } : {}),
    });
  }
  return results;
}

// A category summary as the catalog sent it: a safe slug, a title and its root-to-self path. Anything else is dropped.
function readCategory(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const slug = typeof raw.slug === 'string' && CATEGORY_SLUG.test(raw.slug) ? raw.slug : null;
  const title = cleanText(raw.title, 80);
  if (!slug || !title) return null;
  const path = (Array.isArray(raw.path) ? raw.path.slice(0, 8) : []).flatMap((p) => {
    const ref = typeof p?.slug === 'string' && CATEGORY_SLUG.test(p.slug) ? p.slug : null, name = cleanText(p?.title, 80);
    return ref && name ? [{ slug: ref, title: name }] : [];
  });
  return { slug, title, path };
}

// Structured facts for must-have checks: bounded plain values under safe keys, color excluded (the catalog's contract).
function readCatalogFacts(product) {
  const category = readCategory(product.category);
  const attributes = {};
  const raw = product.structured_attributes;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, values] of Object.entries(raw).slice(0, 40)) {
      if (!ATTRIBUTE_KEY.test(key) || key === 'color' || !Array.isArray(values)) continue;
      const clean = [...new Set(values.slice(0, 20).map((v) => cleanText(v, 60)).filter(Boolean))].slice(0, 10);
      if (clean.length) attributes[key] = clean;
      if (Object.keys(attributes).length >= 24) break;
    }
  }
  return { category: category ? { slug: category.slug, title: category.title, path: category.path.map((p) => p.slug) } : null, attributes };
}

/** Category search results: at most five safe summaries in the catalog's order, each with its readable path. */
export function normalizeCategories(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.categories)) {
    throw fail(502, 'merchant_malformed', 'Channel3 sent a category list this app could not read. Nothing was saved.');
  }
  const categories = [];
  for (const raw of json.categories.slice(0, 20)) {
    if (categories.length >= CATEGORY_RESULTS) break;
    const c = readCategory(raw);
    if (c && !categories.some((x) => x.slug === c.slug)) categories.push(c);
  }
  return categories;
}

/**
 * One category's must-have choices: its enumerated attributes other than color, each with the catalog's own allowed
 * values. An attribute without listed values cannot be chosen between and is left out.
 */
export function normalizeCategory(json, slug) {
  const summary = readCategory(json);
  if (!summary || summary.slug !== slug) throw fail(502, 'merchant_malformed', 'Channel3 returned a different category. Nothing was changed.');
  const attributes = [];
  for (const a of (Array.isArray(json.attributes) ? json.attributes.slice(0, 60) : [])) {
    if (attributes.length >= MAX_ATTRIBUTES) break;
    const key = typeof a?.slug === 'string' && ATTRIBUTE_KEY.test(a.slug) ? a.slug : null;
    const name = cleanText(a?.name, 60);
    if (!key || !name || key === 'color' || attributes.some((x) => x.key === key)) continue;
    const values = [...new Set((Array.isArray(a.values) ? a.values.slice(0, 200) : []).map((v) => cleanText(v, 60)).filter(Boolean))].slice(0, MAX_ATTRIBUTE_VALUES);
    if (values.length) attributes.push({ key, name, values });
  }
  return { slug, title: summary.title, path: summary.path, attributes };
}

const publicCategory = (c) => ({ slug: c.slug, title: c.title, path: c.path.map((p) => p.title) });

// Persist only the selected labels, never provider HTML or an arbitrary lookup URL. A changed/relaxed variant cannot
// silently stand in for the one the family selected. Older saved items have no selection and require fresh review.
function readSelection(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((v) => {
    const name = cleanText(v?.name, 60), label = cleanText(v?.label, 100);
    return name && label ? [{ name, label }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// Public offer identity, never a family identifier. Another retailer/condition/variant remains a separate choice.
const offerKey = (item) => JSON.stringify([item.productId, item.merchant, item.condition ?? null, readSelection(item.selection)]);
const offerFacts = (item) => item === null ? null : JSON.stringify([
  item.merchant, item.priceCents, item.currency, item.availability, item.condition ?? null, readSelection(item.selection), item.usable,
]);
const expiredDraft = () => fail(410, 'merchant_draft_expired', 'That merchant result has expired. Search again for a fresh price before saving.');

export function normalizeProduct(json, reference) {
  if (json?.id !== reference.productId) throw fail(502, 'merchant_malformed', 'Channel3 returned a different item. Nothing was changed.');
  const offers = Array.isArray(json.offers) ? json.offers.filter((o) => {
    const offer = readOffer(o);
    return offer?.merchant === reference.merchant && (!reference.condition || offer.condition === reference.condition);
  }) : [];
  const row = normalizeSearch({ products: [{ ...json, offers }] }, { withFacts: true })[0];
  if (!row) throw fail(502, 'merchant_malformed', 'Channel3 sent an item this app could not read.');
  const wanted = readSelection(reference.selection);
  const changed = wanted.some((v) => !row.selection.some((r) => r.name === v.name && r.label === v.label));
  if (changed) Object.assign(row, { usable: false, url: null, unusableReason: 'The selected size or colour is no longer available. Choose another item.' });
  return { ...row, refreshed: true, previousPriceCents: reference.priceCents, selectionChanged: changed };
}

async function providerError(response) {
  let detail = '';
  try { const body = await response.json(); detail = typeof body?.detail === 'string' ? body.detail : ''; } catch { /* not JSON */ }
  const s = response.status;
  if (s === 401 || s === 403) return fail(502, 'merchant_auth', 'Channel3 did not accept this app’s search key, so no search was made.');
  if (s === 402) return fail(502, 'merchant_credits', 'Channel3 reports no search credits left for this key. No search was made.');
  if (s === 429) return fail(503, 'merchant_rate_limited', 'Channel3 is limiting searches right now. Wait a few seconds, then search again.');
  if (s === 404) return fail(404, 'merchant_item_missing', 'This item is no longer in the catalog. Search for another item.');
  if (s === 400 || s === 422) return fail(502, 'merchant_rejected', `Channel3 could not run that search${detail ? `: ${cleanText(detail, 160)}` : '.'}`);
  return fail(502, 'merchant_unavailable', `Channel3 did not answer properly (HTTP ${s}). Try again later.`);
}

/**
 * The search transport. `fetch` is injectable so tests use fake responses; the key never leaves this function except
 * as Channel3's documented header to Channel3's documented host.
 */
export function createChannel3Client({ apiKey, fetch = globalThis.fetch, timeoutMs = DEFAULTS.timeoutMs }) {
  if (!apiKey) throw new Error('createChannel3Client needs an API key');
  async function request(url, body) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(url, {
          method: body ? 'POST' : 'GET',
          headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: controller.signal,
          redirect: 'error',
        });
      } catch {
        clearTimeout(timer);
        if (controller.signal.aborted) throw fail(504, 'merchant_timeout', `Channel3 took longer than ${Math.round(timeoutMs / 1000)} seconds to answer. Nothing was saved.`);
        throw fail(502, 'merchant_unreachable', 'Could not reach Channel3 from this server. Check the connection and try again.');
      }
      try {
        if (!response.ok) throw await providerError(response);
        try { return await response.json(); } catch {
          if (controller.signal.aborted) throw fail(504, 'merchant_timeout', `Channel3 took longer than ${Math.round(timeoutMs / 1000)} seconds to answer. Nothing was saved.`);
          throw fail(502, 'merchant_malformed', 'Channel3 sent a response this app could not read. Nothing was saved.');
        }
      } finally { clearTimeout(timer); }
  }
  return {
    search: (input) => request(CHANNEL3_SEARCH_URL, searchRequestBody(input)),
    fitSearch: (body) => request(CHANNEL3_SEARCH_URL, body),
    categories: (query) => {
      const url = new URL(`${CHANNEL3_BASE}/categories/search`);
      url.searchParams.set('query', query);
      url.searchParams.set('limit', String(CATEGORY_RESULTS));
      return request(url.href);
    },
    category: (slug) => {
      if (!CATEGORY_SLUG.test(slug)) throw fail(400, 'invalid_category', 'Choose one of the kinds of item shown.');
      return request(`${CHANNEL3_BASE}/categories/${encodeURIComponent(slug)}`);
    },
    similar: (productId, budgetCents) => request(`${CHANNEL3_BASE}/similar`, {
      product_id: productId, limit: MAX_RESULTS,
      filters: { price: { max_price: budgetCents / 100 } },
      config: { country: 'US', currency: MERCHANT_CURRENCY, language: 'en' },
    }),
    product: (reference) => {
      if (!PRODUCT_ID.test(reference.productId)) throw fail(400, 'invalid_product', 'Choose an item returned by the merchant.');
      const url = new URL(`${CHANNEL3_BASE}/products/${encodeURIComponent(reference.productId)}`);
      for (const [k, v] of Object.entries({ country: 'US', currency: MERCHANT_CURRENCY, language: 'en', website_ids: reference.merchant })) if (v) url.searchParams.set(k, v);
      for (const { name, label } of readSelection(reference.selection)) url.searchParams.set(`option_${name}`, label);
      return request(url.href);
    },
  };
}

/**
 * The merchant service the routes use: connection state, bounded/cached search and short-lived drafts. A draft is the
 * server's own copy of a result it showed, so a saved goal's item provenance can only come from a real Channel3 answer.
 */
export function createMerchant({ apiKey = null, fetch, clock, ...options } = {}) {
  const opts = { ...DEFAULTS, ...options };
  const now = () => (clock ? Date.parse(clock.iso()) : Date.now());
  const client = apiKey ? createChannel3Client({ apiKey, fetch, timeoutMs: opts.timeoutMs }) : null;
  const cache = new Map(); // key -> { at, value }
  const inflight = new Map(); // key -> Promise
  const drafts = new Map(); // draftId -> { expiresAt, item, offerKey, facts }
  const observations = new Map(); // offerKey -> { version, facts, at }; bounded catalog knowledge, not search history
  const shownCategories = new Map(); // slug -> at: kinds of item this server was given by the catalog (public taxonomy)
  const categoryDetails = new Map(); // slug -> { at, detail }: their must-have lists, the only ones a fit search accepts
  let readVersion = 0; // Start order, so an older slow response cannot revive an offer a newer lookup contradicted.
  let recent = []; // timestamps of provider calls in the last minute

  const connected = Boolean(client);
  function status() {
    return connected
      ? { mode: 'live', provider: 'Channel3', label: 'Channel3 product search' }
      : { mode: 'off', provider: 'Channel3', label: 'Channel3 not connected', setup: 'Add CHANNEL3_API_KEY to the server’s local .env, then restart the server.' };
  }

  function prune(at) {
    for (const [key, entry] of cache) if (at - entry.at > opts.cacheTtlMs) cache.delete(key);
    for (const [id, entry] of drafts) if (at > entry.expiresAt) drafts.delete(id);
    for (const [key, entry] of observations) if (at - entry.at > opts.draftTtlMs) observations.delete(key);
    while (cache.size > opts.maxCacheEntries) cache.delete(cache.keys().next().value);
    while (drafts.size > opts.maxDrafts) drafts.delete(drafts.keys().next().value);
    while (observations.size > opts.maxDrafts * 2) observations.delete(observations.keys().next().value);
    for (const [slug, seen] of shownCategories) if (at - seen > opts.draftTtlMs) shownCategories.delete(slug);
    for (const [slug, entry] of categoryDetails) if (at - entry.at > opts.draftTtlMs) categoryDetails.delete(slug);
    while (shownCategories.size > opts.maxDrafts) shownCategories.delete(shownCategories.keys().next().value);
    while (categoryDetails.size > opts.maxCacheEntries) categoryDetails.delete(categoryDetails.keys().next().value);
    recent = recent.filter((t) => at - t < 60_000);
  }

  function observe(reference, row, version) {
    const key = offerKey(reference), facts = offerFacts(row);
    const latest = observations.get(key);
    if (latest && latest.version > version) {
      if (latest.facts !== facts) throw expiredDraft();
      return; // Same offer facts; retain the later read's ordering.
    }
    observations.delete(key);
    observations.set(key, { version, facts, at: now() });
    // A draft is not a reserved price. Once the catalog contradicts it, the family must review another result.
    // Keep equal offers usable: a new tracking URL or a title/image change alone does not invalidate consent.
    for (const [id, entry] of drafts) if (entry.offerKey === key && entry.facts !== facts) drafts.delete(id);
    // Cached results carry the same short-lived references. Never return a list whose references just expired.
    for (const [query, entry] of cache) if (entry.value.results.some((r) => !drafts.has(r.referenceId))) cache.delete(query);
    prune(now());
  }

  function remember(row, checkedAt, query = '') {
    // Every shown product has a bounded reference for explicit refresh/similar; only usable products have goal drafts.
    const referenceId = `c3d_${randomBytes(12).toString('hex')}`;
    drafts.set(referenceId, { expiresAt: now() + opts.draftTtlMs, item: { ...row, checkedAt, query }, offerKey: offerKey(row), facts: offerFacts(row) });
    prune(now());
    const { catalog, ...shown } = row; // the catalog's raw facts stay here; a family-fit result shows its judgement instead
    return { ...shown, draftId: row.usable ? referenceId : null, referenceId, checkedAt };
  }

  async function bounded(key, run) {
    if (!client) throw fail(503, 'merchant_not_connected', 'Product search is not connected.');
    prune(now());
    if (inflight.has(key)) return inflight.get(key);
    if (recent.length >= opts.maxSearchesPerMinute) throw fail(429, 'merchant_busy', 'That is a lot of searches in one minute. Wait a moment, then try again.');
    recent.push(now());
    const pending = run();
    inflight.set(key, pending);
    try { return await pending; } finally { inflight.delete(key); }
  }

  async function refresh(reference) {
    const key = `product:${reference.productId}:${reference.merchant}:${reference.condition}:${JSON.stringify(readSelection(reference.selection))}`;
    // Shared between identical concurrent look-ups: only the public catalog call, reading it and recording the observation.
    const page = await bounded(key, async () => {
      const version = ++readVersion;
      let json;
      try { json = await client.product(reference); } catch (error) {
        // A missing catalog item is evidence; a timeout, transport failure or malformed response is not.
        if (error.code === 'merchant_item_missing') observe(reference, null, version);
        throw error;
      }
      const row = normalizeProduct(json, reference);
      observe(reference, row, version);
      if (!row.selectionChanged && row.merchant && offerKey(row) !== offerKey(reference)) observe(row, row, version);
      return { row, checkedAt: new Date(now()).toISOString() };
    });
    // Each caller's own: a family-fit result is judged again against that caller's need and ceiling, and it keeps that
    // caller's context, in a draft of its own. If it no longer meets a must-have, it says so; it never keeps an earlier
    // "suitable". A saved item and a newer search can share the look-up but have different comparison prices.
    const row = { ...page.row };
    if (reference.fit) row.fit = { ...evaluateFit(row, reference.fit.needSpec, { ceilingCents: reference.fit.context.ceilingCents }), needSpec: reference.fit.needSpec, context: reference.fit.context };
    return { status: 'ok', provider: 'Channel3', checkedAt: page.checkedAt, results: [{ ...remember(row, page.checkedAt, reference.query), previousPriceCents: reference.priceCents }] };
  }

  async function alternatives(reference, budgetCents) {
    const budget = validateSearch({ query: 'similar item', budgetCents }).budgetCents;
    if (reference.currency !== MERCHANT_CURRENCY || !Number.isSafeInteger(reference.priceCents)) throw fail(400, 'merchant_price_unusable', 'Choose a priced USD item to compare.');
    const ceiling = Math.min(budget ?? reference.priceCents, reference.priceCents - 1);
    if (ceiling < BUDGET_LIMITS.minCents) return { status: 'ok', provider: 'Channel3', results: [], budgetCents: ceiling, checkedAt: new Date(now()).toISOString() };
    return bounded(`similar:${reference.productId}:${ceiling}`, async () => {
      const version = ++readVersion;
      const json = await client.similar(reference.productId, ceiling);
      // Provider filters are not a guarantee: enforce the budget, stock, currency and source exclusion locally too.
      const rows = normalizeSearch(json, { budgetCents: ceiling, withFacts: true }).filter((r) => r.productId !== reference.productId && r.usable && r.availability === 'InStock' && r.priceCents <= ceiling);
      for (const row of rows) observe(row, row, version);
      const checkedAt = new Date(now()).toISOString();
      return { status: 'ok', provider: 'Channel3', budgetCents: ceiling, checkedAt, results: rows.map((r) => remember(r, checkedAt, reference.query)) };
    });
  }

  async function search(input) {
    const request = validateSearch(input);
    if (!client) throw fail(503, 'merchant_not_connected', 'Product search is not connected, so no search was made.');
    const key = `${request.query.toLowerCase()}|${request.budgetCents ?? ''}`;
    let at = now();
    prune(at);
    const cached = cache.get(key);
    if (cached) return { ...cached.value, cached: true };
    if (inflight.has(key)) return inflight.get(key);
    if (recent.length >= opts.maxSearchesPerMinute) throw fail(429, 'merchant_busy', 'That is a lot of searches in one minute. Wait a moment, then search again.');
    recent.push(at);
    const pending = (async () => {
      const version = ++readVersion;
      const json = await client.search(request);
      const rows = normalizeSearch(json, { budgetCents: request.budgetCents, withFacts: true });
      for (const row of rows) observe(row, row, version);
      at = now();
      const checkedAt = new Date(at).toISOString();
      const results = rows.map((row) => remember(row, checkedAt, request.query));
      const value = { status: 'ok', provider: 'Channel3', checkedAt, query: request.query, budgetCents: request.budgetCents, currency: MERCHANT_CURRENCY, results };
      cache.set(key, { at, value });
      prune(at);
      return value;
    })();
    inflight.set(key, pending);
    try { return await pending; } finally { inflight.delete(key); }
  }

  /** Kinds of item for the family's own words: up to five catalog categories, as explicit choices. */
  async function findCategories(input = {}) {
    const { query } = validateSearch({ query: input.query });
    if (!client) throw fail(503, 'merchant_not_connected', 'Product search is not connected, so no catalog categories can be looked up.');
    return bounded(`categories:${query.toLowerCase()}`, async () => {
      const categories = normalizeCategories(await client.categories(query));
      const at = now();
      for (const c of categories) { shownCategories.delete(c.slug); shownCategories.set(c.slug, at); }
      prune(at);
      return { status: 'ok', provider: 'Channel3', query, categories: categories.map(publicCategory) };
    });
  }

  /** One shown category's must-have choices. Only a category the catalog listed here can be opened. */
  async function category(slug) {
    if (typeof slug !== 'string' || !shownCategories.has(slug)) throw fail(409, 'category_unknown', 'Look up the kind of item again, then choose one of the categories shown.');
    prune(now());
    const cached = categoryDetails.get(slug);
    if (cached) return { status: 'ok', provider: 'Channel3', category: publicDetail(cached.detail), cached: true };
    return bounded(`category:${slug}`, async () => {
      const detail = normalizeCategory(await client.category(slug), slug);
      categoryDetails.delete(slug);
      categoryDetails.set(slug, { at: now(), detail });
      prune(now());
      return { status: 'ok', provider: 'Channel3', category: publicDetail(detail) };
    });
  }
  const publicDetail = (d) => ({ slug: d.slug, title: d.title, path: d.path.map((p) => p.title), attributes: d.attributes.map((a) => ({ ...a, values: [...a.values] })) });

  /**
   * The family's need, built only from a category this server opened and its listed values:
   * { category: { slug, title, path } | null, mustHaves: [{ key, name, accepted, allowed }] }. A key or value the
   * catalog did not list is refused, never guessed. With no category, only the price and date are checked.
   */
  function buildNeed({ category: slug = null, mustHaves = [] } = {}) {
    if (!Array.isArray(mustHaves) || mustHaves.length > MAX_MUST_HAVES) throw fail(400, 'invalid_need', `Choose up to ${MAX_MUST_HAVES} must-haves.`);
    if (slug === null || slug === '') {
      if (mustHaves.length) throw fail(400, 'invalid_need', 'Choose a kind of item before its must-haves.');
      return { category: null, mustHaves: [] };
    }
    prune(now());
    const entry = typeof slug === 'string' ? categoryDetails.get(slug) : null;
    if (!entry) throw fail(409, 'category_needs_check', 'Show the must-haves for this kind of item again before searching.');
    const used = new Set();
    const list = mustHaves.map((m) => {
      const attribute = entry.detail.attributes.find((a) => a.key === m?.key);
      if (!attribute || used.has(attribute.key)) throw fail(400, 'invalid_need', 'Choose must-haves from the list the catalog gives for this kind of item.');
      used.add(attribute.key);
      const values = Array.isArray(m.values) ? m.values : [];
      if (!values.length || values.length > attribute.values.length || values.some((v) => typeof v !== 'string' || !attribute.values.includes(v)) || new Set(values).size !== values.length) {
        throw fail(400, 'invalid_need', `Choose one or more of the listed values for ${attribute.name}.`);
      }
      return { key: attribute.key, name: attribute.name, accepted: attribute.values.filter((v) => values.includes(v)), allowed: [...attribute.values] };
    });
    return { category: { slug, title: entry.detail.title, path: entry.detail.path.map((p) => p.title) }, mustHaves: list };
  }

  /**
   * A family-fit search: one page of at most twelve products. Each is judged here, whatever the provider filtered.
   * Only suitable items become results, at most three, lowest price first. Unsuitable and unknown items are counted with
   * one reason each, never filled in.
   * @param context { ceilingCents, targetDate, reserveCents, on }: the family facts this ceiling came from (kept with drafts)
   */
  async function fitSearch({ query, need, ceilingCents, context }) {
    const request = validateSearch({ query, budgetCents: ceilingCents });
    if (!client) throw fail(503, 'merchant_not_connected', 'Product search is not connected, so no search was made.');
    const body = fitRequestBody({ query: request.query, need, ceilingCents });
    // Shared between identical concurrent searches: only the public catalog page, reading it and recording observations.
    const page = await bounded(`fit:${JSON.stringify(body)}`, async () => {
      const version = ++readVersion;
      const rows = normalizeSearch(await client.fitSearch(body), { budgetCents: ceilingCents, max: FIT_INSPECT_LIMIT, withFacts: true });
      for (const row of rows) observe(row, row, version);
      return { rows, checkedAt: new Date(now()).toISOString() };
    });
    // Each caller's own: the judgement against its need and ceiling, its private planning context, and drafts of its own.
    // One family's context or references therefore never reach another caller of the same search.
    const judged = page.rows.map((row) => ({ row, fit: evaluateFit(row, need, { ceilingCents }) }));
    const suitable = judged.filter((j) => j.fit.status === 'suitable').sort((a, b) => bySuitableOrder(a.row, b.row));
    const shown = suitable.slice(0, FIT_MAX_RESULTS);
    return {
      status: 'ok', provider: 'Channel3', checkedAt: page.checkedAt, query: request.query, inspected: page.rows.length, moreSuitable: suitable.length - shown.length, need,
      results: shown.map(({ row, fit }) => remember({ ...row, fit: { ...fit, needSpec: need, context } }, page.checkedAt, request.query)),
      others: judged.filter((j) => j.fit.status !== 'suitable').map(({ row, fit }) => ({
        productId: row.productId, title: row.title, priceCents: row.priceCents, currency: row.currency, status: fit.status, reason: fit.problems[0],
      })),
    };
  }

  /** The stored result for a draft the server showed, or a clear error once it has expired. Does not consume it. */
  function draft(draftId) {
    prune(now());
    const entry = typeof draftId === 'string' ? drafts.get(draftId) : null;
    if (!entry) throw expiredDraft();
    return entry.item;
  }

  return { connected, status, search, draft, refresh, alternatives, findCategories, category, buildNeed, fitSearch };
}
