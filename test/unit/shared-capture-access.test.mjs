import test from 'node:test';
import assert from 'node:assert/strict';
import { createPayPalClient } from '../../server/payments/paypal-client.mjs';
import { createPayPalSdkClient } from '../../server/payments/paypal-sdk-client.mjs';
import { createFakePayPal } from '../helpers/fake-paypal.mjs';
import { familyWith, startServer } from '../helpers/family-http.mjs';

// HTTP sessions and software passkeys are real; PayPal is a gated, stateful fake. The SDK case replaces only axios
// transport, retaining the pinned SDK's OAuth, controllers and serializers. No provider credentials/network are used.
const credentials = { clientId: 'fake-shared-client', clientSecret: 'fake-shared-secret' };
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
function clientFor(adapter, fetch) {
  if (adapter === 'rest') return createPayPalClient({ ...credentials, fetch });
  return createPayPalSdkClient({ ...credentials, restFetch: fetch, httpAdapter: async config => {
    const headers = Object.fromEntries(Object.entries(config.headers.toJSON?.() ?? config.headers));
    if (config.auth) headers.Authorization = `Basic ${Buffer.from(`${config.auth.username}:${config.auth.password}`).toString('base64')}`;
    const response = await fetch(config.url, { method: config.method.toUpperCase(), headers, body: config.data });
    const body = await response.json();
    if (new URL(config.url).pathname === '/v1/oauth2/token') body.token_type = 'Bearer';
    return { config, status: response.status, statusText: '', headers: Object.fromEntries(response.headers), data: JSON.stringify(body) };
  } });
}
const cases = [
  { name: 'first caller removed during OAuth', phase: 'oauth', remove: ['first'] },
  { name: 'second caller removed during OAuth', phase: 'oauth', remove: ['second'] },
  { name: 'both callers removed during OAuth', phase: 'oauth', remove: ['first', 'second'] },
  { name: 'both callers active during OAuth', phase: 'oauth', remove: [] },
  { name: 'first caller removed after dispatch', phase: 'capture', remove: ['first'] },
  { name: 'both callers removed after dispatch', phase: 'capture', remove: ['first', 'second'] },
  { name: 'a child cannot keep a removed adult capture alive', phase: 'oauth', remove: ['first'], joiner: 'child' },
  { name: 'another family cannot keep a removed adult capture alive', phase: 'oauth', remove: ['first'], joiner: 'outsider' },
];

for (const adapter of ['rest', 'sdk']) for (const c of cases) {
  test(`[${adapter}] ${c.name}: one shared capture, independent private responses`, { timeout: 10_000 }, async () => {
    const entered = gate(), joined = gate(), finish = gate(), fake = createFakePayPal(), pending = [];
    let armed = false;
    const fetch = async (url, init) => {
      const path = new URL(url).pathname;
      if (armed && (c.phase === 'oauth' ? path === '/v1/oauth2/token' : path.endsWith('/capture'))) { entered.release(); await finish.promise; }
      return fake.fetch(url, init);
    };
    let current = clientFor(adapter, fetch);
    const paypal = { environment: 'sandbox', ...Object.fromEntries(['createOrder', 'captureOrder', 'getOrder', 'getCapture', 'refundCapture'].map(name => [name, (...args) => current[name](...args)])) };
    const s = await startServer({ paypal, env: { PAYPAL_CLIENT_ID: credentials.clientId, PAYPAL_CLIENT_SECRET: credentials.clientSecret } });
    try {
      const { owner, Ash: first, Briar: localSecond } = await familyWith(s, [['Ash', 'adult'], ['Briar', c.joiner === 'child' ? 'child' : 'adult']]);
      const second = c.joiner === 'outsider' ? (await familyWith(s)).owner : localSecond;
      const firstId = (await first.call('GET', '/api/state')).json.access.me.memberId;
      const secondId = (await localSecond.call('GET', '/api/state')).json.access.me.memberId;
      const before = (await owner.call('GET', '/api/state')).json;
      const goal = await owner.call('PUT', '/api/goal', { name: 'Shared fixture goal', targetCents: 30000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: before.goal.targetDate, expectedGoalRevision: before.merchantGoalRevision });
      assert.equal(goal.status, 200, JSON.stringify(goal.json));
      const created = await first.call('POST', '/api/paypal/orders', { amountCents: 1500, approvalConfirmed: true, requestId: 'shared-fixture-order-1' });
      assert.equal(created.status, 200, JSON.stringify(created.json));
      const url = `/api/paypal/orders/${created.json.orderId}/capture`;
      // Observe the service after it has synchronously entered/joined the work, not merely when HTTP headers arrive.
      // This adds no production seam and avoids sleeps or a race with request-body parsing.
      const capture = s.app.contributions.capturePayPalOrder.bind(s.app.contributions);
      let callers = 0;
      s.app.contributions.capturePayPalOrder = input => { const work = capture(input); if (++callers === 2) joined.release(); return work; };
      current = clientFor(adapter, fetch); armed = true;
      const firstRequest = first.call('POST', url, {}); pending.push(firstRequest);
      await entered.promise;
      const secondRequest = second.call('POST', url, {}); pending.push(secondRequest);
      if (c.joiner) assert.equal((await secondRequest).status, c.joiner === 'child' ? 403 : 409);
      else await joined.promise;
      for (const who of c.remove) assert.equal((await owner.call('POST', `/api/family/members/${who === 'first' ? firstId : secondId}/revoke`, {})).status, 200);
      finish.release();
      const [a, b] = await Promise.all(pending);
      assert.equal(a.status, c.remove.includes('first') ? 401 : 200);
      const bStatus = c.joiner ? (c.joiner === 'child' ? 403 : 409) : c.remove.includes('second') ? 401 : 200;
      assert.equal(b.status, bStatus, 'each caller gets the result allowed by their own access');
      for (const response of [a, b]) if (response.status !== 200) {
        assert.equal(response.json.state, undefined); assert.equal(response.json.contribution, undefined);
      }
      const shouldCapture = c.phase === 'capture' || (!c.joiner && c.remove.length < 2);
      const state = (await owner.call('GET', '/api/state')).json;
      const captures = () => fake.requests.filter(r => r.pathname.endsWith('/capture')).length;
      assert.equal(captures(), shouldCapture ? 1 : 0);
      assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'contribution'").get().n, shouldCapture ? 1 : 0);
      assert.equal(state.progress.progressCents, shouldCapture ? 7500 : 6000);
      assert.equal(state.board.builtTier, shouldCapture ? 1 : 0);
      // The shared entry is released on both success and refusal: an owner can recover the original record exactly
      // once. No replacement order or automatic payment retry is involved.
      const recovered = await owner.call('POST', url, {});
      assert.equal(recovered.status, 200, JSON.stringify(recovered.json));
      assert.equal(captures(), 1);
      assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'contribution'").get().n, 1);
      assert.equal(recovered.json.state.progress.progressCents, 7500);
    } finally { finish.release(); await Promise.allSettled(pending); await s.close(); }
  });
}
