// A FAKE OpenAI Responses transport for the kit list's photo reader. It never contacts OpenAI. Replies are shaped like the
// documented Responses object (status, output items of type "message" with output_text or refusal parts); their content
// is invented test data, not evidence of how well any model reads a real photo.

/** A completed reply whose one message carries `reading` as the structured JSON text. */
export function fakeReadingReply(reading, extra = {}) {
  return {
    id: 'resp_fake_kit_0001', object: 'response', status: 'completed', error: null, incomplete_details: null, store: false,
    output: [
      { type: 'reasoning', id: 'rs_fake_0001', summary: [] },
      { type: 'message', id: 'msg_fake_0001', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: typeof reading === 'string' ? reading : JSON.stringify(reading), annotations: [] }] },
    ],
    usage: { input_tokens: 1200, output_tokens: 180 },
    ...extra,
  };
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * A fetch replacement that records each call (URL, method, headers, parsed body, redirect mode, whether a signal was set)
 * and answers with `respond(call, n)`: a Response, a plain object (sent as a 200 JSON reply), or a thrown error.
 * `hold()` makes the next call wait until the returned release function is called (a slow answer).
 */
export function createFakeOpenAI(respond) {
  const calls = [];
  let held = null;
  async function fetch(url, init = {}) {
    const call = { url: String(url), method: init.method, headers: { ...init.headers }, body: init.body ? JSON.parse(init.body) : null, redirect: init.redirect, signal: Boolean(init.signal) };
    calls.push(call);
    if (held) { const wait = held; held = null; await wait; }
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const out = await respond(call, calls.length, init);
    return out instanceof Response ? out : json(200, out);
  }
  return {
    fetch, calls, json,
    hold() { let release; held = new Promise((resolve) => { release = resolve; }); return release; },
  };
}

// An invented, valid 64 x 48 PNG (a plain image): test bytes only, not a photo of anyone's list.
export function fixturePng(width = 64, height = 48) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8; bytes[25] = 2; // 8-bit truecolour; the rest of a real file is not needed by the size check
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

// An invented JPEG header with a frame of the given size, after an APP0 segment.
export function fixtureJpeg(width = 640, height = 480) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(17, 2); sof[4] = 8; sof.writeUInt16BE(height, 5); sof.writeUInt16BE(width, 7); sof[9] = 3;
  const bytes = Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}
