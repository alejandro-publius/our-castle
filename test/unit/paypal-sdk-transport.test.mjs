import test from 'node:test';
import assert from 'node:assert/strict';
import { createPayPalSdkClient } from '../../server/payments/paypal-sdk-client.mjs';
import { PayPalError } from '../../server/payments/paypal-client.mjs';

// APIMatic typescript-testing seam: real SDK 2.5.0 auth, controllers and serializers; only axios transport is fake.
// No token seeding, controller replacement, network, provider credentials or retry overrides.
const ORDER = 'FAKEORDER123', CAPTURE = 'FAKECAPTURE123', AUTH = 'FAKEAUTH123';
const HOLD_PATHS = [`/v2/checkout/orders/${ORDER}/authorize`, ...['', '/capture', '/reauthorize', '/void'].map((step) => `/v2/payments/authorizations/${AUTH}${step}`)];
const amount = { currency_code: 'USD', value: '15.00' };
const capture = { id: CAPTURE, status: 'COMPLETED', amount, final_capture: true,
  seller_receivable_breakdown: { gross_amount: amount, paypal_fee: { currency_code: 'USD', value: '0.50' }, net_amount: { currency_code: 'USD', value: '14.50' } }, future_capture_field: 'keep-me' };
const completed = { id: ORDER, status: 'COMPLETED', purchase_units: [{ reference_id: 'ctb_fixture', custom_id: 'ctb_fixture', payments: { captures: [capture] } }], future_order_field: { retained: true } };
const headers = (req) => Object.fromEntries(Object.entries(req.headers.toJSON?.() ?? req.headers).map(([k, v]) => [k.toLowerCase(), v]));

function harness(reply = () => ({ body: completed }), options = {}) {
  const calls = [];
  const httpAdapter = async (config) => {
    const url = new URL(config.url);
    assert.equal(url.origin, 'https://api-m.sandbox.paypal.com', 'even the token request must stay in sandbox');
    assert.ok(['/v1/oauth2/token', '/v2/checkout/orders', `/v2/checkout/orders/${ORDER}`, `/v2/checkout/orders/${ORDER}/capture`, `/v2/payments/captures/${CAPTURE}`, `/v2/payments/captures/${CAPTURE}/refund`, ...HOLD_PATHS].includes(url.pathname), `unexpected SDK endpoint: ${url.pathname}`);
    calls.push(config);
    if (url.pathname === '/v1/oauth2/token') await options.beforeToken?.();
    const result = url.pathname === '/v1/oauth2/token' && !options.authError
      ? { body: { access_token: 'fake-contract-token', token_type: 'Bearer', expires_in: 3600 } }
      : await reply(config);
    return { config, status: result.status ?? 200, statusText: '', headers: { 'content-type': 'application/json', 'paypal-debug-id': 'fixture-debug-id' }, data: typeof result.body === 'string' ? result.body : JSON.stringify(result.body) };
  };
  const client = createPayPalSdkClient({ clientId: 'fake-contract-id', clientSecret: 'fake-contract-secret', httpAdapter,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}), restFetch: () => { throw new Error('REST network forbidden in SDK contract tests'); } });
  return { client, calls, operations: () => calls.filter((c) => !c.url.endsWith('/v1/oauth2/token')) };
}

test('real SDK serializes OAuth and digital-goal Orders v2 requests; timeout applies to both', async () => {
  const { client, calls, operations } = harness(() => ({ status: 201, body: { id: ORDER, status: 'CREATED' } }));
  const response = await client.createOrder({ localId: 'ctb_fixture', amountCents: 1500, currency: 'USD', description: 'A'.repeat(140), requestId: 'create-ctb_fixture' });
  assert.equal(response.data.id, ORDER); assert.equal(response.status, 201);
  assert.equal(calls.length, 2);
  const [auth] = calls;
  assert.equal(auth.method, 'post');
  assert.equal(new URLSearchParams(auth.data).get('grant_type'), 'client_credentials');
  assert.ok(auth.auth?.username === 'fake-contract-id' || headers(auth).authorization === `Basic ${Buffer.from('fake-contract-id:fake-contract-secret').toString('base64')}`);
  const [req] = operations();
  assert.equal(req.method, 'post');
  assert.equal(req.url, 'https://api-m.sandbox.paypal.com/v2/checkout/orders');
  assert.equal(headers(req)['paypal-request-id'], 'create-ctb_fixture');
  assert.equal(headers(req).prefer, 'return=representation');
  assert.equal(headers(req).authorization, 'Bearer fake-contract-token');
  assert.deepEqual(JSON.parse(req.data), { intent: 'CAPTURE', purchase_units: [{ reference_id: 'ctb_fixture', custom_id: 'ctb_fixture', invoice_id: 'ctb_fixture', description: 'A'.repeat(127), amount }], payment_source: { paypal: { experience_context: { brand_name: 'Our Castle (sandbox demo)', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' } } } });
  for (const call of calls) assert.equal(call.timeout, 30000, 'SDK default 0 must never leak into transport');
});

test('capture, read and refund wire contracts retain request IDs, decimal money and raw unknown response fields', async () => {
  const { client, calls, operations } = harness((req) => ({ body: req.url.endsWith('/refund') ? { id: 'FAKEREFUND', status: 'COMPLETED', amount } : req.url.endsWith(CAPTURE) ? capture : completed }));
  const result = await client.captureOrder(ORDER, { requestId: 'capture-ctb_fixture' });
  assert.deepEqual(result.data, completed, 'raw seller breakdown and future fields must survive SDK deserialization');
  assert.equal(result.debugId, 'fixture-debug-id');
  await client.getOrder(ORDER);
  await client.getCapture(CAPTURE);
  await client.refundCapture(CAPTURE, { amountCents: 125, currency: 'USD', requestId: 'refund-fixture', note: 'N'.repeat(270) });
  assert.equal(calls.filter((c) => c.url.endsWith('/v1/oauth2/token')).length, 1, 'SDK reuses the fake OAuth token');
  const [captureReq, orderReq, readReq, refundReq] = operations();
  assert.equal(captureReq.method, 'post');
  assert.equal(captureReq.url.endsWith(`/${ORDER}/capture`), true);
  assert.equal(headers(captureReq)['paypal-request-id'], 'capture-ctb_fixture');
  assert.equal(headers(captureReq).prefer, 'return=representation');
  assert.equal(orderReq.method, 'get'); assert.equal(orderReq.data, undefined);
  assert.equal(readReq.method, 'get'); assert.equal(readReq.data, undefined);
  assert.equal(headers(refundReq)['paypal-request-id'], 'refund-fixture');
  assert.deepEqual(JSON.parse(refundReq.data), { amount: { currency_code: 'USD', value: '1.25' }, note_to_payer: 'N'.repeat(255) });
});

test('real SDK error deserialization preserves the provider issue and debug ID, with no silent retry', async () => {
  const { client, operations } = harness(() => ({ status: 422, body: { name: 'UNPROCESSABLE_ENTITY', message: 'Declined', details: [{ issue: 'INSTRUMENT_DECLINED', description: 'Fixture decline' }] } }));
  await assert.rejects(client.captureOrder(ORDER, { requestId: 'capture-decline' }), (e) => e instanceof PayPalError && e.status === 422 && e.hasIssue('INSTRUMENT_DECLINED') && e.debugId === 'fixture-debug-id');
  assert.equal(operations().length, 1);
});

test('503 and transport timeout never trigger hidden SDK retries for reads or captures', async () => {
  for (const method of ['getOrder', 'captureOrder']) {
    for (const timeout of [false, true]) {
      const { client, operations } = harness(() => {
        if (timeout) throw Object.assign(new Error('fixture timeout'), { code: 'ECONNABORTED', isAxiosError: true });
        return { status: 503, body: { name: 'SERVICE_UNAVAILABLE', message: 'Fixture unavailable' } };
      }, { timeoutMs: 1234 });
      await assert.rejects(client[method](ORDER, { requestId: 'capture-timeout' }), (e) => e instanceof PayPalError && (timeout ? e.paypalName === 'NETWORK_ERROR' : e.status === 503));
      assert.equal(operations().length, 1); assert.equal(operations()[0].timeout, 1234);
    }
  }
});

test('OAuth rejection stops before an order operation is attempted', async () => {
  const { client, calls, operations } = harness(() => ({ status: 401, body: { error: 'invalid_client', error_description: 'fixture' } }), { authError: true });
  await assert.rejects(client.getOrder(ORDER));
  assert.equal(calls.length, 1); assert.equal(operations().length, 0);
});

test('concurrent SDK calls keep their own access guards on one shared client', async () => {
  let entered, release;
  const tokenStarted = new Promise(resolve => { entered = resolve; });
  const tokenReady = new Promise(resolve => { release = resolve; });
  const { client, calls, operations } = harness(undefined, { beforeToken: async () => { entered(); await tokenReady; } });
  let removed = false;
  const ended = new Error('Fixture access ended');
  const denied = client.captureOrder(ORDER, { requestId: 'removed-caller', assertAccess: () => { if (removed) throw ended; } });
  const refused = assert.rejects(denied, error => error === ended, 'access errors stay authorization errors, not provider failures');
  const allowed = client.captureOrder(ORDER, { requestId: 'active-caller', assertAccess: () => {} });
  try {
    await tokenStarted;
    removed = true; release();
    await refused;
    assert.equal((await allowed).data.id, ORDER);
    assert.equal(calls.filter(c => c.url.endsWith('/v1/oauth2/token')).length, 2, 'SDK 2.5.0 does not coalesce simultaneous cold-token requests');
    assert.equal(operations().length, 1);
    assert.equal(headers(operations()[0])['paypal-request-id'], 'active-caller');
  } finally { release(); }
});

test('malformed or wrong-shaped SDK responses cannot become a successful receipt', async () => {
  for (const body of ['{not JSON', { purchase_units: 'not an array' }]) {
    const { client, operations } = harness(() => ({ body }));
    await assert.rejects(client.captureOrder(ORDER, { requestId: 'capture-bad-body' }));
    assert.equal(operations().length, 1);
  }
});

// The hold calls, through the real SDK serializers. Response shapes follow PayPal's published samples; they are not
// evidence about what the sandbox really returns.
const held = { id: AUTH, status: 'CREATED', amount: { currency_code: 'USD', value: '25.00' }, custom_id: 'ctb_fixture', invoice_id: 'ctb_fixture',
  seller_protection: { status: 'ELIGIBLE', dispute_categories: ['ITEM_NOT_RECEIVED', 'UNAUTHORIZED_TRANSACTION'] }, expiration_time: '2026-12-10T12:00:00Z', create_time: '2026-11-11T12:00:00Z' };
const release = { ...capture, final_capture: false, custom_id: 'ctb_fixture', supplementary_data: { related_ids: { order_id: ORDER, authorization_id: AUTH } } };

test('hold wire contracts: authorize, capture kept open or final, reauthorize and void carry request IDs, decimal money and the final flag', async () => {
  const { client, operations } = harness((req) => {
    if (req.url.endsWith('/authorize')) return { status: 201, body: { id: ORDER, status: 'COMPLETED', purchase_units: [{ reference_id: 'ctb_fixture', payments: { authorizations: [held] } }] } };
    if (req.url.endsWith('/capture')) return { status: 201, body: release };
    if (req.url.endsWith('/void')) return { status: 204, body: '' }; // PayPal's answer to a void may have no body at all
    return { status: req.url.endsWith('/reauthorize') ? 201 : 200, body: held };
  });
  assert.equal((await client.authorizeOrder(ORDER, { requestId: 'authorize-ctb_fixture' })).data.purchase_units[0].payments.authorizations[0].id, AUTH);
  assert.deepEqual((await client.captureAuthorization(AUTH, { amountCents: 1500, currency: 'USD', final: false, requestId: 'release-keep' })).data, release);
  await client.captureAuthorization(AUTH, { amountCents: 1000, currency: 'USD', requestId: 'release-final' });
  assert.equal((await client.reauthorizeAuthorization(AUTH, { amountCents: 2500, currency: 'USD', requestId: 'extend-1' })).data.id, AUTH);
  assert.deepEqual(await client.voidAuthorization(AUTH, { requestId: 'return-ctb_fixture' }), { data: null, debugId: 'fixture-debug-id', status: 204 });
  assert.equal((await client.getAuthorization(AUTH)).data.status, 'CREATED');
  const sent = operations().map((req) => [req.method, new URL(req.url).pathname, headers(req)['paypal-request-id'], req.data ? JSON.parse(req.data) : null]);
  assert.deepEqual(sent, [
    ['post', HOLD_PATHS[0], 'authorize-ctb_fixture', null],
    ['post', `/v2/payments/authorizations/${AUTH}/capture`, 'release-keep', { amount: { currency_code: 'USD', value: '15.00' }, final_capture: false }],
    ['post', `/v2/payments/authorizations/${AUTH}/capture`, 'release-final', { amount: { currency_code: 'USD', value: '10.00' }, final_capture: true }],
    ['post', `/v2/payments/authorizations/${AUTH}/reauthorize`, 'extend-1', { amount: { currency_code: 'USD', value: '25.00' } }],
    ['post', `/v2/payments/authorizations/${AUTH}/void`, 'return-ctb_fixture', null],
    ['get', `/v2/payments/authorizations/${AUTH}`, undefined, null],
  ]);
});

test('a successful answer the SDK cannot read is an unknown outcome, never a refusal: PayPal has already acted', async () => {
  // A number where the SDK's generated schema wants text, and a body that is not JSON. Both arrive with a 2xx status.
  for (const body of [{ ...release, seller_receivable_breakdown: { exchange_rate: { value: 1 } } }, '<html>gateway</html>']) {
    const { client, operations } = harness(() => ({ status: 201, body }));
    await assert.rejects(client.captureAuthorization(AUTH, { amountCents: 1500, currency: 'USD', final: false, requestId: 'release-keep' }),
      (e) => e instanceof PayPalError && e.status === null && e.paypalName === 'UNEXPECTED_BODY');
    assert.equal(operations().length, 1);
  }
});
