import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDemo } from '../../scripts/demo.mjs';

const script = fileURLToPath(new URL('../../scripts/demo.mjs', import.meta.url));
const get = async (url) => { const res = await fetch(url); assert.equal(res.status, 200); return res.json(); };
const post = async (url, body) => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: new URL(url).origin }, body: JSON.stringify(body) });
  assert.equal(res.status, 200); return res.json();
};

test('the demo CLI ignores configured keys, ports and data paths and stops cleanly', { timeout: 30_000 }, async () => {
  const folder = mkdtempSync(join(tmpdir(), 'castle-demo-test-'));
  const envFile = join(folder, '.env'), sentinel = join(folder, 'owner-record.txt');
  writeFileSync(envFile, 'PAYPAL_CLIENT_ID=not-a-key\nPAYPAL_CLIENT_SECRET=not-a-secret\nAI_API_KEY=not-a-key\nCHANNEL3_API_KEY=not-a-key\n');
  writeFileSync(sentinel, 'Owner data must stay unchanged.');
  const child = spawn(process.execPath, [script], { env: { ...process.env,
    OUR_CASTLE_ENV_FILE: envFile, OUR_CASTLE_DATA_DIR: folder, PORT: '3010', HOST: '0.0.0.0',
    PAYPAL_CLIENT_ID: 'invented-client', PAYPAL_CLIENT_SECRET: 'invented-secret', PAYPAL_ENV: 'sandbox',
    AI_API_KEY: 'invented-key', CHANNEL3_API_KEY: 'invented-key', AG_STUDIO_LICENSE_KEY: 'invented-key' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', stderr = ''; child.stderr.on('data', (b) => { stderr += b; });
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Demo did not print its URL')), 20_000);
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Demo exited early: ' + stderr)); });
      child.stdout.on('data', (b) => {
        output += b;
        const url = output.match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[0];
        if (url) { clearTimeout(timer); resolve(url); }
      });
    });
    assert.notEqual(new URL(url).port, '3010'); assert.notEqual(new URL(url).port, '3021');
    const modes = await get(url + '/api/status');
    assert.equal(modes.payments.mode, 'example'); assert.equal(modes.ai.mode, 'example'); assert.equal(modes.merchant.mode, 'off');
    const page = await fetch(url + '/'); assert.equal(page.status, 200); assert.match(await page.text(), /<title>Our Castle<\/title>/);
    assert.equal((await fetch(url + '/src/app/main.js')).status, 200);
    const licence = await get(url + '/api/treasury/studio'); assert.equal(licence.licenseKey, null);
    assert.match(output, /simulated payments/); assert.match(output, /Progress lasts until/);
    const exit = once(child, 'exit'); child.kill('SIGINT');
    assert.deepEqual(await exit, [0, null]);
    assert.equal(readFileSync(sentinel, 'utf8'), 'Owner data must stay unchanged.');
    assert.deepEqual(readdirSync(folder).sort(), ['.env', 'owner-record.txt']);
  } finally {
    if (child.exitCode === null) { const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit; }
    rmSync(folder, { recursive: true, force: true });
  }
});

test('two fresh demo sessions keep independent progress through refresh and close independently', async () => {
  const a = await startDemo(), b = await startDemo();
  try {
    assert.notEqual(a.url, b.url);
    const state = await get(a.url + '/api/state');
    await post(a.url + '/api/setup', { playMode: 'family', name: 'House of Test', crest: { field: 'cobalt', charge: 'stag' } });
    await post(a.url + '/api/example/contributions', { householdId: state.household.id, goalId: state.goal.id,
      amountCents: 1500, approverId: 'm_rowan', approvalConfirmed: true, requestId: crypto.randomUUID() });
    const after = await get(a.url + '/api/state');
    assert.equal(after.progress.progressCents, 7500); assert.equal(after.contributions.length, 1);
    assert.equal((await get(a.url + '/api/state')).progress.progressCents, 7500, 'a refresh retains this session');
    const other = await get(b.url + '/api/state');
    assert.equal(other.progress.progressCents, 6000); assert.equal(other.contributions.length, 0);
    await a.close(); await a.close();
    assert.equal((await get(b.url + '/api/state')).progress.progressCents, 6000);
  } finally { await a.close(); await b.close(); }
});

test('the demo listens elsewhere only when its own command line says so, and still answers only as this computer', { timeout: 30_000 }, async () => {
  // A setting that cannot be used is refused before anything starts; so is an option the demo does not know.
  for (const args of [['--port=abc'], ['--port=70000'], ['--port=-1'], ['--host='], ['--village-fund', '--nope']]) {
    const run = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 20_000 });
    assert.equal(run.status, 2, args.join(' '));
    assert.equal(run.stdout, '', args.join(' '));
  }
  // A container gives the demo a fixed port (and, there, all of the container's interfaces). Here: a free port, loopback.
  const port = await new Promise((resolve) => { const probe = net.createServer().listen(0, '127.0.0.1', () => { const { port: free } = probe.address(); probe.close(() => resolve(free)); }); });
  const demo = await startDemo({ port });
  try {
    assert.equal(demo.url, `http://127.0.0.1:${port}`);
    assert.equal((await get(demo.url + '/api/status')).payments.mode, 'example');
    // Wherever it listens, a request that names another host is refused: publishing the port does not publish the app.
    const status = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/api/status', headers: { Host: `demo.example.test:${port}` } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    assert.equal(status, 403);
  } finally { await demo.close(); }
});

test('a hosted example answers to its one public name over HTTPS, and to nothing else; only a keyless story can be hosted', { timeout: 30_000 }, async () => {
  // The option needs a usable name and a story: the blank demo and a malformed name are refused before anything starts.
  for (const args of [['--public-host=demo.example.test'], ['--family-trip', '--public-host='], ['--family-trip', '--public-host=bad host'], ['--family-trip', '--public-host=https://demo.example.test']]) {
    const run = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 20_000 });
    assert.equal(run.status, 2, args.join(' '));
    assert.equal(run.stdout, '', args.join(' '));
  }
  // The blank demo is refused in code too. (Were it to start, it is closed here so the failure is reported, not hung on.)
  const blank = await startDemo({ publicHost: 'demo.example.test' }).then((started) => started.close().then(() => 'started'), (error) => error.message);
  assert.match(blank, /only for a keyless example demo/);

  const demo = await startDemo({ familyTrip: true, publicHost: 'demo.example.test' });
  const port = Number(new URL(demo.url).port);
  // A request as the host's proxy passes it on: the public name in Host, and the browser's HTTPS origin on a write.
  const call = (method, path, headers, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers } }, (res) => {
      let text = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(text); } catch { return null; } })() }));
    }).on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
  try {
    assert.equal((await call('GET', '/', { Host: 'demo.example.test' })).status, 200);
    const state = await call('GET', '/api/state', { Host: 'demo.example.test' });
    assert.equal(state.status, 200);
    assert.equal(state.json.modes.payments.mode, 'example');
    const write = (headers) => call('POST', '/api/steward', headers, { memberId: 'm_rowan', question: 'Any contributions that need a PayPal check?' }); // answered from saved records
    assert.equal((await write({ Host: 'demo.example.test', Origin: 'https://demo.example.test' })).status, 200);
    // Not as plain HTTP, not from another site, and not under any other name.
    assert.equal((await write({ Host: 'demo.example.test', Origin: 'http://demo.example.test' })).json.error.code, 'origin_not_allowed');
    assert.equal((await write({ Host: 'demo.example.test', Origin: 'https://elsewhere.example.test' })).json.error.code, 'origin_not_allowed');
    assert.equal((await write({ Host: 'demo.example.test', Origin: 'https://demo.example.test', 'Sec-Fetch-Site': 'cross-site' })).json.error.code, 'origin_not_allowed');
    for (const host of ['elsewhere.example.test', 'demo.example.test.elsewhere.test', 'xdemo.example.test']) {
      assert.equal((await call('GET', '/api/state', { Host: host })).json.error.code, 'host_not_allowed', host);
    }
    // It still answers as this computer, as every demo does.
    assert.equal((await get(demo.url + '/api/status')).payments.mode, 'example');
  } finally { await demo.close(); }
});
