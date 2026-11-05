// Market Town merchant: a small, server-only adapter for Channel3 product search.
// Contract checked against Channel3's official OpenAPI document (https://channel3.ai/docs/openapi/openapi.json) and
// guides on 2026-11-04: POST https://api.trychannel3.com/v1/search with an `x-api-key` header. Request fields used:
// `query`, `limit`, `filters.price.max_price` (dollars, offer-level) and `config.{country,currency,language}`.
// Response used: `products[].{id,title,brands,images,offers[].{url,domain,price.{price,currency},availability,condition}}`.
//
// Only the words the family typed, an optional budget and the goal currency leave this server: never household names,
// members, ledger, bills, other credentials or a user id. Searching is discovery only; nothing here buys, credits
// money, changes a goal or unlocks an area.

import { randomBytes } from 'node:crypto';
import { DomainError } from '../household.mjs';

export const CHANNEL3_SEARCH_URL = 'https://api.trychannel3.com/v1/search';
export const MERCHANT_CURRENCY = 'USD'; // The household goal is kept in USD, so searches ask Channel3 for US/USD offers.
export const MAX_RESULTS = 3;
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
  if (offer.priceCents < BUDGET_LIMITS.minCents || offer.priceCents > BUDGET_LIMITS.maxCents) return { usable: false, reason: 'This price is outside the goal range ($1.00 to $100,000.00).' };
  return { usable: true, reason: null };
}

/**
 * Turn a Channel3 search response into at most three display rows. Anything malformed is dropped rather than guessed;
 * a missing price stays missing. Throws `merchant_malformed` when the body is not a search response at all.
 */
export function normalizeSearch(json, { budgetCents = null } = {}) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.products)) {
    throw fail(502, 'merchant_malformed', 'Channel3 sent a response this app could not read. Nothing was saved.');
  }
  const results = [];
  for (const product of json.products.slice(0, 30)) {
    if (results.length >= MAX_RESULTS) break;
    if (!product || typeof product !== 'object') continue;
    const productId = typeof product.id === 'string' && PRODUCT_ID.test(product.id) ? product.id : null;
    const title = cleanText(product.title, 90);
    if (!productId || title.length < 2) continue;
    const offers = Array.isArray(product.offers) ? product.offers.slice(0, 50).map(readOffer).filter(Boolean) : [];
    const offer = offers.length ? [...offers].sort((a, b) => compare(rankOffer(a, budgetCents), rankOffer(b, budgetCents)))[0] : null;
    const brand = Array.isArray(product.brands) ? cleanText(product.brands.find((b) => typeof b?.name === 'string')?.name, 60) : '';
    const { usable, reason } = usability(offer);
    results.push({
      productId,
      title,
      brand: brand || null,
      image: pickImage(product.images, title),
      merchant: offer?.merchant ?? null,
      url: offer?.url ?? null,
      priceCents: offer?.priceCents ?? null,
      currency: offer?.currency ?? null,
      availability: offer?.availability ?? null,
      condition: offer?.condition ?? null,
      otherOffers: Math.max(0, offers.length - 1),
      overBudget: Boolean(budgetCents !== null && offer?.priceCents !== null && offer?.currency === MERCHANT_CURRENCY && offer.priceCents > budgetCents),
      usable,
      unusableReason: reason,
    });
  }
  return results;
}

async function providerError(response) {
  let detail = '';
  try { const body = await response.json(); detail = typeof body?.detail === 'string' ? body.detail : ''; } catch { /* not JSON */ }
  const s = response.status;
  if (s === 401 || s === 403) return fail(502, 'merchant_auth', 'Channel3 did not accept this app’s search key, so no search was made.');
  if (s === 402) return fail(502, 'merchant_credits', 'Channel3 reports no search credits left for this key. No search was made.');
  if (s === 429) return fail(503, 'merchant_rate_limited', 'Channel3 is limiting searches right now. Wait a few seconds, then search again.');
  if (s === 400 || s === 422) return fail(502, 'merchant_rejected', `Channel3 could not run that search${detail ? `: ${cleanText(detail, 160)}` : '.'}`);
  return fail(502, 'merchant_unavailable', `Channel3 did not answer properly (HTTP ${s}). Try again later.`);
}

/**
 * The search transport. `fetch` is injectable so tests use fake responses; the key never leaves this function except
 * as Channel3's documented header to Channel3's documented host.
 */
export function createChannel3Client({ apiKey, fetch = globalThis.fetch, timeoutMs = DEFAULTS.timeoutMs }) {
  if (!apiKey) throw new Error('createChannel3Client needs an API key');
  return {
    async search(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(CHANNEL3_SEARCH_URL, {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(searchRequestBody(input)),
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
  const drafts = new Map(); // draftId -> { expiresAt, item }
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
    while (cache.size > opts.maxCacheEntries) cache.delete(cache.keys().next().value);
    while (drafts.size > opts.maxDrafts) drafts.delete(drafts.keys().next().value);
    recent = recent.filter((t) => at - t < 60_000);
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
      const json = await client.search(request);
      const rows = normalizeSearch(json, { budgetCents: request.budgetCents });
      at = now();
      const checkedAt = new Date(at).toISOString();
      const results = rows.map((row) => {
        const draftId = row.usable ? `c3d_${randomBytes(12).toString('hex')}` : null;
        if (draftId) drafts.set(draftId, { expiresAt: at + opts.draftTtlMs, item: { ...row, checkedAt, query: request.query } });
        return { ...row, draftId, checkedAt };
      });
      const value = { status: 'ok', provider: 'Channel3', checkedAt, query: request.query, budgetCents: request.budgetCents, currency: MERCHANT_CURRENCY, results };
      cache.set(key, { at, value });
      prune(at);
      return value;
    })();
    inflight.set(key, pending);
    try { return await pending; } finally { inflight.delete(key); }
  }

  /** The stored result for a draft the server showed, or a clear error once it has expired. Does not consume it. */
  function draft(draftId) {
    prune(now());
    const entry = typeof draftId === 'string' ? drafts.get(draftId) : null;
    if (!entry) throw fail(410, 'merchant_draft_expired', 'That merchant result has expired. Search again for a fresh price before saving.');
    return entry.item;
  }

  return { connected, status, search, draft };
}
