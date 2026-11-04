// Prove the Postman example folder's fail-closed guard with the real Newman runtime, using only local stand-ins:
// - logging mock servers that report sandbox payments, live AI or a broken status must receive no request other than
//   GET /api/status, and each run must exit unsuccessfully;
// - a closed port and a malformed exampleBaseUrl must also block;
// - a fresh example-mode server (temporary database, no .env, no keys), behind a logging proxy, must pass the whole
//   folder with a status check before every request.
// It never targets port 3010, makes no PayPal or AI call, and creates no sandbox order.
// Newman is not a dependency: set NEWMAN_BIN to newman/bin/newman.js, or it is looked up in the npx cache.
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const collection = path.join(root, 'postman/our-castle.postman_collection.json');
const environment = path.join(root, 'postman/our-castle.postman_environment.json');
const FOLDER = '1 · Example mode walkthrough (no credentials)';
const OWNER_APP_PORT = 3010;
const isStatusCall = (r) => r.method === 'GET' && r.url === '/api/status';

function findNewman() {
  if (process.env.NEWMAN_BIN) return process.env.NEWMAN_BIN;
  const cache = path.join(os.homedir(), '.npm/_npx');
  for (const entry of existsSync(cache) ? readdirSync(cache) : []) {
    const bin = path.join(cache, entry, 'node_modules/newman/bin/newman.js');
    if (existsSync(bin)) return bin;
  }
  return null;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      if (port === OWNER_APP_PORT) { server.close(); reject(new Error('Refusing to use port 3010.')); } else resolve(port);
    });
  });
}

const freePort = async () => { const s = net.createServer(); const port = await listen(s); await new Promise((r) => s.close(r)); return port; };

/** Logs every request. Answers GET /api/status with `statusReply`; anything else gets a plausible reply, or is
 *  forwarded to `forwardPort` when given (so the log is ground truth for what reached the real server). */
async function loggingServer({ statusReply = null, forwardPort = null } = {}) {
  const log = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      log.push({ method: req.method, url: req.url });
      if (forwardPort) {
        const upstream = http.request({ host: '127.0.0.1', port: forwardPort, method: req.method, path: req.url,
          headers: { ...req.headers, host: `127.0.0.1:${forwardPort}` } }, (up) => {
          res.writeHead(up.statusCode, up.headers);
          up.pipe(res);
        });
        upstream.on('error', () => { res.writeHead(502); res.end(); });
        return upstream.end(body);
      }
      if (isStatusCall(req)) {
        res.writeHead(statusReply.code, { 'content-type': 'application/json' });
        return res.end(statusReply.body);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"state":{}}');
    });
  });
  const port = await listen(server);
  return { log, port, close: () => new Promise((r) => server.close(r)) };
}

function runNewman(newman, exampleBaseUrl, reportFile) {
  const args = [newman, 'run', collection, '-e', environment, '--folder', FOLDER,
    '--env-var', `exampleBaseUrl=${exampleBaseUrl}`, '--reporters', 'json', '--reporter-json-export', reportFile];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.on('close', (code) => {
      const run = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')).run : {};
      resolve({
        code, out,
        items: run.stats?.items?.total ?? 0,
        requests: run.stats?.requests?.total ?? 0, // Newman counts the guard's status calls here too
        assertions: run.stats?.assertions?.total ?? 0,
        failedAssertions: run.stats?.assertions?.failed ?? 0,
        blocked: (run.failures ?? []).map((f) => f.error?.test ?? '').find((t) => t.startsWith('BLOCKED')) ?? null,
        failures: (run.failures ?? []).map((f) => f.error?.test ?? f.error?.message ?? String(f.error)),
      });
    });
  });
}

async function startExampleServer(port, dataDir) {
  const env = { ...process.env, OUR_CASTLE_ENV_FILE: 'none', OUR_CASTLE_DATA_DIR: dataDir, PORT: String(port),
    PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '', PAYPAL_WEBHOOK_ID: '', AI_API_KEY: '' };
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`The isolated example server did not start:\n${out}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/status`);
      if (r.ok) return { child, status: await r.json() };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error(`The isolated example server did not answer:\n${out}`);
}

const newman = findNewman();
if (!newman) {
  console.error('Newman was not found. Set NEWMAN_BIN to newman/bin/newman.js (for example after `npx newman --version`).');
  process.exit(2);
}
const newmanVersion = JSON.parse(readFileSync(path.join(path.dirname(newman), '../package.json'), 'utf8')).version;
const work = mkdtempSync(path.join(os.tmpdir(), 'our-castle-postman-guard-'));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); };
const report = () => path.join(work, `run-${results.length}.json`);

try {
  console.log(`Newman ${newmanVersion} (${newman})`);
  const blockedReplies = [
    ['sandbox payments, example AI', { code: 200, body: JSON.stringify({ payments: { mode: 'sandbox', label: 'PayPal sandbox' }, ai: { mode: 'example' } }) }],
    ['example payments, live AI', { code: 200, body: JSON.stringify({ payments: { mode: 'example' }, ai: { mode: 'live', provider: 'anthropic', model: 'claude-opus-5-5' } }) }],
    ['sandbox payments, live AI', { code: 200, body: JSON.stringify({ payments: { mode: 'sandbox' }, ai: { mode: 'live' } }) }],
    ['status HTTP 500', { code: 500, body: '{"error":"boom"}' }],
    ['status is not JSON', { code: 200, body: '<html>not json</html>' }],
    ['status missing modes', { code: 200, body: '{}' }],
    ['modes as plain strings', { code: 200, body: JSON.stringify({ payments: 'example', ai: 'example' }) }],
  ];
  for (const [name, statusReply] of blockedReplies) {
    const mock = await loggingServer({ statusReply });
    const r = await runNewman(newman, `http://127.0.0.1:${mock.port}`, report());
    await mock.close();
    const other = mock.log.filter((x) => !isStatusCall(x));
    check(`${name}: blocked`, r.code !== 0 && other.length === 0 && Boolean(r.blocked),
      `exit ${r.code}; mock received ${mock.log.length} request(s), ${other.length} besides GET /api/status; stopped after ${r.items} item(s)`);
  }

  // Control: when a mock does claim example/example, the guard lets requests through and the mock sees them.
  // This shows the mocks above would have caught a mutation; the run still fails because the mock's replies are fake.
  {
    const mock = await loggingServer({ statusReply: { code: 200, body: JSON.stringify({ payments: { mode: 'example' }, ai: { mode: 'example' } }) } });
    const r = await runNewman(newman, `http://127.0.0.1:${mock.port}`, report());
    await mock.close();
    const other = mock.log.filter((x) => !isStatusCall(x));
    check('control, mock claims example/example: requests reach the mock', other.length === 10 && !r.blocked,
      `mock received ${other.length} folder requests (${other.slice(0, 2).map((x) => `${x.method} ${x.url}`).join(', ')}, …); no BLOCKED failure`);
  }

  // Unreachable: a port that was free a moment ago, with nothing listening.
  const closed = await freePort();
  {
    const r = await runNewman(newman, `http://127.0.0.1:${closed}`, report());
    check('status unreachable: blocked', r.code !== 0 && r.requests <= 1 && Boolean(r.blocked),
      `exit ${r.code}; ${r.requests} request attempt (the failed status call); stopped after ${r.items} item(s); "${r.blocked}"`);
  }
  // Malformed variable: an empty value or a path is refused before any network call.
  for (const value of ['', 'http://127.0.0.1:9/api']) {
    const r = await runNewman(newman, value, report());
    check(`exampleBaseUrl ${JSON.stringify(value)}: blocked`, r.code !== 0 && r.requests === 0 && Boolean(r.blocked),
      `exit ${r.code}; ${r.requests} requests; stopped after ${r.items} item(s)`);
  }

  // The real folder against a new example-mode server with a temporary database and no keys, behind a logging proxy.
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(work, 'data-'));
  const server = await startExampleServer(port, dataDir);
  const proxy = await loggingServer({ forwardPort: port });
  try {
    const modesOk = server.status.payments?.mode === 'example' && server.status.ai?.mode === 'example';
    const r = await runNewman(newman, `http://127.0.0.1:${proxy.port}`, report());
    const folderRequests = proxy.log.filter((x) => !isStatusCall(x));
    const checkedFirst = proxy.log.every((x, i) => (i % 2 === 0 ? isStatusCall(x) : !isStatusCall(x)));
    check('fresh example-mode server: whole folder passes', modesOk && r.code === 0 && r.failures.length === 0 && folderRequests.length === 10 && checkedFirst,
      `server ${server.status.payments?.mode}/${server.status.ai?.mode}; exit ${r.code}; ${folderRequests.length} folder requests, each preceded by GET /api/status (${proxy.log.length} total); ${r.assertions - r.failedAssertions}/${r.assertions} assertions passed${r.failures.length ? `; ${r.failures.join(' | ')}` : ''}`);
  } finally {
    await proxy.close();
    server.child.kill('SIGTERM');
    await new Promise((r) => server.child.once('close', r));
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}: ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
