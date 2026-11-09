import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { clientTokenDomains, createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { createClock } from '../../server/household.mjs';
import { createPayPalClient } from '../../server/payments/paypal-client.mjs';
import { createFakePayPal, webhookHeaders } from '../helpers/fake-paypal.mjs';
import { FIXED_NOW } from '../helpers/setup.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SECRETS = { PAYPAL_CLIENT_SECRET: 'paypal-secret-value-7f3a91', AI_API_KEY: 'sk-ant-api-secret-value-0c1d', KIT_OPENAI_API_KEY: 'kit-openai-secret-value-5b2e' };

async function startServer({ sandbox = false, paypalOptions = {} } = {}) {
  const env = sandbox
    ? { PAYPAL_CLIENT_ID: 'public-sandbox-client-id', PAYPAL_CLIENT_SECRET: SECRETS.PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID: 'WH-TEST', AI_API_KEY: SECRETS.AI_API_KEY, KIT_OPENAI_API_KEY: SECRETS.KIT_OPENAI_API_KEY }
    : {};
  const config = loadConfig(env, { root });
  const fake = sandbox ? createFakePayPal(paypalOptions) : null;
  const paypal = fake ? createPayPalClient({ clientId: config.payments.clientId, clientSecret: config.payments.clientSecret, fetch: fake.fetch }) : null;
  const aiProvider = sandbox ? { provider: 'anthropic', model: 'claude-opus-5-5', proposePlan: async () => { throw new Error('not used'); } } : null;
  const db = openDatabase(':memory:');
  const app = createApp({ config, db, clock: createClock(FIXED_NOW), paypal, aiProvider, root });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* static file */ }
    return { status: response.status, text, json, headers: response.headers };
  };
  return { call, fake, base, close: () => new Promise((r) => { server.close(r); db.close(); }) };
}

const setup = (s) => s.call('POST', '/api/setup', { playMode: 'family', name: 'House of Alder', crest: { field: 'emerald', charge: 'leaf' } });

test('secrets from the server env never reach the browser', async () => {
  const s = await startServer({ sandbox: true });
  try {
    await setup(s);
    const paths = ['/', '/index.html', '/app.css', '/src/app/main.js', '/src/app/paypal-checkout.js', '/api/state', '/api/status', '/api/paypal/config'];
    for (const path of paths) {
      const { status, text } = await s.call('GET', path);
      assert.equal(status, 200, path);
      for (const secret of Object.values(SECRETS)) assert.ok(!text.includes(secret), `${path} leaked a secret`);
    }
    const config = await s.call('GET', '/api/paypal/config');
    assert.deepEqual(config.json, { mode: 'sandbox', clientId: 'public-sandbox-client-id', sdkUrl: 'https://www.sandbox.paypal.com/web-sdk/v6/core', currency: 'USD' });
    for (const path of ['/.env', '/.env.example', '/server/config.mjs', '/data/our-castle-sandbox.sqlite', '/package.json', '/node_modules/@anthropic-ai/sdk/package.json', '/src/../server/app.mjs']) {
      assert.equal((await s.call('GET', path)).status, 404, path);
    }
  } finally { await s.close(); }
});

test('the app page sends a CSP that allows only itself plus the PayPal sandbox family in sandbox mode', async () => {
  const example = await startServer();
  const sandbox = await startServer({ sandbox: true });
  try {
    const exampleCsp = (await example.call('GET', '/')).headers.get('content-security-policy');
    assert.match(exampleCsp, /script-src 'self' 'sha256-[^']+'/);
    assert.match(exampleCsp, /frame-src 'none'/);
    assert.ok(!exampleCsp.includes('paypal'));
    const sandboxCsp = (await sandbox.call('GET', '/')).headers.get('content-security-policy');
    assert.match(sandboxCsp, /script-src 'self' 'sha256-[^']+' https:\/\/\*\.paypal\.com/);
    assert.match(sandboxCsp, /frame-ancestors 'none'/);
  } finally { await example.close(); await sandbox.close(); }
});

test('cross-site writes, rebinding hosts and non-JSON bodies are refused', async () => {
  const s = await startServer();
  try {
    assert.equal((await s.call('POST', '/api/setup', { playMode: 'solo', name: 'Evil', crest: { field: 'cobalt', charge: 'stag' } }, { Origin: 'https://evil.example' })).status, 403);
    const rebinding = await new Promise((resolve) => {
      const req = http.request(`${s.base}/api/state`, { headers: { Host: 'attacker.example:80' } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.end();
    });
    assert.equal(rebinding, 403);
    assert.equal((await s.call('POST', '/api/setup', 'playMode=solo', { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await s.call('POST', '/api/setup', '{not json')).status, 400);
    assert.equal((await s.call('POST', '/api/setup', 'x'.repeat(70_000))).status, 413);
    assert.equal((await s.call('GET', '/api/nope')).status, 404);
  } finally { await s.close(); }
});

test('sandbox HTTP flow: server-created order, capture credits once, mismatches are rejected', async () => {
  const s = await startServer({ sandbox: true });
  try {
    const { json: initial } = await setup(s);
    const { householdId, goalId } = { householdId: initial.state.household.id, goalId: initial.state.goal.id };
    const order = await s.call('POST', '/api/paypal/orders', { householdId, goalId, amountCents: 1500, approverId: 'm_rowan', approvalConfirmed: true, requestId: 'http-test-request-1' });
    assert.equal(order.status, 200);
    assert.match(order.json.orderId, /^ORDER/);

    const mismatch = await s.call('POST', `/api/paypal/orders/${order.json.orderId}/capture`, { householdId: 'hh_other', goalId });
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.json.error.code, 'order_mismatch');

    const captured = await s.call('POST', `/api/paypal/orders/${order.json.orderId}/capture`, { householdId, goalId });
    assert.equal(captured.json.outcome, 'completed');
    assert.equal(captured.json.state.progress.progressCents, 7500);
    assert.equal(captured.json.state.board.position, 5);
    assert.equal(captured.json.state.board.builtTier, 1);
    assert.equal(captured.json.state.contributions[0].simulated, false);

    const replay = await s.call('POST', `/api/paypal/orders/${order.json.orderId}/capture`, { householdId, goalId });
    assert.equal(replay.json.outcome, 'already_completed');
    assert.equal(replay.json.state.progress.progressCents, 7500);

    // The browser cannot "report" success: there is no endpoint that credits without a provider capture.
    const forged = await s.call('POST', '/api/example/contributions', { householdId, goalId, amountCents: 1500, approverId: 'm_rowan', approvalConfirmed: true, requestId: 'forged-request-01' });
    assert.equal(forged.status, 409);
    assert.equal(forged.json.error.code, 'wrong_mode');
    assert.equal((await s.call('POST', '/api/demo/reset', {})).status, 403);
    assert.equal((await s.call('GET', '/api/state')).json.progress.progressCents, 7500);
  } finally { await s.close(); }
});

test('client-token domains follow PayPal\'s format: bare domain names only, none for local hosts', async () => {
  assert.deepEqual(clientTokenDomains('localhost:3010'), []);
  assert.deepEqual(clientTokenDomains('127.0.0.1:3010'), []);
  assert.deepEqual(clientTokenDomains('[::1]:3010'), []);
  assert.deepEqual(clientTokenDomains('house.localhost'), []);
  assert.deepEqual(clientTokenDomains(undefined), []);
  assert.deepEqual(clientTokenDomains('Our-Castle.example.com:443'), ['our-castle.example.com']);

  const s = await startServer({ sandbox: true });
  try {
    const token = await s.call('POST', '/api/paypal/client-token', {});
    assert.equal(token.status, 200, token.text);
    assert.equal(token.json.accessToken, 'client-token-fake');
    const sent = s.fake.requests.findLast((r) => r.pathname === '/v1/oauth2/token');
    const params = new URLSearchParams(String(sent.body));
    assert.equal(params.get('response_type'), 'client_token');
    assert.deepEqual(params.getAll('domains[]'), [], 'a local host must not be sent as a domain');
  } finally { await s.close(); }
});

test('the public API cannot mark a bill provider-verified: extra flags are ignored and no verify route exists', async () => {
  const s = await startServer();
  try {
    await setup(s);
    const before = (await s.call('GET', '/api/state')).json;
    assert.equal(before.rewards.billVerification.status, 'not_connected');
    const posted = await s.call('POST', '/api/entries', {
      kind: 'bill_paid', amountCents: 14200, label: 'SDG&E electricity bill',
      verified: true, providerVerified: true, source: 'provider', provider: 'sdge', status: 'unlocked',
    });
    assert.equal(posted.status, 200);
    const after = posted.json.state;
    assert.equal(after.progress.progressCents, before.progress.progressCents, 'a bill never changes saved progress');
    assert.equal(after.ledger.bills.at(-1).source, 'user-reported', 'the server records the bill as user-reported regardless of the request');
    assert.equal(after.rewards.entries.find((r) => r.id === 'habit:garden').status, 'unlocked');
    for (const id of ['bill:electricity', 'bill:water']) assert.equal(after.rewards.entries.find((r) => r.id === id).status, 'connection_required');
    assert.ok(after.rewards.entries.every((r) => r.providerVerified === false));
    for (const path of ['/api/rewards/bill:electricity/verify', '/api/bills/verify', '/api/rewards']) {
      assert.equal((await s.call('POST', path, { verified: true })).status, 404, `${path} does not exist`);
    }
  } finally { await s.close(); }
});

test('webhook route skips the browser origin check but requires PayPal signature verification', async () => {
  const s = await startServer({ sandbox: true, paypalOptions: { webhookVerification: 'FAILURE' } });
  try {
    const event = JSON.stringify({ id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} });
    const unverified = await s.call('POST', '/api/paypal/webhook', event, { ...webhookHeaders, 'Content-Type': 'application/json' });
    assert.equal(unverified.status, 400);
    assert.equal(unverified.json.error.code, 'invalid_signature');
    assert.ok(s.fake.requests.some((r) => r.pathname === '/v1/notifications/verify-webhook-signature'));
  } finally { await s.close(); }
});

test('plans endpoint in example mode returns a labeled rules plan and applies goal edits', async () => {
  const s = await startServer();
  try {
    await setup(s);
    const res = await s.call('POST', '/api/plans', {
      goal: { name: 'Camping trip fund', targetCents: 30000, startingCents: 6000, targetDate: '2026-12-29', weeklyBudgetCents: 3000 },
      commitments: [{ label: 'Internet bill', amountCents: 6000, cadence: 'monthly' }],
    });
    assert.equal(res.json.status, 'ok');
    assert.equal(res.json.plan.source, 'rules');
    assert.equal(res.json.state.modes.ai.mode, 'example');
    const accepted = await s.call('POST', `/api/plans/${res.json.plan.id}/accept`, {});
    assert.equal(accepted.json.state.acceptedPlanId, res.json.plan.id);
    assert.equal(accepted.json.state.nextStep.week, 1);
    assert.equal(accepted.json.state.nextStep.dueCents, 3000);
    const bad = await s.call('POST', '/api/plans', { goal: { name: 'x', targetCents: -1, startingCents: 0, targetDate: 'soon', weeklyBudgetCents: 0 }, commitments: [] });
    assert.equal(bad.status, 400);
  } finally { await s.close(); }
});


test('member appearance HTTP changes one cosmetic field and cannot grant adult approval', async () => {
  const s = await startServer();
  try {
    const { json: initial } = await setup(s);
    const before = initial.state;
    assert.equal((await s.call('PUT','/api/members/m_wren/avatar',{avatarId:'knight',role:'adult',amountCents:99999})).status,200);
    const {json:after}=await s.call('GET','/api/state');
    assert.equal(after.members.find(m=>m.id==='m_wren').avatarId,'knight');
    assert.equal(after.members.find(m=>m.id==='m_wren').role,'child');
    assert.deepEqual(after.members.find(m=>m.id==='m_rowan'),before.members.find(m=>m.id==='m_rowan'));
    assert.deepEqual(after.progress,before.progress);assert.deepEqual(after.board,before.board);
    assert.equal((await s.call('PUT','/api/members/m_rowan/avatar',{avatarId:'wizard'},{Origin:'https://evil.example'})).status,403);
    assert.equal((await s.call('PUT','/api/members/foreign/avatar',{avatarId:'wizard'})).status,404);
    assert.equal((await s.call('PUT','/api/members/m_rowan/avatar',{avatarId:'missing'})).status,400);
    const rejected=await s.call('POST','/api/example/contributions',{householdId:before.household.id,goalId:before.goal.id,amountCents:1500,approverId:'m_wren',approvalConfirmed:true,requestId:'avatar-child-rejection'});
    assert.equal(rejected.status,403);
    assert.equal(rejected.json.error.code,'adult_approval_required');
    assert.equal((await s.call('GET','/api/state')).json.contributions.length,0);
  } finally {await s.close();}
});

// A contribution names its household, goal and request by id, and the server never guesses one. Without a session to
// supply them (example-persona mode), a missing or non-text id must be a refusal, not an internal error.
test('malformed example contributions are refused with a 4xx and record nothing; a well-formed one still counts once', async () => {
  const s = await startServer();
  try {
    await setup(s);
    const { household, goal } = (await s.call('GET', '/api/state')).json;
    const valid = { householdId: household.id, goalId: goal.id, amountCents: 1500, approverId: 'm_rowan', approvalConfirmed: true };
    const records = async () => { const state = (await s.call('GET', '/api/state')).json; return { progress: state.progress.progressCents, contributions: state.contributions.length }; };
    const before = await records();
    let n = 0;
    const id = () => `malformed-request-${String(++n).padStart(3, '0')}`;
    for (const [label, body, status, code] of [
      ['no household', { ...valid, householdId: undefined, requestId: id() }, 400, 'invalid_owner'],
      ['no goal', { ...valid, goalId: undefined, requestId: id() }, 400, 'invalid_owner'],
      ['neither id', { ...valid, householdId: undefined, goalId: undefined, requestId: id() }, 400, 'invalid_owner'],
      ['null household', { ...valid, householdId: null, requestId: id() }, 400, 'invalid_owner'],
      ['numeric household', { ...valid, householdId: 7, requestId: id() }, 400, 'invalid_owner'],
      ['null goal', { ...valid, goalId: null, requestId: id() }, 400, 'invalid_owner'],
      ['object goal', { ...valid, goalId: { id: goal.id }, requestId: id() }, 400, 'invalid_owner'],
      ['empty household', { ...valid, householdId: '', requestId: id() }, 404, 'not_found'],
      ['no request id', { ...valid }, 400, 'invalid_request_id'],
      ['numeric request id', { ...valid, requestId: 12345678 }, 400, 'invalid_request_id'],
    ]) {
      const res = await s.call('POST', '/api/example/contributions', body);
      assert.deepEqual([res.status, res.json?.error?.code], [status, code], label);
    }
    assert.deepEqual(await records(), before, 'nothing was recorded for any malformed request');
    const good = { ...valid, requestId: 'well-formed-request-001' };
    assert.equal((await s.call('POST', '/api/example/contributions', good)).json.outcome, 'completed');
    assert.equal((await s.call('POST', '/api/example/contributions', good)).json.outcome, 'already_processed');
    // A malformed retry of that same request id is still the existing conflict, never a second record.
    assert.equal((await s.call('POST', '/api/example/contributions', { ...good, householdId: undefined })).json.error.code, 'request_conflict');
    assert.deepEqual(await records(), { progress: before.progress + 1500, contributions: before.contributions + 1 });
  } finally { await s.close(); }
});

test('a malformed sandbox order is refused with a 4xx before any PayPal request', async () => {
  const s = await startServer({ sandbox: true });
  try {
    const { json: initial } = await setup(s);
    const valid = { householdId: initial.state.household.id, goalId: initial.state.goal.id, amountCents: 1500, approverId: 'm_rowan', approvalConfirmed: true };
    const requests = s.fake.requests.length;
    for (const [label, body, code] of [
      ['no household', { ...valid, householdId: undefined, requestId: 'sandbox-malformed-001' }, 'invalid_owner'],
      ['null goal', { ...valid, goalId: null, requestId: 'sandbox-malformed-002' }, 'invalid_owner'],
      ['no request id', { ...valid }, 'invalid_request_id'],
    ]) {
      const res = await s.call('POST', '/api/paypal/orders', body);
      assert.deepEqual([res.status, res.json?.error?.code], [400, code], label);
    }
    assert.equal(s.fake.requests.length, requests, 'no PayPal request, not even OAuth');
    assert.equal((await s.call('GET', '/api/state')).json.contributions.length, 0);
    const order = await s.call('POST', '/api/paypal/orders', { ...valid, requestId: 'sandbox-well-formed-01' });
    assert.equal(order.status, 200);
    assert.equal(s.fake.orders.size, 1);
  } finally { await s.close(); }
});
