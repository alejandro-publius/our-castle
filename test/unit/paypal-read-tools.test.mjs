import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import { createPayPalReadTools, READ_ONLY_ACTIONS } from '../../server/steward/paypal-tools.mjs';

// The Toolkit's published default is CommonJS; stub its actual Axios instance, not the ESM entry.
const axios = createRequire(import.meta.resolve('@paypal/agent-toolkit/openai'))('axios');
const orderId = '5O190127TN364715T';
const fakeKit = (handleToolCall, base = 'https://api.sandbox.paypal.com') => ({
  client: { getBaseUrl: () => base },
  getTools: () => ['get_order', 'list_transactions'].map((name) => ({ function: { name } })),
  handleToolCall,
});

function forbidNetwork(t) {
  const blocked = () => { throw new Error('Network is forbidden in this test.'); };
  t.mock.method(http, 'request', blocked);
  t.mock.method(https, 'request', blocked);
  t.mock.method(globalThis, 'fetch', blocked);
}

test('the real pinned Toolkit authenticates once and makes only the two sandbox reads through a fake transport', async (t) => {
  forbidNetwork(t);
  const calls = [];
  const originalAdapter = axios.defaults.adapter;
  t.after(() => { axios.defaults.adapter = originalAdapter; });
  axios.defaults.adapter = async (config) => {
    const url = new URL(config.url);
    assert.equal(url.origin, 'https://api.sandbox.paypal.com');
    calls.push({ method: config.method, url, authorization: config.headers.get('Authorization') });
    let data;
    if (config.method === 'post' && url.pathname === '/v1/oauth2/token') {
      assert.equal(config.data, 'grant_type=client_credentials');
      data = { access_token: 'fake-read-test-token', expires_in: 3600 };
    } else if (config.method === 'get' && url.pathname === `/v2/checkout/orders/${orderId}`) {
      data = { id: orderId, status: 'COMPLETED', purchase_units: [] };
    } else if (config.method === 'get' && url.pathname === '/v1/reporting/transactions') {
      assert.equal(url.searchParams.get('start_date'), '2026-10-05T20:00:00.000Z');
      assert.equal(url.searchParams.get('end_date'), '2026-11-05T20:00:00.000Z');
      assert.equal(url.searchParams.get('transaction_status'), 'S');
      data = { transaction_details: [], total_items: 0 };
    } else throw new Error(`Unexpected toolkit request: ${config.method} ${url.pathname}`);
    return { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, config, data };
  };
  const tools = createPayPalReadTools({ clientId: 'fake-client', clientSecret: 'fake-secret', now: () => new Date('2026-11-05T20:00:00Z') });
  assert.deepEqual(tools.tools.sort(), ['get_order', 'list_transactions']);
  const order = await tools.getOrder(orderId);
  assert.equal(order.error, undefined);
  assert.equal(order.id, orderId);
  assert.equal((await tools.listTransactions({ days: 100, status: 'invalid' })).total_items, 0);
  assert.deepEqual(calls.map((c) => c.method), ['post', 'get', 'get']);
  assert.ok(calls.slice(1).every((c) => c.authorization === 'Bearer fake-read-test-token'));
});

test('a stalled read times out once; a late result cannot replace that error', { timeout: 1000 }, async () => {
  let finish, calls = 0;
  const pending = new Promise((resolve) => { finish = resolve; });
  const tools = createPayPalReadTools({ toolkit: fakeKit(() => { calls++; return pending; }), timeoutMs: 10 });
  const answer = tools.getOrder(orderId);
  await assert.rejects(answer, { code: 'PAYPAL_TOOL_TIMEOUT' });
  finish({ content: JSON.stringify({ id: orderId, status: 'COMPLETED' }) });
  await assert.rejects(answer, { code: 'PAYPAL_TOOL_TIMEOUT' });
  assert.equal(calls, 1, 'no automatic retry');
});

test('sandbox checks reject lookalike hosts, unsafe URLs and invalid deadline settings before any read', () => {
  const handle = () => { throw new Error('Must not read'); };
  for (const base of ['https://api.paypal.com', 'https://api.sandbox.paypal.com.evil.test', 'http://api.sandbox.paypal.com', 'https://x@api.sandbox.paypal.com', 'https://api.sandbox.paypal.com:444', 'https://api.sandbox.paypal.com/other', 'https://api.sandbox.paypal.com?redirect=1']) {
    assert.throws(() => createPayPalReadTools({ toolkit: fakeKit(handle, base) }), /sandbox/);
  }
  for (const timeoutMs of [0, -1, 1.5, Infinity, 2_147_483_648]) {
    assert.throws(() => createPayPalReadTools({ toolkit: fakeKit(handle), timeoutMs }), /timeout/);
  }
});

test('tool errors and malformed responses remain errors and do not leave deadline timers running', async () => {
  const error = new Error('Fake transport failed');
  const failed = createPayPalReadTools({ toolkit: fakeKit(async () => { throw error; }) });
  await assert.rejects(failed.getOrder(orderId), (e) => e === error);
  const invalid = createPayPalReadTools({ toolkit: fakeKit(async () => ({ content: 'not JSON' })) });
  assert.match((await invalid.getOrder(orderId)).error.message, /non-JSON/);
});

test('the scoped LangChain patch preserves the official Toolkit adapter and read-only schema construction', async (t) => {
  forbidNetwork(t);
  const { PayPalAgentToolkit } = await import('@paypal/agent-toolkit/langchain');
  const kit = new PayPalAgentToolkit({ clientId: 'fake-client', clientSecret: 'fake-secret', configuration: { actions: READ_ONLY_ACTIONS, context: { sandbox: true } } });
  assert.deepEqual(kit.getTools().map((tool) => tool.name).sort(), ['get_order', 'list_transactions']);
  assert.equal(kit.client.getBaseUrl(), 'https://api.sandbox.paypal.com');
});
