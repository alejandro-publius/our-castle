import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  OrdersController,
  PaymentsController,
  PaypalExperienceUserAction,
  PaypalWalletContextShippingPreference,
} from '@paypal/paypal-server-sdk';
import { centsToDecimalString } from '../../src/core/rules.js';
import { PayPalError, createPayPalClient as createRestClient } from './paypal-client.mjs';

// PayPal's official Server SDK (APIMatic-generated), as used in PayPal's own Node integration guide.
// The environment is fixed to Sandbox: this prototype has no path to live endpoints.
// Webhook signature verification and browser client tokens are not part of the Server SDK, so those
// two calls use the small REST client with the same sandbox credentials.

const header = (headers, name) => {
  if (!headers) return null;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : null;
};

/** The SDK exposes the raw HTTP body; use it so the service sees PayPal's exact REST JSON. */
function rawJson(body) {
  if (body === undefined || body === null || body === '') return null;
  if (typeof body !== 'string') throw new PayPalError('PayPal SDK returned a non-text body.', { name: 'UNEXPECTED_BODY' });
  try { return JSON.parse(body); } catch { throw new PayPalError('PayPal SDK returned a body that is not JSON.', { name: 'UNEXPECTED_BODY' }); }
}

function isApiError(error) {
  return error instanceof ApiError || (typeof error?.statusCode === 'number' && 'body' in (error ?? {}) && 'request' in (error ?? {}));
}

function toPayPalError(error) {
  if (isApiError(error)) {
    let data = null;
    try { data = typeof error.body === 'string' && error.body ? JSON.parse(error.body) : null; } catch { data = null; }
    const issues = Array.isArray(data?.details) ? data.details.map((d) => d.issue).filter(Boolean) : [];
    return new PayPalError(data?.message ?? `PayPal sandbox request failed (${error.statusCode})`, {
      status: error.statusCode,
      name: data?.name ?? null,
      issues,
      debugId: header(error.headers, 'paypal-debug-id') ?? data?.debug_id ?? null,
      details: data?.details ?? null,
    });
  }
  // Transport failures (timeouts, resets) become provider errors, so nothing is ever credited on them.
  if (error?.isAxiosError || (typeof error?.code === 'string' && /^E[A-Z_]+$/.test(error.code))) {
    return new PayPalError('Could not reach the PayPal sandbox.', { name: 'NETWORK_ERROR' });
  }
  return error;
}

export function createPayPalSdkClient({ clientId, clientSecret, controllers = null, restFetch, timeoutMs = 30_000 }) {
  if (!clientId || !clientSecret) throw new Error('PayPal sandbox credentials are required');
  let orders;
  let payments;
  if (controllers) ({ orders, payments } = controllers);
  else {
    const client = new Client({
      clientCredentialsAuthCredentials: { oAuthClientId: clientId, oAuthClientSecret: clientSecret },
      environment: Environment.Sandbox,
      timeout: timeoutMs,
    });
    orders = new OrdersController(client);
    payments = new PaymentsController(client);
  }
  const rest = createRestClient({ clientId, clientSecret, ...(restFetch ? { fetch: restFetch } : {}) });

  async function call(run) {
    let response;
    try { response = await run(); } catch (error) { throw toPayPalError(error); }
    return { data: rawJson(response.body), debugId: header(response.headers, 'paypal-debug-id'), status: response.statusCode };
  }

  return {
    environment: 'sandbox',
    implementation: 'paypal-server-sdk',

    createOrder({ localId, amountCents, currency, description, requestId }) {
      return call(() => orders.createOrder({
        paypalRequestId: requestId,
        prefer: 'return=representation',
        body: {
          intent: CheckoutPaymentIntent.Capture,
          purchaseUnits: [{
            referenceId: localId,
            customId: localId,
            invoiceId: localId,
            description: description.slice(0, 127),
            amount: { currencyCode: currency, value: centsToDecimalString(amountCents) },
          }],
          paymentSource: {
            paypal: {
              experienceContext: {
                brandName: 'Our Castle (sandbox demo)',
                shippingPreference: PaypalWalletContextShippingPreference.NoShipping,
                userAction: PaypalExperienceUserAction.PayNow,
              },
            },
          },
        },
      }));
    },

    captureOrder(orderId, { requestId }) {
      return call(() => orders.captureOrder({ id: orderId, paypalRequestId: requestId, prefer: 'return=representation' }));
    },

    getOrder(orderId) {
      return call(() => orders.getOrder({ id: orderId }));
    },

    getCapture(captureId) {
      return call(() => payments.getCapturedPayment({ captureId }));
    },

    refundCapture(captureId, { amountCents, currency, requestId, note }) {
      return call(() => payments.refundCapturedPayment({
        captureId,
        paypalRequestId: requestId,
        prefer: 'return=representation',
        body: {
          amount: { currencyCode: currency, value: centsToDecimalString(amountCents) },
          noteToPayer: (note ?? 'Our Castle sandbox refund').slice(0, 255),
        },
      }));
    },

    verifyWebhookSignature: (args) => rest.verifyWebhookSignature(args),
    generateClientToken: (args) => rest.generateClientToken(args),
  };
}
