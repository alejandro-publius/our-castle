import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const collection = JSON.parse(readFileSync(new URL('../../postman/our-castle.postman_collection.json', import.meta.url), 'utf8'));
const environment = JSON.parse(readFileSync(new URL('../../postman/our-castle.postman_environment.json', import.meta.url), 'utf8'));
const requests = collection.item.flatMap((folder) => folder.item);

test('Postman collection is a v2.1 collection whose requests all carry assertions', () => {
  assert.equal(collection.info.schema, 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json');
  assert.equal(collection.item.length, 2);
  assert.ok(requests.length >= 20);
  for (const r of requests) {
    const tests = (r.event ?? []).find((e) => e.listen === 'test');
    assert.ok(tests?.script.exec.some((line) => line.includes('pm.test(')), `${r.name} has no assertions`);
    const url = typeof r.request.url === 'string' ? r.request.url : r.request.url.raw;
    assert.match(url, /^\{\{(baseUrl|exampleBaseUrl|paypalApiBase)\}\}\//, `${r.name} must use a variable base URL`);
  }
});

test('Postman environment is sandbox-only and ships without credentials', () => {
  const values = Object.fromEntries(environment.values.map((v) => [v.key, v]));
  assert.equal(values.paypalApiBase.value, 'https://api-m.sandbox.paypal.com');
  assert.equal(values.paypalClientId.value, '');
  assert.equal(values.paypalClientSecret.value, '');
  assert.equal(values.paypalClientSecret.type, 'secret');
  const text = JSON.stringify({ collection, environment });
  assert.ok(!/api-m\.paypal\.com|api\.paypal\.com/.test(text), 'no live PayPal endpoint appears');
  assert.ok(!/sk-ant-|Bearer [A-Za-z0-9]{20,}/.test(text), 'no keys or tokens are embedded');
});

const [exampleFolder, sandboxFolder] = collection.item;
const urlOf = (r) => (typeof r.request.url === 'string' ? r.request.url : r.request.url.raw);

test('the example folder targets its own throwaway server, never the sandbox app default', () => {
  const values = Object.fromEntries(environment.values.map((v) => [v.key, v.value]));
  const collectionVars = Object.fromEntries(collection.variable.map((v) => [v.key, v.value]));
  for (const vars of [values, collectionVars]) {
    assert.equal(vars.exampleBaseUrl, 'http://localhost:3134');
    assert.equal(vars.baseUrl, 'http://localhost:3010', 'the sandbox folder keeps the app default');
  }
  for (const r of exampleFolder.item) assert.match(urlOf(r), /^\{\{exampleBaseUrl\}\}\//, `${r.name} must use exampleBaseUrl`);
  for (const r of sandboxFolder.item) assert.doesNotMatch(urlOf(r), /exampleBaseUrl/, `${r.name} is a sandbox request`);
});

const prerequest = (folder) => folder.event.find((e) => e.listen === 'prerequest').script.exec.join('\n');

test('each folder has its own guard: the example guard checks modes, the sandbox guard only checks the opt-in', () => {
  assert.match(prerequest(exampleFolder), /exampleBaseUrl/);
  assert.doesNotMatch(prerequest(exampleFolder), /allowSandboxRequests/);
  assert.match(prerequest(sandboxFolder), /allowSandboxRequests/);
  assert.doesNotMatch(prerequest(sandboxFolder), /exampleBaseUrl|sendRequest/, 'the sandbox guard sends nothing of its own');
});

test('sandbox requests are off in every committed default', () => {
  const values = Object.fromEntries(environment.values.map((v) => [v.key, v.value]));
  const collectionVars = Object.fromEntries(collection.variable.map((v) => [v.key, v.value]));
  assert.equal(values.allowSandboxRequests, '');
  assert.equal(collectionVars.allowSandboxRequests, '');
});

// Run a folder-level guard exactly as written, against a stubbed pm API.
function runScript(script, variables, requestName, answer) {
  const seen = { tests: [], skipped: false, next: undefined, sent: [] };
  const pm = {
    variables: { get: (key) => variables[key] },
    info: { requestName },
    test: (name, fn) => { try { fn(); seen.tests.push({ name, passed: true }); } catch { seen.tests.push({ name, passed: false }); } },
    execution: { setNextRequest: (v) => { seen.next = v; }, skipRequest: () => { seen.skipped = true; } },
    sendRequest: (request, callback) => { seen.sent.push(request); answer(callback); },
  };
  vm.runInNewContext(script, { pm, JSON });
  return seen;
}
const runGuard = (exampleBaseUrl, answer) => runScript(prerequest(exampleFolder), { exampleBaseUrl }, '1.1 Reset the example household', answer);
const reply = (code, body) => (cb) => cb(null, { code, json: () => (typeof body === 'function' ? body() : body) });
const blocked = (seen) => seen.skipped && seen.next === null && seen.tests.length === 1 && !seen.tests[0].passed && seen.tests[0].name.startsWith('BLOCKED "1.1 Reset the example household" (not sent)');

test('the example folder guard sends only when /api/status confirms example payments AND example AI', () => {
  const ok = runGuard('http://127.0.0.1:3134', reply(200, { payments: { mode: 'example' }, ai: { mode: 'example' } }));
  assert.deepEqual(JSON.parse(JSON.stringify(ok.sent)), [{ url: 'http://127.0.0.1:3134/api/status', method: 'GET' }]); // created in the vm realm
  assert.equal(ok.skipped, false);
  assert.equal(ok.next, undefined);
  assert.deepEqual(ok.tests, [{ name: 'example payments and example AI confirmed by /api/status before sending', passed: true }]);
});

test('the example folder guard fails closed: skips the request, fails the run and stops it', () => {
  const cases = {
    'sandbox payments': reply(200, { payments: { mode: 'sandbox' }, ai: { mode: 'example' } }),
    'live AI with example payments': reply(200, { payments: { mode: 'example' }, ai: { mode: 'live', model: 'claude-opus-5-5' } }),
    'sandbox payments and live AI': reply(200, { payments: { mode: 'sandbox' }, ai: { mode: 'live' } }),
    unreachable: (cb) => cb(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
    'HTTP 500': reply(500, { error: 'boom' }),
    'HTTP 404': reply(404, {}),
    'not JSON': reply(200, () => { throw new SyntaxError('Unexpected token <'); }),
    'empty object': reply(200, {}),
    null: reply(200, null),
    'modes as strings': reply(200, { payments: 'example', ai: 'example' }),
    'only payments': reply(200, { payments: { mode: 'example' } }),
    'no response object': (cb) => cb(null, undefined),
  };
  for (const [name, answer] of Object.entries(cases)) assert.ok(blocked(runGuard('http://127.0.0.1:3134', answer)), `${name} must block`);
  for (const value of [undefined, '', 'localhost:3134', 'http://localhost:3134/', 'http://localhost:3010/api', 'ftp://localhost:3134']) {
    const seen = runGuard(value, () => assert.fail('no request may be sent for a malformed exampleBaseUrl'));
    assert.ok(blocked(seen), `exampleBaseUrl ${JSON.stringify(value)} must block`);
    assert.equal(seen.sent.length, 0);
  }
});

test('the sandbox folder guard sends nothing unless allowSandboxRequests is exactly "yes"', () => {
  const noRequest = () => assert.fail('the sandbox guard must not send a request of its own');
  for (const value of [undefined, '', 'no', 'true', '1', 'YES', 'Yes', ' yes', 'yes ', 'y']) {
    const seen = runScript(prerequest(sandboxFolder), { allowSandboxRequests: value }, '2.2 Create a sandbox order (the server sets the amount)', noRequest);
    assert.ok(seen.skipped && seen.next === null, `${JSON.stringify(value)} must skip and stop`);
    assert.equal(seen.tests.length, 1);
    assert.equal(seen.tests[0].passed, false);
    assert.ok(seen.tests[0].name.startsWith('BLOCKED "2.2 Create a sandbox order (the server sets the amount)" (not sent)'));
    assert.equal(seen.sent.length, 0);
  }
  const allowed = runScript(prerequest(sandboxFolder), { allowSandboxRequests: 'yes' }, '2.2 Create a sandbox order (the server sets the amount)', noRequest);
  assert.equal(allowed.skipped, false);
  assert.equal(allowed.next, undefined);
  assert.deepEqual(allowed.tests, [{ name: 'sandbox requests explicitly allowed for this run (allowSandboxRequests=yes)', passed: true }]);
});
