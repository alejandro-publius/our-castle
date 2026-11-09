// Ordering kits by a family preference with Cohere Rerank (server/kit/rerank.mjs), over a FAKE transport: what is sent,
// how every reply is checked, and how failures are reported. No request reaches Cohere; the replies are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_KIT_RANK_MODEL, loadConfig } from '../../server/config.mjs';
import { COHERE_RERANK_URL, KIT_PREFERENCES, RERANK_LIMITS, createKitReranker, readRanking, rerankRequest } from '../../server/kit/rerank.mjs';

const DOCS = ['1 × Test fixture: Tent A (fixture-a.test); 2 × Test fixture: Sleeping bag A (fixture-a.test)', '1 × Test fixture: Tent B, ultralight (fixture-b.test); 2 × Test fixture: Sleeping bag A (fixture-a.test)'];
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function fake(reply) {
  const calls = [];
  return { calls, fetch: async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return typeof reply === 'function' ? reply(calls.length) : reply; } };
}

test('one request to the fixed Rerank host: the key as a Bearer header, a fixed preference sentence and public kit text only', async () => {
  const transport = fake(json(200, { results: [{ index: 1, relevance_score: 0.91, relevant_spans: [{ start: 4, end: 37, score: 0.8 }] }, { index: 0, relevance_score: 0.12 }] }));
  const ranker = createKitReranker({ apiKey: 'fake-cohere-key-not-real', fetch: transport.fetch });
  assert.equal(ranker.model, DEFAULT_KIT_RANK_MODEL);
  const order = await ranker.rank({ preference: 'light', documents: DOCS });
  assert.deepEqual(order, [{ index: 1, excerpt: 'Test fixture: Tent B, ultralight' }, { index: 0, excerpt: null }]);
  assert.equal(transport.calls.length, 1);
  const [{ url, init, body }] = transport.calls;
  assert.equal(url, COHERE_RERANK_URL);
  assert.equal(url, 'https://api.cohere.com/v2/rerank');
  assert.deepEqual([init.method, init.redirect, init.headers.Authorization], ['POST', 'error', 'Bearer fake-cohere-key-not-real']);
  assert.deepEqual(body, { model: 'rerank-v5.0-fast', query: KIT_PREFERENCES.light.query, documents: DOCS, top_n: 2, max_tokens_per_doc: RERANK_LIMITS.maxTokensPerDoc,
    relevant_spans: { mode: 'enabled', threshold: 0.3, max_spans: 1 } });
  assert.deepEqual(rerankRequest({ model: 'm', query: 'q', documents: ['a', 'b'] }).top_n, 2);
  await assert.rejects(ranker.rank({ preference: 'whatever the family typed', documents: DOCS }), (e) => e.code === 'invalid_preference');
  await assert.rejects(ranker.rank({ preference: 'light', documents: [DOCS[0]] }), (e) => e.code === 'invalid_rank_request');
  assert.equal(transport.calls.length, 1, 'refused before any call');
});

test('every reply is checked: indices, duplicates, scores and code-point spans; anything else is refused whole', () => {
  const ok = (results) => readRanking({ results }, DOCS);
  assert.deepEqual(ok([{ index: 0, relevance_score: 0 }]), [{ index: 0, excerpt: null }, { index: 1, excerpt: null }], 'an unranked document keeps its own place after the ranked ones');
  for (const results of [
    [{ index: 2, relevance_score: 0.5 }], [{ index: -1, relevance_score: 0.5 }], [{ index: 0.5, relevance_score: 0.5 }],
    [{ index: 0, relevance_score: 0.5 }, { index: 0, relevance_score: 0.4 }],
    [{ index: 0, relevance_score: 1.2 }], [{ index: 0, relevance_score: Number.NaN }], [{ index: 0, relevance_score: '0.5' }],
    [{ index: 0, relevance_score: 0.5, relevant_spans: [{ start: 5, end: 5, score: 0.5 }] }],
    [{ index: 0, relevance_score: 0.5, relevant_spans: [{ start: 0, end: 10_000, score: 0.5 }] }],
    [{ index: 0, relevance_score: 0.5, relevant_spans: [{ start: 0, end: 4, score: 0.5 }, { start: 5, end: 9, score: 0.5 }] }],
    [{ index: 0, relevance_score: 0.5, relevant_spans: 'all' }],
    [{ index: 0, relevance_score: 0.5 }, { index: 1, relevance_score: 0.4 }, { index: 1, relevance_score: 0.3 }],
  ]) assert.throws(() => ok(results), (e) => e.code === 'kit_rank_malformed', JSON.stringify(results));
  assert.throws(() => readRanking({ result: [] }, DOCS), (e) => e.code === 'kit_rank_malformed');
  // Offsets are Unicode code points (Cohere's reference): a character outside the Basic Multilingual Plane counts once.
  const docs = ['🏕️ Test fixture: Zelt für vier', 'Test fixture: Tent B'];
  const points = Array.from(docs[0]);
  const start = points.indexOf('Z');
  assert.deepEqual(readRanking({ results: [{ index: 0, relevance_score: 0.7, relevant_spans: [{ start, end: points.length, score: 0.6 }] }] }, docs)[0], { index: 0, excerpt: 'Zelt für vier' });
});

test('failures are reported plainly, without the provider’s text, and never retried', async () => {
  const cases = [[json(401, { message: 'secret detail' }), 'kit_rank_auth'], [json(498, {}), 'kit_rank_auth'], [json(429, {}), 'kit_rank_limited'],
    [json(422, { message: 'bad' }), 'kit_rank_rejected'], [json(503, {}), 'kit_rank_unavailable'], [new Response('not json', { status: 200 }), 'kit_rank_malformed'],
    [new Response('x'.repeat(RERANK_LIMITS.maxResponseBytes + 1), { status: 200 }), 'kit_rank_malformed']];
  for (const [reply, code] of cases) {
    const transport = fake(reply);
    const ranker = createKitReranker({ apiKey: 'fake-cohere-key-not-real', fetch: transport.fetch });
    await assert.rejects(ranker.rank({ preference: 'sturdy', documents: DOCS }), (e) => e.code === code && !e.message.includes('secret detail') && e.message.includes('unchanged'), code);
    assert.equal(transport.calls.length, 1, `${code}: one call, no retry`);
  }
  const unreachable = createKitReranker({ apiKey: 'k', fetch: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(unreachable.rank({ preference: 'simple', documents: DOCS }), (e) => e.code === 'kit_rank_unreachable');
  const slow = createKitReranker({ apiKey: 'k', timeoutMs: 30, fetch: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  await assert.rejects(slow.rank({ preference: 'warm', documents: DOCS }), (e) => e.code === 'kit_rank_timeout');
});

test('off unless the server has its own KIT_COHERE_API_KEY; no other Cohere variable is ever used', () => {
  assert.deepEqual(loadConfig({}).kitRank, { mode: 'off' });
  assert.deepEqual(loadConfig({ CO_API_KEY: 'x', COHERE_API_KEY: 'y', AI_API_KEY: 'z' }).kitRank, { mode: 'off' });
  assert.deepEqual(loadConfig({ KIT_COHERE_API_KEY: 'fake' }).kitRank, { mode: 'live', provider: 'cohere', apiKey: 'fake', model: 'rerank-v5.0-fast' });
  assert.equal(loadConfig({ KIT_COHERE_API_KEY: 'fake', KIT_COHERE_MODEL: 'rerank-v5.0-pro' }).kitRank.model, 'rerank-v5.0-pro');
  assert.match(loadConfig({ KIT_COHERE_MODEL: 'rerank-v5.0-pro' }).warnings.join(' '), /KIT_COHERE_MODEL is set without KIT_COHERE_API_KEY/);
  assert.deepEqual(loadConfig({}).kitSolver, { mode: 'auto' });
  assert.deepEqual(loadConfig({ OUR_CASTLE_KIT_SOLVER: 'native' }).kitSolver, { mode: 'native' });
  assert.throws(() => loadConfig({ OUR_CASTLE_KIT_SOLVER: '/bin/sh' }), /must be "auto", "native" or "reference"/);
  assert.throws(() => createKitReranker({ apiKey: '' }), /needs its own API key/);
});
