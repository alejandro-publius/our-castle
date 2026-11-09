import test from 'node:test';
import assert from 'node:assert/strict';
import { KIT_READER_LIMITS, KIT_READING_SCHEMA, OPENAI_RESPONSES_URL, checkReading, createKitReader, kitReadRequest } from '../../server/kit/reader.mjs';
import { createFakeOpenAI, fakeReadingReply, fixturePng } from '../helpers/fake-openai.mjs';

// The optional kit-list photo reader against a FAKE OpenAI transport. Every reading here is invented test data: these
// checks prove what is sent and how answers are handled, not how well a model reads a real photo.
const KEY = 'fake-kit-openai-key-not-real';
const MODEL = 'gpt-6-sol';
const IMAGE = fixturePng();
// The task's camping list, read with one misread count (3 sleeping bags) and one count it could not read (the stove).
const READING = { readable: true, items: [
  { name: '4-person tent', quantity: 1, needs: null },
  { name: 'sleeping bag', quantity: 3, needs: null },
  { name: 'torch', quantity: 2, needs: null },
  { name: 'stove', quantity: null, needs: null },
], moreLines: false };
const code = (c) => (e) => { assert.equal(e.code, c, e.message); return true; };
const reader = (respond, options = {}) => { const fake = createFakeOpenAI(respond); return { fake, kit: createKitReader({ apiKey: KEY, model: MODEL, fetch: fake.fetch, ...options }) }; };

test('one read sends exactly one Responses request: the image, a strict schema, store false, no tools, bounded output', async () => {
  const { fake, kit } = reader(() => fakeReadingReply(READING));
  const reading = await kit.read({ image: IMAGE });
  assert.equal(fake.calls.length, 1);
  const [call] = fake.calls;
  assert.equal(call.url, OPENAI_RESPONSES_URL);
  assert.equal(call.url, 'https://api.openai.com/v1/responses');
  assert.deepEqual([call.method, call.redirect, call.signal], ['POST', 'error', true]);
  assert.deepEqual(call.headers, { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' });
  assert.deepEqual(call.body, kitReadRequest({ model: MODEL, image: IMAGE }));
  assert.deepEqual(Object.keys(call.body).sort(), ['input', 'instructions', 'max_output_tokens', 'model', 'reasoning', 'store', 'text']);
  assert.deepEqual(call.body.input, [{ role: 'user', content: [{ type: 'input_image', image_url: IMAGE, detail: 'high' }] }]);
  assert.deepEqual(call.body.text, { format: { type: 'json_schema', name: 'kit_list_reading', strict: true, schema: KIT_READING_SCHEMA } });
  assert.deepEqual([call.body.store, call.body.max_output_tokens, call.body.reasoning], [false, KIT_READER_LIMITS.maxOutputTokens, { effort: 'low' }]);
  assert.equal('tools' in call.body || 'tool_choice' in call.body || 'background' in call.body || 'previous_response_id' in call.body, false);
  assert.deepEqual(reading, { readable: true, moreLines: false, lines: [
    { name: '4-person tent', needs: null, quantity: 1 }, { name: 'sleeping bag', needs: null, quantity: 3 },
    { name: 'torch', needs: null, quantity: 2 }, { name: 'stove', needs: null, quantity: null }] });
});

test('the schema is strict at every level and asks for list lines only: no price, person, amount, date or action', () => {
  const objects = [];
  (function walk(node) {
    if (node && typeof node === 'object') {
      if (node.type === 'object') objects.push(node);
      for (const value of Object.values(node)) walk(value);
    }
  })(KIT_READING_SCHEMA);
  assert.equal(objects.length, 2);
  for (const o of objects) {
    assert.equal(o.additionalProperties, false);
    assert.deepEqual([...o.required].sort(), Object.keys(o.properties).sort(), 'every field is required (null where it may be absent)');
  }
  assert.deepEqual(Object.keys(KIT_READING_SCHEMA.properties), ['readable', 'items', 'moreLines']);
  assert.deepEqual(Object.keys(KIT_READING_SCHEMA.properties.items.items.properties), ['name', 'quantity', 'needs']);
  assert.deepEqual(KIT_READING_SCHEMA.properties.items.items.properties.quantity.type, ['integer', 'null']);
  assert.equal(KIT_READING_SCHEMA.properties.items.maxItems, 12);
});

test('refusals, unfinished answers, failures and tool calls are never a reading; each is one call, never retried', async () => {
  const cases = [
    [{ ...fakeReadingReply(READING), output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'I can’t help with that.' }] }] }, 'kit_reader_refused', 422],
    [fakeReadingReply(READING, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), 'kit_reader_incomplete', 502],
    [fakeReadingReply(READING, { status: 'failed', error: { code: 'server_error', message: 'x' } }), 'kit_reader_failed', 502],
    [fakeReadingReply(READING, { status: 'in_progress' }), 'kit_reader_failed', 502],
    [{ ...fakeReadingReply(READING), output: [{ type: 'function_call', name: 'save_goal', arguments: '{}' }] }, 'kit_reader_malformed', 502],
  ];
  for (const [reply, expected, status] of cases) {
    const { fake, kit } = reader(() => reply);
    await assert.rejects(kit.read({ image: IMAGE }), (e) => { assert.deepEqual([e.code, e.status], [expected, status]); return true; });
    assert.equal(fake.calls.length, 1, expected);
  }
  const incomplete = reader(() => fakeReadingReply(READING, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }));
  await assert.rejects(incomplete.kit.read({ image: IMAGE }), (e) => /ran out of room/.test(e.message) && /type the list instead/.test(e.message));
});

test('an answer that fits the schema is still checked locally: wrong shapes, extra fields, contradictions and huge text are refused', async () => {
  const item = { name: 'torch', quantity: 2, needs: null };
  const bad = [
    'not json',
    JSON.stringify({ ...READING, priceCents: 1500 }),
    JSON.stringify({ ...READING, items: [{ ...item, priceCents: 999 }] }),
    JSON.stringify({ ...READING, items: [{ ...item, quantity: 2.5 }] }),
    JSON.stringify({ ...READING, items: [{ ...item, quantity: '2' }] }),
    JSON.stringify({ ...READING, items: [{ ...item, quantity: 1000 }] }),
    JSON.stringify({ ...READING, items: [{ ...item, name: 'x'.repeat(KIT_READER_LIMITS.maxText + 1) }] }),
    JSON.stringify({ readable: false, items: [item], moreLines: false }),
    JSON.stringify({ ...READING, items: Array.from({ length: 13 }, () => item) }),
    JSON.stringify({ readable: true, items: [item] }),
  ];
  for (const text of bad) {
    const { kit } = reader(() => fakeReadingReply(text));
    await assert.rejects(kit.read({ image: IMAGE }), code('kit_reader_malformed'), text.slice(0, 60));
  }
  const twoTexts = reader(() => ({ ...fakeReadingReply(READING), output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(READING) }, { type: 'output_text', text: JSON.stringify(READING) }] }] }));
  await assert.rejects(twoTexts.kit.read({ image: IMAGE }), code('kit_reader_malformed'));
  // Within the shape, what was read is kept for the family to fix: an out-of-range count stays as read; nothing is filled in.
  assert.deepEqual(checkReading({ readable: true, items: [{ name: ' tent\u0007 ', quantity: 0, needs: '' }, { name: 'pegs', quantity: 40, needs: null }], moreLines: true }),
    { readable: true, moreLines: true, lines: [{ name: 'tent', needs: null, quantity: 0 }, { name: 'pegs', needs: null, quantity: 40 }] });
  assert.deepEqual(checkReading({ readable: false, items: [], moreLines: false }), { readable: false, moreLines: false, lines: [] });
  assert.deepEqual(checkReading({ readable: true, items: [], moreLines: false }), { readable: false, moreLines: false, lines: [] }, 'no lines read is not a list');
});

test('HTTP errors, a huge body, a timeout and an unreachable host are honest errors, each from a single call', async () => {
  for (const [status, expected] of [[401, 'kit_reader_auth'], [403, 'kit_reader_auth'], [429, 'kit_reader_limited'], [400, 'kit_reader_rejected'], [404, 'kit_reader_rejected'], [500, 'kit_reader_unavailable'], [503, 'kit_reader_unavailable']]) {
    const { fake, kit } = reader(() => new Response(JSON.stringify({ error: { message: 'secret detail from provider' } }), { status }));
    await assert.rejects(kit.read({ image: IMAGE }), (e) => { assert.equal(e.code, expected); assert.equal(e.message.includes('secret detail'), false, 'provider text is not echoed'); return true; });
    assert.equal(fake.calls.length, 1);
  }
  const huge = reader(() => new Response('x'.repeat(KIT_READER_LIMITS.maxResponseBytes + 1), { status: 200 }));
  await assert.rejects(huge.kit.read({ image: IMAGE }), code('kit_reader_malformed'));
  const slow = reader((call, n, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))), { timeoutMs: 20 });
  await assert.rejects(slow.kit.read({ image: IMAGE }), code('kit_reader_timeout'));
  assert.equal(slow.fake.calls.length, 1);
  const down = reader(() => { throw new TypeError('fetch failed'); });
  await assert.rejects(down.kit.read({ image: IMAGE }), code('kit_reader_unreachable'));
  assert.equal(down.fake.calls.length, 1);
  assert.throws(() => createKitReader({ apiKey: '', model: MODEL }), /own API key/);
  assert.throws(() => createKitReader({ apiKey: KEY, model: '' }), /own API key/);
});
