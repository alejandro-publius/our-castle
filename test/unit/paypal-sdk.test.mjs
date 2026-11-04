import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '@paypal/paypal-server-sdk';
import { createPayPalSdkClient } from '../../server/payments/paypal-sdk-client.mjs';
import { PayPalError } from '../../server/payments/paypal-client.mjs';
import { createFakePayPal, fakeSdkControllers } from '../helpers/fake-paypal.mjs';

const credentials = { clientId: 'test-client-id', clientSecret: 'test-client-secret' };

test('SDK adapter sends PayPal’s official request model with idempotency and representation headers', async () => {
  const fake = createFakePayPal();
  const controllers = fakeSdkControllers(fake);
  const paypal = createPayPalSdkClient({ ...credentials, controllers, restFetch: fake.fetch });
  assert.equal(paypal.implementation, 'paypal-server-sdk');
  const { data } = await paypal.createOrder({ localId: 'ctb_local_1', amountCents: 1500, currency: 'USD', description: 'Our House sandbox contribution toward Camping trip fund', requestId: 'create-ctb_local_1' });
  const [call] = controllers.sdkCalls;
  assert.equal(call.name, 'createOrder');
  assert.equal(call.args.paypalRequestId, 'create-ctb_local_1');
  assert.equal(call.args.prefer, 'return=representation');
  assert.equal(call.args.body.intent, 'CAPTURE');
  assert.deepEqual(call.args.body.purchaseUnits[0].amount, { currencyCode: 'USD', value: '15.00' });
  assert.equal(call.args.body.purchaseUnits[0].customId, 'ctb_local_1');
  assert.deepEqual(call.args.body.paymentSource.paypal.experienceContext, { brandName: 'Our House (sandbox demo)', shippingPreference: 'NO_SHIPPING', userAction: 'PAY_NOW' });
  // The service receives PayPal's raw REST JSON, exactly as the REST client would return it.
  assert.equal(data.purchase_units[0].custom_id, 'ctb_local_1');
  assert.equal(data.status, 'CREATED');

  const captured = await paypal.captureOrder(data.id, { requestId: 'capture-ctb_local_1' });
  assert.equal(controllers.sdkCalls[1].args.paypalRequestId, 'capture-ctb_local_1');
  assert.equal(captured.data.purchase_units[0].payments.captures[0].status, 'COMPLETED');
});

test('SDK ApiError responses become PayPalError with PayPal’s issue names and debug id', async () => {
  const fake = createFakePayPal({ captureError: { status: 422, issue: 'INSTRUMENT_DECLINED' } });
  const paypal = createPayPalSdkClient({ ...credentials, controllers: fakeSdkControllers(fake), restFetch: fake.fetch });
  const { data } = await paypal.createOrder({ localId: 'ctb_local_2', amountCents: 500, currency: 'USD', description: 'x', requestId: 'create-ctb_local_2' });
  await assert.rejects(paypal.captureOrder(data.id, { requestId: 'capture-ctb_local_2' }), (error) => {
    assert.ok(error instanceof PayPalError);
    assert.equal(error.status, 422);
    assert.ok(error.hasIssue('INSTRUMENT_DECLINED'));
    assert.equal(error.debugId, 'debug-fake');
    return true;
  });
});

test('SDK transport failures are provider errors (never credited), programming errors are not hidden', async () => {
  const network = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
  const paypal = createPayPalSdkClient({ ...credentials, controllers: { orders: { getOrder: async () => { throw network; } }, payments: {} } });
  await assert.rejects(paypal.getOrder('ORDER123'), (e) => e instanceof PayPalError && e.paypalName === 'NETWORK_ERROR');
  const bug = createPayPalSdkClient({ ...credentials, controllers: { orders: { getOrder: async () => { throw new TypeError('bug'); } }, payments: {} } });
  await assert.rejects(bug.getOrder('ORDER123'), TypeError);
  const real = new ApiError({ request: {}, response: { statusCode: 404, body: '', headers: {} } }, 'not found');
  const missing = createPayPalSdkClient({ ...credentials, controllers: { orders: { getOrder: async () => { throw real; } }, payments: {} } });
  await assert.rejects(missing.getOrder('ORDER123'), (e) => e instanceof PayPalError && e.status === 404);
});

test('without injected controllers the adapter builds real SDK controllers for the sandbox only', () => {
  const paypal = createPayPalSdkClient(credentials);
  assert.equal(paypal.environment, 'sandbox');
  assert.equal(paypal.implementation, 'paypal-server-sdk');
  assert.throws(() => createPayPalSdkClient({ clientId: '', clientSecret: 'x' }), /credentials/);
});
