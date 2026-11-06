// Family access over real HTTP, shared by the family tests: an in-process server in family mode, each "browser" with its
// own cookie jar and its own software authenticator, a controllable clock and in-memory or temporary databases. No
// provider is configured; a test may pass a merchant with a fake transport.
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { createSoftAuthenticator } from './soft-authenticator.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

// Like a browser, retry when a pooled keep-alive connection belonged to a server that has since restarted (the pool may
// hold several such connections).
async function retryStale(send, attempts = 4) {
  for (let i = 1; ; i++) {
    try { return await send(); } catch (error) {
      if (i >= attempts || !['ECONNRESET', 'UND_ERR_SOCKET', 'EPIPE'].includes(error?.cause?.code)) throw error;
    }
  }
}

export function mutableClock(start = '2026-11-03T12:00:00') {
  let t = new Date(start).getTime();
  return {
    now: () => new Date(t), iso: () => new Date(t).toISOString(), advance(ms) { t += ms; },
    today() { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
  };
}

export async function startServer({ file = ':memory:', clock = mutableClock(), port = 0, live = {}, merchant = null, env = {}, paypal = null } = {}) {
  const db = openDatabase(file);
  let app;
  const server = http.createServer((req, res) => app.handler(req, res));
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const origin = `http://localhost:${server.address().port}`;
  app = createApp({ config: loadConfig({ ...env, OUR_CASTLE_ACCESS: 'family', OUR_CASTLE_ORIGIN: origin }, { root }), db, clock, root, live, merchant, paypal });
  let closing = null;
  const close = () => (closing ??= new Promise((resolve) => { app.live?.close(); server.closeAllConnections(); server.close(() => { db.close(); resolve(); }); }));
  return { db, origin, clock, app, close, port: server.address().port };
}

/** A browser: cookie jar, the session's CSRF token, and its own authenticator. */
export function browser(origin) {
  const jar = new Map(), auth = createSoftAuthenticator();
  const b = {
    jar, auth, csrf: null, origin,
    async call(method, pathname, body, { headers = {}, base = origin, csrf = true } = {}) {
      const h = { Origin: origin, ...headers };
      if (body !== undefined) h['Content-Type'] = 'application/json';
      if (csrf && b.csrf && method !== 'GET') h['X-CSRF-Token'] = b.csrf;
      if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      const send = () => fetch(base + pathname, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
      const res = await retryStale(send);
      for (const c of res.headers.getSetCookie()) {
        const [pair, ...attrs] = c.split('; '), i = pair.indexOf('=');
        const name = pair.slice(0, i), value = pair.slice(i + 1);
        if (attrs.includes('Max-Age=0') || !value) jar.delete(name); else jar.set(name, value);
      }
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, json, headers: res.headers };
    },
    async session() { const r = await b.call('GET', '/api/session'); b.csrf = r.json.csrfToken ?? null; return r.json; },
    async createFamily(name, opts = {}) {
      const start = await b.call('POST', '/api/auth/family/options', { displayName: name });
      assert.equal(start.status, 200, JSON.stringify(start.json));
      const response = auth.register(start.json.options, { origin, ...opts });
      const done = await b.call('POST', '/api/auth/family/verify', { ceremonyId: start.json.ceremonyId, response });
      if (done.status === 200) await b.session();
      return { start: start.json, response, done };
    },
    async signIn(opts = {}) {
      const start = await b.call('POST', '/api/auth/signin/options', {});
      const response = auth.authenticate(start.json.options, { origin, ...opts });
      const done = await b.call('POST', '/api/auth/signin/verify', { ceremonyId: start.json.ceremonyId, response });
      if (done.status === 200) await b.session();
      return { start: start.json, response, done };
    },
    async accept(token, extra = {}) {
      const start = await b.call('POST', '/api/auth/invitation/options', { token });
      if (start.status !== 200) return { done: start };
      const response = auth.register(start.json.options, { origin });
      const done = await b.call('POST', '/api/auth/invitation/verify', { token, ceremonyId: start.json.ceremonyId, response, ...extra });
      if (done.status === 200) await b.session();
      return { start: start.json, response, done };
    },
  };
  return b;
}
export const tokenOf = (link) => link.split('#invite=')[1];
export async function familyWith(s, members = []) {
  const owner = browser(s.origin);
  await owner.createFamily('Rowan');
  await owner.call('POST', '/api/setup', { name: 'House of Alder', crest: { field: 'violet', charge: 'stag' } });
  const others = {};
  for (const [name, role] of members) {
    const inv = await owner.call('POST', '/api/family/invitations', { name, role });
    others[name] = browser(s.origin);
    const accepted = await others[name].accept(tokenOf(inv.json.link));
    assert.equal(accepted.done.status, 200, JSON.stringify(accepted.done.json));
  }
  return { owner, ...others };
}

/**
 * A live-update stream (GET /api/events) read the way a browser's EventSource reads it, with the browser's cookies.
 * `next(name)` waits for the next event of that name; `quiet(ms)` resolves to the events that arrived in that time.
 */
export async function openStream(b, { origin } = {}) {
  const controller = new AbortController();
  const headers = { Accept: 'text/event-stream' };
  if (b.jar.size) headers.Cookie = [...b.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await retryStale(() => fetch(`${origin ?? b.origin}/api/events`, { headers, signal: controller.signal }));
  const events = [], waiters = [];
  let ended = false, buffer = '', raw = '';
  const deliver = () => {
    for (const w of [...waiters]) {
      const i = events.findIndex((e, n) => n >= w.from && e.event === w.name);
      if (i !== -1) { waiters.splice(waiters.indexOf(w), 1); w.from = i + 1; w.resolve(events[i]); }
      else if (ended) { waiters.splice(waiters.indexOf(w), 1); w.reject(new Error(`stream ended before "${w.name}"`)); }
    }
  };
  const pump = (async () => {
    if (!res.ok || !res.body) { ended = true; return; }
    const reader = res.body.getReader(), decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        raw += text; buffer += text;
        let cut;
        while ((cut = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, cut); buffer = buffer.slice(cut + 2);
          const lines = block.split('\n');
          const event = lines.find((l) => l.startsWith('event: '))?.slice(7);
          const data = lines.filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
          if (event) events.push({ event, data: data ? JSON.parse(data) : null });
          deliver();
        }
      }
    } catch { /* aborted or reset */ }
    ended = true; deliver();
  })();
  let cursor = 0;
  return {
    status: res.status, headers: res.headers, events,
    get ended() { return ended; },
    get raw() { return raw; },
    json: res.ok ? null : await res.json().catch(() => null),
    next(name, ms = 3000) {
      return new Promise((resolve, reject) => {
        const w = { name, from: cursor, resolve: (e) => { cursor = w.from; clearTimeout(t); resolve(e); }, reject: (e) => { clearTimeout(t); reject(e); } };
        const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`no "${name}" event within ${ms} ms`)); }, ms);
        waiters.push(w); deliver();
      });
    },
    async quiet(ms = 250) { const from = events.length; await new Promise((r) => setTimeout(r, ms)); return events.slice(from); },
    async close() { controller.abort(); await pump; },
    done: pump,
  };
}
