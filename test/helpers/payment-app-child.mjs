// The app in a process of its own, for restart tests that kill it abruptly (test/unit/payment-restart.test.mjs) and for
// two of them sharing one database (test/unit/payment-two-servers.test.mjs). It runs the real server and payment
// service on a disposable database, with the production PayPal SDK adapter. Its transport reaches only the parent's
// loopback fake PayPal, which outlives this process.
//   node payment-app-child.mjs <database file> <fake PayPal base URL> [<route suffix whose answer is withheld>] [trace-transactions]
// Started with an empty environment and explicit fake credentials; it reads no .env and refuses every other network
// call. The optional answer gate is test-harness code: the app finishes its work, but its answer never reaches the
// client, and the parent is told instead.
import { writeSync } from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { createClock } from '../../server/household.mjs';
import { createPayPalSdkClient } from '../../server/payments/paypal-sdk-client.mjs';

const [file, fakeBase, withheld = '', trace = ''] = process.argv.slice(2);
const SANDBOX = 'https://api-m.sandbox.paypal.com';
const loopback = new URL(fakeBase);
if (loopback.hostname !== '127.0.0.1') throw new Error('The fake PayPal must be on 127.0.0.1');

// Only loopback traffic leaves this process.
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const target = new URL(url instanceof Request ? url.url : url);
  if (target.hostname !== '127.0.0.1') throw new Error(`Refused non-loopback dispatch to ${target.origin}`);
  return realFetch(url, init);
};
const toFake = (url) => {
  const target = new URL(url);
  if (target.origin !== SANDBOX) throw new Error(`Refused dispatch to ${target.origin}`);
  return `${fakeBase}${target.pathname}${target.search}`;
};
// The SDK's axios transport (its documented test seam), forwarded to the fake over loopback HTTP.
async function httpAdapter(config) {
  const headers = {};
  for (const [name, value] of Object.entries(config.headers?.toJSON?.() ?? config.headers ?? {})) if (value != null) headers[name] = String(value);
  if (config.auth) headers.Authorization = `Basic ${Buffer.from(`${config.auth.username}:${config.auth.password}`).toString('base64')}`;
  const response = await realFetch(toFake(config.url), { method: config.method.toUpperCase(), headers, body: config.data ?? undefined });
  return { config, status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers), data: await response.text() };
}
const restFetch = (url, init) => realFetch(toFake(url), init);

const credentials = { PAYPAL_CLIENT_ID: 'fake-restart-client', PAYPAL_CLIENT_SECRET: 'fake-restart-secret', PAYPAL_WEBHOOK_ID: 'WH-RESTART' };
const root = fileURLToPath(new URL('../../', import.meta.url));
const db = openDatabase(file);
// Optional test-harness trace: before each write transaction asks SQLite for the lock, say so on stderr. The write is
// synchronous, so the parent receives it even while this process then waits for a lock the parent holds.
if (trace === 'trace-transactions') {
  const exec = db.exec.bind(db);
  db.exec = (sql) => { if (sql === 'BEGIN IMMEDIATE') writeSync(2, 'harness: begin immediate\n'); return exec(sql); };
}
const paypal = createPayPalSdkClient({ clientId: credentials.PAYPAL_CLIENT_ID, clientSecret: credentials.PAYPAL_CLIENT_SECRET, httpAdapter, restFetch });
const app = createApp({ config: loadConfig(credentials, { root }), db, clock: createClock(), root, paypal });

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (withheld && req.method === 'POST' && pathname.endsWith(withheld)) {
    res.end = () => { process.send({ withheld: pathname, status: res.statusCode }); return res; };
  }
  return app.handler(req, res);
});
server.listen(0, '127.0.0.1', () => process.send({ ready: server.address().port }));
