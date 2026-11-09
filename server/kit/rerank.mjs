// Ordering a few complete kits by a preference the family chose, with Cohere Rerank. Optional and off unless the server
// has its own KIT_COHERE_API_KEY.
// Contract, from Cohere's API reference and changelog read on November 9, 2026 (https://docs.cohere.com/reference/rerank,
// https://docs.cohere.com/changelog/rerank-v5):
// - POST https://api.cohere.com/v2/rerank with `Authorization: Bearer <key>`;
// - body: model, query, documents (strings), top_n, max_tokens_per_doc, relevant_spans { mode, threshold, max_spans };
// - reply: results[] of { index, relevance_score in [0, 1], relevant_spans?: [{ start, end, score }] }, ordered by
//   relevance. Span offsets are Unicode code points into the document, end exclusive.
// - Models: rerank-v5.0-fast ("optimized for low latency and high throughput") and rerank-v5.0-pro.
// What is sent: one fixed preference sentence chosen from a list here (never the family's own words) and up to eight kit
// descriptions made only of public catalog titles, brands and retailer names. Never names, members, offers, the one-off
// amount, dates, prices, the kit list's own text or a photo. What comes back only orders kits that already fit: it cannot
// add, remove or change a kit, a price or a date. A relevance score is not a judgement of quality, truth or confidence,
// and is not shown. One call per explicit request; no retry, no redirect, a hard time limit and a bounded reply.
import { DomainError } from '../household.mjs';

export const COHERE_RERANK_URL = 'https://api.cohere.com/v2/rerank';
export const DEFAULT_RERANK_MODEL = 'rerank-v5.0-fast';
export const RERANK_LIMITS = Object.freeze({ maxDocuments: 8, maxDocumentChars: 600, maxTokensPerDoc: 512, maxResponseBytes: 64 * 1024, timeoutMs: 10_000, spanThreshold: 0.3 });

/** The preferences a family can choose from, each a fixed public sentence. Nothing typed by the family is ever sent. */
export const KIT_PREFERENCES = Object.freeze({
  light: Object.freeze({ label: 'Lighter to carry', query: 'camping gear that is lightweight, compact and easy to carry' }),
  sturdy: Object.freeze({ label: 'Sturdy and long-lasting', query: 'camping gear that is durable, sturdy and long-lasting' }),
  simple: Object.freeze({ label: 'Simple to set up', query: 'camping gear that is simple and quick to set up and use' }),
  warm: Object.freeze({ label: 'Warm in cold weather', query: 'camping gear that is warm and insulated for cold weather' }),
});

const fail = (status, code, message) => new DomainError(status, code, message);
const KEPT = 'The kits shown are unchanged.';
const malformed = () => fail(502, 'kit_rank_malformed', `Cohere sent an answer this app could not check, so it was not used. ${KEPT}`);
const unranked = () => fail(502, 'kit_rank_empty', `Cohere ranked none of these kits, so they were not ordered. ${KEPT}`);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const codePoints = (text) => Array.from(text);

/** The exact request body: a fixed preference sentence and kit descriptions, every result, at most one excerpt each. */
export function rerankRequest({ model, query, documents }) {
  return { model, query, documents, top_n: documents.length, max_tokens_per_doc: RERANK_LIMITS.maxTokensPerDoc,
    relevant_spans: { mode: 'enabled', threshold: RERANK_LIMITS.spanThreshold, max_spans: 1 } };
}

/**
 * The checked order of a Rerank reply for these documents: every index once at most, in range, with a finite score in
 * [0, 1], and spans that are code-point ranges inside the document they belong to. Only the documents Cohere ranked are
 * returned, in its order; one it left out is never reported as ranked, and a reply that ranks none is a failure.
 * Returns [{ index, excerpt: string | null }], never empty.
 */
export function readRanking(json, documents) {
  if (!isObject(json) || !Array.isArray(json.results) || json.results.length > documents.length) throw malformed();
  if (!json.results.length) throw unranked();
  const seen = new Set();
  const ranked = json.results.map((r) => {
    if (!isObject(r) || !Number.isSafeInteger(r.index) || r.index < 0 || r.index >= documents.length || seen.has(r.index)) throw malformed();
    if (typeof r.relevance_score !== 'number' || !Number.isFinite(r.relevance_score) || r.relevance_score < 0 || r.relevance_score > 1) throw malformed();
    seen.add(r.index);
    let excerpt = null;
    if (r.relevant_spans !== undefined) {
      if (!Array.isArray(r.relevant_spans) || r.relevant_spans.length > 1) throw malformed();
      const points = codePoints(documents[r.index]);
      for (const span of r.relevant_spans) {
        if (!isObject(span) || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > points.length
          || typeof span.score !== 'number' || !Number.isFinite(span.score) || span.score < 0 || span.score > 1) throw malformed();
        excerpt = points.slice(span.start, span.end).join('').trim() || null;
      }
    }
    return { index: r.index, excerpt };
  });
  return ranked;
}

function httpError(status) {
  if (status === 401 || status === 403 || status === 498) return fail(502, 'kit_rank_auth', `Cohere did not accept this server’s key, so the kits were not ordered. ${KEPT}`);
  if (status === 429) return fail(503, 'kit_rank_limited', `Cohere is limiting requests right now. Try again in a minute. ${KEPT}`);
  if (status === 400 || status === 404 || status === 422) return fail(502, 'kit_rank_rejected', `Cohere could not order these kits. ${KEPT}`);
  return fail(502, 'kit_rank_unavailable', `Cohere did not answer properly (HTTP ${status}). ${KEPT}`);
}

async function readBounded(response, limit) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > limit) throw malformed();
    return text;
  }
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel().catch(() => {}); throw malformed(); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The reranker. `fetch` is injectable so checks use a fake transport; the key leaves this function only as Cohere's
 * documented Authorization header, to Cohere's fixed host.
 */
export function createKitReranker({ apiKey, model = DEFAULT_RERANK_MODEL, fetch = globalThis.fetch, timeoutMs = RERANK_LIMITS.timeoutMs }) {
  if (!apiKey || !model) throw new Error('createKitReranker needs its own API key and a model');
  return {
    model,
    /** The order of `documents` for one preference key from KIT_PREFERENCES. */
    async rank({ preference, documents }) {
      const chosen = Object.hasOwn(KIT_PREFERENCES, preference) ? KIT_PREFERENCES[preference] : null;
      if (!chosen) throw fail(400, 'invalid_preference', 'Choose one of the preferences listed.');
      if (!Array.isArray(documents) || documents.length < 2 || documents.length > RERANK_LIMITS.maxDocuments
        || documents.some((d) => typeof d !== 'string' || !d || d.length > RERANK_LIMITS.maxDocumentChars)) throw fail(400, 'invalid_rank_request', 'There is nothing to order.');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(COHERE_RERANK_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(rerankRequest({ model, query: chosen.query, documents })),
          signal: controller.signal,
          redirect: 'error',
        });
      } catch {
        clearTimeout(timer);
        if (controller.signal.aborted) throw fail(504, 'kit_rank_timeout', `Cohere took longer than ${Math.round(timeoutMs / 1000)} seconds. ${KEPT}`);
        throw fail(502, 'kit_rank_unreachable', `Could not reach Cohere from this server. ${KEPT}`);
      }
      try {
        if (!response.ok) { await response.body?.cancel?.().catch(() => {}); throw httpError(response.status); }
        let text;
        try { text = await readBounded(response, RERANK_LIMITS.maxResponseBytes); } catch (error) {
          if (controller.signal.aborted) throw fail(504, 'kit_rank_timeout', `Cohere took longer than ${Math.round(timeoutMs / 1000)} seconds. ${KEPT}`);
          if (error instanceof DomainError) throw error;
          throw malformed();
        }
        let json;
        try { json = JSON.parse(text); } catch { throw malformed(); }
        return readRanking(json, documents);
      } finally { clearTimeout(timer); }
    },
  };
}
