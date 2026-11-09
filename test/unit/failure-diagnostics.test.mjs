import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { inspect } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { createClock } from '../../server/household.mjs';
import { contribution, FIXED_NOW } from '../helpers/setup.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const PRIVATE = ['fixture-cookie-secret', 'fixture-bearer-secret', 'fixture-family-note', 'fixture-invite-secret'];
function privateFailure() {
  const error = new Error(PRIVATE[2], { cause: new Error(PRIVATE[3]) });
  error.headers = { authorization: PRIVATE[1], cookie: PRIVATE[0] };
  return error;
}

// The real service and in-memory SQLite, with one storage-read failure after the real COMMIT returns.
async function fixture(t) {
  const db = openDatabase(':memory:');
  let failReads = 0, failAfterCredit = false;
  const proxied = new Proxy(db, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (key === 'prepare') return (...args) => {
      if (failReads > 0) { failReads--; throw privateFailure(); }
      return value.apply(target, args);
    };
    if (key === 'exec') return (...args) => {
      const result = value.apply(target, args);
      if (failAfterCredit && args[0] === 'COMMIT' && db.prepare('SELECT COUNT(*) AS n FROM payment_captures WHERE credited = 1').get().n) {
        failAfterCredit = false; failReads = 1;
      }
      return result;
    };
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const app = createApp({ config: loadConfig({}, { root }), db: proxied, clock: createClock(FIXED_NOW), root });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  return {
    db, errors,
    failNextReads(n) { failReads = n; },
    failAfterNextCredit() { failAfterCredit = true; },
    async call(method, pathname, body, headers = {}) {
      const response = await fetch(base + pathname, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, headers: response.headers, body: await response.json() };
    },
    async close() { app.live?.close(); await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); db.close(); },
  };
}

test('an error after a committed contribution does not tell the family that no payment was credited', async (t) => {
  const s = await fixture(t);
  try {
    const setup = await s.call('POST', '/api/setup', { playMode: 'family', name: 'Fixture household', crest: { field: 'cobalt', charge: 'stag' } });
    assert.equal(setup.status, 200);
    s.failAfterNextCredit();
    const input = contribution({ requestId: 'diagnostic-post-commit' });
    const failed = await s.call('POST', '/api/example/contributions', input);
    assert.equal(failed.status, 500);
    const latest = await s.call('GET', '/api/state');
    assert.equal(latest.body.progress.progressCents, 7500);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM payment_captures WHERE credited = 1').get().n, 1);
    t.diagnostic(JSON.stringify({ status: failed.status, progressCents: latest.body.progress.progressCents,
      creditedCaptures: 1, message: failed.body.error.message }));
    assert.doesNotMatch(failed.body.error.message, /no payment was credited|nothing was charged/i);
    assert.match(failed.body.error.message, /check.*records/i);
    const retry = await s.call('POST', '/api/example/contributions', input);
    assert.equal(retry.body.outcome, 'already_processed');
    assert.equal(retry.body.state.progress.progressCents, 7500);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM payment_captures WHERE credited = 1').get().n, 1);
  } finally { await s.close(); }
});

test('unexpected errors have distinct server-generated references without logging private error or request data', async (t) => {
  const s = await fixture(t);
  try {
    s.failNextReads(2);
    const responses = await Promise.all([1, 2].map(() => s.call('GET', '/api/state?invitation=' + PRIVATE[3], undefined,
      { Cookie: PRIVATE[0], Authorization: PRIVATE[1], 'X-Request-Id': 'caller-controlled-reference' })));
    assert.deepEqual(responses.map((r) => r.status), [500, 500]);
    const printed = inspect(s.errors, { depth: 8 }) + JSON.stringify(responses.map((r) => r.body));
    for (const secret of PRIVATE) assert.equal(printed.includes(secret), false, 'private fixture data appeared in diagnostics');
    const ids = responses.map((r) => r.headers.get('x-request-id'));
    for (const id of ids) assert.match(id, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
    assert.equal(new Set(ids).size, 2);
    for (const [i, response] of responses.entries()) assert.equal(response.body.error.requestId, ids[i]);
    assert.equal(s.errors.length, 2);
    for (const args of s.errors) {
      assert.equal(args.length, 2);
      const event = args[1];
      assert.ok(ids.includes(event.requestId));
      assert.deepEqual(Object.keys(event).sort(), ['code', 'method', 'requestId', 'route']);
      assert.equal(event.code, 'server_error');
      assert.equal(event.method, 'GET');
      assert.equal(event.route, '/api/state');
    }
  } finally { await s.close(); }
});

test('expected API refusals keep their existing status and message without unexpected-error logging', async (t) => {
  const s = await fixture(t);
  try {
    const response = await s.call('GET', '/api/not-a-route');
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'not_found');
    assert.equal(response.body.error.message, 'Unknown API route.');
    assert.equal(response.headers.get('x-request-id'), null);
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});
