// Optional photo reading for the family kit list: one OpenAI Responses call per explicit "Read the photo" action.
// Server-only. It is off unless the server sets its own KIT_OPENAI_API_KEY (see config.mjs): never OPENAI_API_KEY, the
// planner's key or any assistant login. Nothing is retried, cached or stored here.
//
// Contract, from OpenAI's API docs read on 2026-11-09 (developers.openai.com/api/docs/guides/images-vision,
// …/guides/structured-outputs?api-mode=responses, …/reference/resources/responses/methods/create, …/models/gpt-6-sol):
// - POST /v1/responses; the image goes in a user message as an `input_image` part whose `image_url` is a base64 data URL;
// - `text.format` is { type: 'json_schema', name, strict: true, schema }: every object sets additionalProperties:false and
//   lists all its fields in `required`, with a null type for a value that may be absent;
// - `store` defaults to true, so it is set to false. That stops the response being kept as application state; it is not
//   a promise that the provider keeps nothing;
// - no tools are offered. `max_output_tokens` bounds reasoning and output together;
// - a reply has `status` completed, failed, in_progress, cancelled, queued or incomplete (`incomplete_details.reason`);
//   its `output` holds `message` items whose content parts are `output_text` or `refusal`. `output_text` on the response
//   is an SDK-only convenience, so the message parts are read here.
// Output that fits the schema is not proof the photo was read correctly: a separate local check follows, and the
// family reviews and corrects every line before anything is saved.
import { DomainError } from '../household.mjs';
import { cleanKitText } from '../../src/core/kit-list.js';

export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
export const KIT_READER_LIMITS = Object.freeze({
  maxLines: 12,               // lines the model may return; more than the 8 a list holds, so an over-long list shows as such
  maxText: 200,               // characters of one name or needs before the answer is treated as malformed
  maxQuantity: 999,           // beyond this a "count" is malformed; 21–999 is shown for the family to fix
  maxResponseBytes: 256 * 1024,
  maxOutputTokens: 4000,
  timeoutMs: 60_000,
});

const INSTRUCTIONS = [
  'Read the photo of a short written list of things a family needs to bring, such as a camping or school kit list.',
  'Return each written line as one item, in order: the item as written without its count; the count written for it, or null',
  'when no count is clearly written; and anything written about what it must be (a size, rating or capacity), or null.',
  'A number that describes the item, like the 4 in "4-person tent", is not a count. Never guess a count or add an item',
  'that is not written. Set readable to false if the photo does not show such a list. Set moreLines to true if some lines',
  'could not be read or there are more than 12. Return only the list: no prices, people, dates, amounts or instructions.',
].join(' ');

/** The structured answer requested: lines of a list, never prices, people, money, dates or actions. */
export const KIT_READING_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['readable', 'items', 'moreLines'],
  properties: {
    readable: { type: 'boolean', description: 'True only when the photo shows a written list of things to bring.' },
    items: {
      type: 'array',
      maxItems: KIT_READER_LIMITS.maxLines,
      description: 'Each written line, in order.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'quantity', 'needs'],
        properties: {
          name: { type: 'string', description: 'The item as written, without its count.' },
          quantity: { type: ['integer', 'null'], description: 'The count written for this item, or null when no count is clearly written.' },
          needs: { type: ['string', 'null'], description: 'What is written about the item itself (a size, rating or capacity), or null.' },
        },
      },
    },
    moreLines: { type: 'boolean', description: 'True when some lines could not be read, or there are more than 12.' },
  },
});

/** The exact request body sent for one photo. The model comes from server configuration only. */
export function kitReadRequest({ model, image }) {
  return {
    model,
    instructions: INSTRUCTIONS,
    input: [{ role: 'user', content: [{ type: 'input_image', image_url: image, detail: 'high' }] }],
    text: { format: { type: 'json_schema', name: 'kit_list_reading', strict: true, schema: KIT_READING_SCHEMA } },
    reasoning: { effort: 'low' },
    max_output_tokens: KIT_READER_LIMITS.maxOutputTokens,
    store: false,
  };
}

const fail = (status, code, message) => new DomainError(status, code, message);
const TYPE_INSTEAD = 'Nothing was saved; you can type the list instead.';
const malformed = () => fail(502, 'kit_reader_malformed', `OpenAI sent an answer this app could not use. ${TYPE_INSTEAD}`);

function httpError(status) {
  if (status === 401 || status === 403) return fail(502, 'kit_reader_auth', `OpenAI did not accept this server’s photo-reading key, so the photo was not read. ${TYPE_INSTEAD}`);
  if (status === 429) return fail(503, 'kit_reader_limited', `OpenAI is limiting requests for this key right now. ${TYPE_INSTEAD}`);
  if (status >= 400 && status < 500) return fail(502, 'kit_reader_rejected', `OpenAI could not take this photo request (HTTP ${status}). ${TYPE_INSTEAD}`);
  return fail(502, 'kit_reader_unavailable', `OpenAI did not answer properly (HTTP ${status}). ${TYPE_INSTEAD}`);
}

// Read at most `max` bytes of a response body; a longer answer is refused rather than buffered.
async function readBounded(response, max) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > max) throw malformed();
    return text;
  }
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => {}); throw malformed(); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

const keysOf = (o) => Object.keys(o).sort().join(',');
const isObject = (o) => Boolean(o) && typeof o === 'object' && !Array.isArray(o);

/**
 * The independent local check of a reading: exactly the requested shape, bounded text, whole-number or null counts. A
 * reading that says it found no list yet lists items is contradictory and refused. Counts outside 1–20 are kept as read
 * for the family to fix; nothing is filled in.
 * @returns {{ readable: boolean, lines: { name: string, needs: string|null, quantity: number|null }[], moreLines: boolean }}
 */
export function checkReading(data) {
  const L = KIT_READER_LIMITS;
  if (!isObject(data) || keysOf(data) !== 'items,moreLines,readable') throw malformed();
  if (typeof data.readable !== 'boolean' || typeof data.moreLines !== 'boolean' || !Array.isArray(data.items) || data.items.length > L.maxLines) throw malformed();
  const lines = data.items.map((item) => {
    if (!isObject(item) || keysOf(item) !== 'name,needs,quantity') throw malformed();
    const { name, needs, quantity } = item;
    if (typeof name !== 'string' || name.length > L.maxText) throw malformed();
    if (needs !== null && (typeof needs !== 'string' || needs.length > L.maxText)) throw malformed();
    if (quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > L.maxQuantity)) throw malformed();
    return { name: cleanKitText(name), needs: cleanKitText(needs ?? '') || null, quantity };
  });
  if (!data.readable && lines.length) throw malformed();
  return { readable: data.readable && lines.length > 0, lines, moreLines: data.moreLines };
}

/** A Responses API reply to the request above: refusals, unfinished answers and tool calls are never a reading. */
export function readingFromResponse(json) {
  if (!isObject(json)) throw malformed();
  if (json.status === 'incomplete') {
    const why = json.incomplete_details?.reason === 'max_output_tokens' ? ' (it ran out of room)' : '';
    throw fail(502, 'kit_reader_incomplete', `OpenAI stopped before it finished reading the photo${why}. ${TYPE_INSTEAD}`);
  }
  if (json.status !== 'completed') throw fail(502, 'kit_reader_failed', `OpenAI did not finish reading the photo. ${TYPE_INSTEAD}`);
  const output = Array.isArray(json.output) ? json.output : [];
  // No tool was offered, so anything other than the answer (and the model's own reasoning) is not a reading.
  if (output.some((item) => !isObject(item) || !['message', 'reasoning'].includes(item.type))) throw malformed();
  const parts = output.filter((item) => item.type === 'message').flatMap((m) => (Array.isArray(m.content) ? m.content : [null]));
  if (parts.some((p) => !isObject(p) || !['output_text', 'refusal'].includes(p.type))) throw malformed();
  if (parts.some((p) => p.type === 'refusal')) throw fail(422, 'kit_reader_refused', `OpenAI declined to read this photo. ${TYPE_INSTEAD}`);
  if (parts.length !== 1 || typeof parts[0].text !== 'string') throw malformed();
  let data;
  try { data = JSON.parse(parts[0].text); } catch { throw malformed(); }
  return checkReading(data);
}

/**
 * The photo reader. `fetch` is injectable so checks use a fake transport; the key leaves this function only as OpenAI's
 * documented Authorization header, to OpenAI's fixed host. One call per read: no retry, no redirect, a hard timeout.
 */
export function createKitReader({ apiKey, model, fetch = globalThis.fetch, timeoutMs = KIT_READER_LIMITS.timeoutMs }) {
  if (!apiKey || !model) throw new Error('createKitReader needs its own API key and a model');
  return {
    model,
    async read({ image }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(OPENAI_RESPONSES_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(kitReadRequest({ model, image })),
          signal: controller.signal,
          redirect: 'error',
        });
      } catch {
        clearTimeout(timer);
        if (controller.signal.aborted) throw fail(504, 'kit_reader_timeout', `OpenAI took longer than ${Math.round(timeoutMs / 1000)} seconds to read the photo. ${TYPE_INSTEAD}`);
        throw fail(502, 'kit_reader_unreachable', `Could not reach OpenAI from this server. ${TYPE_INSTEAD}`);
      }
      try {
        if (!response.ok) { await response.body?.cancel?.().catch(() => {}); throw httpError(response.status); }
        let text;
        try { text = await readBounded(response, KIT_READER_LIMITS.maxResponseBytes); } catch (error) {
          if (controller.signal.aborted) throw fail(504, 'kit_reader_timeout', `OpenAI took longer than ${Math.round(timeoutMs / 1000)} seconds to read the photo. ${TYPE_INSTEAD}`);
          if (error instanceof DomainError) throw error;
          throw malformed();
        }
        let json;
        try { json = JSON.parse(text); } catch { throw malformed(); }
        return readingFromResponse(json);
      } finally { clearTimeout(timer); }
    },
  };
}
