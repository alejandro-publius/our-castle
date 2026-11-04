// Prove the Postman collection's guards with the real Newman runtime (pinned to the tested 6.2.1), using only local
// stand-ins.
//
// Folder 1, example walkthrough:
// - logging mocks that report sandbox payments, live AI or a broken status must receive nothing but GET /api/status,
//   and each run must exit unsuccessfully;
// - a closed port and a malformed exampleBaseUrl must also block;
// - a fresh example-mode server (temporary database, no .env, no keys) behind a logging proxy must pass the folder,
//   with a status check before every request.
//
// Folder 2, sandbox walkthrough:
// - it is off by default. A whole-collection run, and a folder-2 run without allowSandboxRequests=yes, must send zero
//   requests to the logging stubs standing in for the app (baseUrl) and the PayPal API (paypalApiBase);
// - the opt-in path is exercised only against those stubs.
//
// It never targets port 3010 or PayPal, makes no AI call, and creates no sandbox order.
// Newman is not a dependency: set NEWMAN_BIN to newman/bin/newman.js, or `npx --yes newman@6.2.1 --version` once.
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
const SANDBOX_FOLDER = '2 · PayPal sandbox walkthrough (needs sandbox credentials)';
const NEWMAN_VERSION = '6.2.1';
const OWNER_APP_PORT = 3010;
const isStatusCall = (r) => r.method === 'GET' && r.url === '/api/status';

const versionOf = (bin) => JSON.parse(readFileSync(path.join(path.dirname(bin), '../package.json'), 'utf8')).version;
function findNewman() {
  if (process.env.NEWMAN_BIN) return process.env.NEWMAN_BIN;
  const cache = path.join(os.homedir(), '.npm/_npx');
  for (const entry of existsSync(cache) ? readdirSync(cache) : []) {
    const bin = path.join(cache, entry, 'node_modules/newman/bin/newman.js');
    if (existsSync(bin) && versionOf(bin) === NEWMAN_VERSION) return bin;
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

/** Run Newman. `folder` null runs the whole collection; `vars` become --env-var overrides. */
function runNewman(newman, exampleBaseUrl, reportFile, { folder = FOLDER, vars = {} } = {}) {
  const overrides = Object.entries({ exampleBaseUrl, ...vars }).flatMap(([k, v]) => ['--env-var', `${k}=${v}`]);
  const args = [newman, 'run', collection, '-e', environment, ...(folder ? ['--folder', folder] : []),
    ...overrides, '--reporters', 'json', '--reporter-json-export', reportFile];
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
        blockedCount: (run.failures ?? []).filter((f) => (f.error?.test ?? '').startsWith('BLOCKED')).length,
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
  console.error(`Newman ${NEWMAN_VERSION} was not found. Run \`npx --yes newman@${NEWMAN_VERSION} --version\` once, or set NEWMAN_BIN.`);
  process.exit(2);
}
const newmanVersion = versionOf(newman);
if (newmanVersion !== NEWMAN_VERSION) {
  console.error(`These guards were proven with Newman ${NEWMAN_VERSION}; NEWMAN_BIN points at ${newmanVersion}.`);
  process.exit(2);
}
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

  // Folder 2. Stubs stand in for every folder-2 destination: the app (baseUrl) and the PayPal API (paypalApiBase).
  // Newman's request count must equal what the local servers logged, so no request can have gone anywhere else.
  const sandboxStatus = { code: 200, body: JSON.stringify({ payments: { mode: 'sandbox' }, ai: { mode: 'example' } }) };
  const stubs = async () => {
    const app = await loggingServer({ statusReply: sandboxStatus });
    const paypal = await loggingServer({ statusReply: sandboxStatus });
    const vars = { baseUrl: `http://127.0.0.1:${app.port}`, paypalApiBase: `http://127.0.0.1:${paypal.port}` };
    return { app, paypal, vars, close: () => Promise.all([app.close(), paypal.close()]) };
  };

  // A. The whole collection by accident: folder 1 against a fresh example server, then folder 2 must stop at once.
  {
    const port2 = await freePort();
    const example = await startExampleServer(port2, mkdtempSync(path.join(work, 'data-')));
    const exampleProxy = await loggingServer({ forwardPort: port2 });
    const s = await stubs();
    try {
      const r = await runNewman(newman, `http://127.0.0.1:${exampleProxy.port}`, report(), { folder: null, vars: s.vars });
      const folder1 = exampleProxy.log.filter((x) => !isStatusCall(x)).length;
      const accounted = exampleProxy.log.length + s.app.log.length + s.paypal.log.length;
      check('whole collection, no opt-in: folder 1 runs, folder 2 sends nothing',
        r.code !== 0 && folder1 === 10 && s.app.log.length === 0 && s.paypal.log.length === 0 && r.requests === accounted
          && r.blockedCount === 1 && r.blocked.startsWith('BLOCKED "2.1 ') && r.failures.length === 1,
        `exit ${r.code}; example server received ${folder1} folder-1 requests; app stub ${s.app.log.length}, PayPal stub ${s.paypal.log.length}; Newman counted ${r.requests} requests, ${accounted} logged locally; only failure: "${r.failures[0]}"`);
    } finally {
      await s.close();
      await exampleProxy.close();
      example.child.kill('SIGTERM');
      await new Promise((r) => example.child.once('close', r));
    }
  }

  // B and C. Folder 2 alone: with no opt-in, and with a value that is not exactly "yes".
  for (const [label, extra] of [['folder 2, no opt-in', {}], ['folder 2, allowSandboxRequests="true"', { allowSandboxRequests: 'true' }]]) {
    const s = await stubs();
    const r = await runNewman(newman, 'http://127.0.0.1:9', report(), { folder: SANDBOX_FOLDER, vars: { ...s.vars, ...extra } });
    await s.close();
    check(`${label}: blocked`, r.code !== 0 && s.app.log.length === 0 && s.paypal.log.length === 0 && r.requests === 0 && r.blocked?.startsWith('BLOCKED "2.1 '),
      `exit ${r.code}; app stub ${s.app.log.length}, PayPal stub ${s.paypal.log.length}, Newman ${r.requests} requests; stopped after ${r.items} item(s)`);
  }

  // D. Opt-in acceptance, only against the stubs. Assertions fail on the stubs' fake replies; this proves the guard
  //    lets a deliberate run through, not that the sandbox works.
  {
    const s = await stubs();
    const r = await runNewman(newman, 'http://127.0.0.1:9', report(), { folder: SANDBOX_FOLDER, vars: { ...s.vars, allowSandboxRequests: 'yes' } });
    await s.close();
    const accounted = s.app.log.length + s.paypal.log.length;
    check('folder 2, allowSandboxRequests=yes, stubs only: requests pass the guard', s.app.log.length === 8 && s.paypal.log.length === 3 && r.requests === accounted && !r.blocked,
      `app stub ${s.app.log.length} (${s.app.log.slice(0, 2).map((x) => `${x.method} ${x.url}`).join(', ')}, …), PayPal stub ${s.paypal.log.length} (${s.paypal.log.map((x) => `${x.method} ${x.url.replace(/\/orders\/.+$/, '/orders/…')}`).join(', ')}); Newman counted ${r.requests}; no BLOCKED failure`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}: ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
