import test from 'node:test';
import assert from 'node:assert/strict';
import { createPayPalClient } from '../../server/payments/paypal-client.mjs';
import { createPayPalSdkClient } from '../../server/payments/paypal-sdk-client.mjs';
import { createFakePayPal } from '../helpers/fake-paypal.mjs';
import { familyWith, startServer } from '../helpers/family-http.mjs';

// Real family HTTP / software passkeys. The SDK runs its real auth, controllers and serializers, with only axios
// transport replaced. The REST adapter uses the same stateful fake provider. No external request can leave this test.
const credentials = { clientId: 'fake-dispatch-client', clientSecret: 'fake-dispatch-secret' };
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

for (const adapter of ['rest', 'sdk']) for (const operation of ['capture', 'refund']) for (const reason of ['revocation', 'idle expiry', 'sign-out', 'renewed sign-in', 'active']) {
  test(`[${adapter}] ${reason} during OAuth controls ${operation} dispatch`, { timeout: 10_000 }, async () => {
    const entered = gate(), finish = gate(), fake = createFakePayPal();
    let armed = false;
    const fetch = async (url, init) => {
      if (armed && new URL(url).pathname === '/v1/oauth2/token') { entered.release(); await finish.promise; }
      return fake.fetch(url, init);
    };
    let current = clientFor(adapter, fetch);
    const paypal = { environment: 'sandbox', ...Object.fromEntries(['createOrder', 'captureOrder', 'getOrder', 'getCapture', 'refundCapture'].map(name => [name, (...args) => current[name](...args)])) };
    const s = await startServer({ paypal, env: { PAYPAL_CLIENT_ID: credentials.clientId, PAYPAL_CLIENT_SECRET: credentials.clientSecret } });
    try {
      const { owner, Ash: adult } = await familyWith(s, [['Ash', 'adult']]);
      const before = (await adult.call('GET', '/api/state')).json;
      const created = await adult.call('POST', '/api/paypal/orders', { amountCents: 1500, approvalConfirmed: true, requestId: 'fake-dispatch-review-1' });
      assert.equal(created.status, 200, JSON.stringify(created.json));
      let url = `/api/paypal/orders/${created.json.orderId}/capture`;
      if (operation === 'refund') {
        const paid = await adult.call('POST', url, {});
        assert.equal(paid.status, 200, JSON.stringify(paid.json));
        url = `/api/paypal/captures/${paid.json.contribution.captures[0].captureId}/refund`;
      }
      const count = () => fake.requests.filter(r => r.pathname.endsWith(`/${operation}`)).length;
      const beforeDispatch = count(), beforeLedger = s.db.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get().n;
      // A fresh client models the cold OAuth cache after a process restart. The order/capture and fake provider persist.
      current = clientFor(adapter, fetch); armed = true;
      const pending = adult.call('POST', url, { approvalConfirmed: true });
      await entered.promise;
      if (reason === 'revocation') assert.equal((await owner.call('POST', `/api/family/members/${before.access.me.memberId}/revoke`, {})).status, 200);
      else if (reason === 'idle expiry') s.clock.advance(31 * 60_000);
      else if (reason === 'sign-out') assert.equal((await adult.call('POST', '/api/auth/signout', {})).status, 200);
      else if (reason === 'renewed sign-in') assert.equal((await adult.signIn()).done.status, 200);
      finish.release();
      const result = await pending;
      if (reason === 'active') {
        assert.equal(result.status, 200, JSON.stringify(result.json));
        assert.equal(count(), beforeDispatch + 1);
        assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get().n, beforeLedger + 1);
        assert.equal(result.json.state.progress.confirmedNetCents, operation === 'capture' ? 1500 : 0);
        return;
      }
      assert.equal(result.status, 401);
      assert.equal(count(), beforeDispatch, 'no payment is sent after access ends during OAuth');
      assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get().n, beforeLedger, 'no capture/refund is recorded');
      assert.equal(result.json.state, undefined);
      assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM payment_refunds').get().n, 0);
      // Cancellation of one caller must not poison the shared SDK token promise or this order. An authorized owner
      // deliberately retries the same order/refund once, without a replacement order or hidden automatic replay.
      if (reason === 'idle expiry') assert.equal((await owner.signIn()).done.status, 200);
      const recovered = await owner.call('POST', url, { approvalConfirmed: true });
      assert.equal(recovered.status, 200, JSON.stringify(recovered.json));
      assert.equal(count(), beforeDispatch + 1);
    } finally { finish.release(); await s.close(); }
  });
}
