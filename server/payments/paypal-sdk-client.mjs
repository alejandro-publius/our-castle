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
import { paypalRecipient, paypalAuthAssertion } from './recipient.mjs';

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
  // The SDK could not read a successful answer: its generated schema (a 2xx ResponseValidationError) or its JSON parser
  // refused it. PayPal has already acted on the request, so this is an unknown outcome for the caller to settle from
  // PayPal's own records. It is never a refusal, and never "nothing was sent".
  if ((typeof error?.statusCode === 'number' && error.statusCode < 300) || /^Could not parse body as /.test(error?.message ?? '')) {
    return new PayPalError('PayPal answered in a form the SDK could not read.', { name: 'UNEXPECTED_BODY', debugId: header(error.headers, 'paypal-debug-id') });
  }
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

export function createPayPalSdkClient({ clientId, clientSecret, controllers = null, restFetch, timeoutMs = 30_000, httpAdapter }) {
  if (!clientId || !clientSecret) throw new Error('PayPal sandbox credentials are required');
  let orders;
  let payments;
  let client;
  if (controllers) ({ orders, payments } = controllers);
  else {
    client = new Client({
      clientCredentialsAuthCredentials: { oAuthClientId: clientId, oAuthClientSecret: clientSecret },
      environment: Environment.Sandbox,
      timeout: timeoutMs,
      // Internal test seam: runs the real generated auth/controllers/serializers without any provider traffic.
      // Never populated from HTTP input or environment; pinned SDK 2.5.0 exposes this axios adapter override.
      ...(httpAdapter ? { unstable_httpClientOptions: { adapter: httpAdapter } } : {}),
    });
    orders = new OrdersController(client);
    payments = new PaymentsController(client);
  }
  const rest = createRestClient({ clientId, clientSecret, ...(restFetch ? { fetch: restFetch } : {}) });

  // SDK 2.5.0's public builder interceptor runs after its OAuth/authentication interceptor and inside its retry
  // pipeline (@apimatic/core requestBuilder.ts). Bind the guard to one controller call, not global client state:
  // concurrent adults share the long-lived SDK/token cache without sharing each other's authorization callback.
  function guardedController(Controller, fallback, assertAccess) {
    if (!client || !assertAccess) return fallback; // injected controllers are a unit-test seam, without SDK OAuth
    const factory = client.getRequestBuilderFactory();
    return new Controller({ getRequestBuilderFactory: () => (...args) => {
      const request = factory(...args);
      request.interceptRequest(req => { assertAccess(); return req; });
      return request;
    } });
  }

  async function call(run, assertAccess) {
    assertAccess?.();
    let response;
    try { response = await run(); } catch (error) { throw toPayPalError(error); }
    return { data: rawJson(response.body), debugId: header(response.headers, 'paypal-debug-id'), status: response.statusCode };
  }

  return {
    environment: 'sandbox',
    implementation: 'paypal-server-sdk',

    createOrder({ localId, amountCents, currency, description, requestId, recipient, assertAccess, hold = false }) {
      const payee = paypalRecipient(recipient);
      return call(() => guardedController(OrdersController, orders, assertAccess).createOrder({
        paypalRequestId: requestId,
        ...(payee ? { paypalAuthAssertion: paypalAuthAssertion(clientId, payee) } : {}),
        prefer: 'return=representation',
        body: {
          intent: hold ? CheckoutPaymentIntent.Authorize : CheckoutPaymentIntent.Capture,
          purchaseUnits: [{
            referenceId: localId,
            customId: localId,
            invoiceId: localId,
            description: description.slice(0, 127),
            ...(payee ? { payee: { merchantId: payee.merchantId } } : {}),
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
      }), assertAccess);
    },

    captureOrder(orderId, { requestId, assertAccess, recipient }) {
      return call(() => guardedController(OrdersController, orders, assertAccess).captureOrder({ id: orderId, paypalRequestId: requestId, prefer: 'return=representation',
        ...(recipient ? { paypalAuthAssertion: paypalAuthAssertion(clientId, recipient) } : {}) }), assertAccess);
    },

    authorizeOrder(orderId, { requestId, assertAccess, recipient }) {
      return call(() => guardedController(OrdersController, orders, assertAccess).authorizeOrder({ id: orderId, paypalRequestId: requestId, prefer: 'return=representation',
        ...(recipient ? { paypalAuthAssertion: paypalAuthAssertion(clientId, recipient) } : {}) }), assertAccess);
    },

    getAuthorization(authorizationId) {
      return call(() => payments.getAuthorizedPayment({ authorizationId }));
    },

    captureAuthorization(authorizationId, { amountCents, currency, requestId, assertAccess, final = true }) {
      return call(() => guardedController(PaymentsController, payments, assertAccess).captureAuthorizedPayment({
        authorizationId,
        paypalRequestId: requestId,
        prefer: 'return=representation',
        body: { amount: { currencyCode: currency, value: centsToDecimalString(amountCents) }, finalCapture: final === true },
      }), assertAccess);
    },

    // SDK 2.5.0: PaymentsController.reauthorizePayment({ authorizationId, paypalRequestId, prefer, body: { amount } }).
    reauthorizeAuthorization(authorizationId, { amountCents, currency, requestId, assertAccess }) {
      return call(() => guardedController(PaymentsController, payments, assertAccess).reauthorizePayment({
        authorizationId,
        paypalRequestId: requestId,
        prefer: 'return=representation',
        body: { amount: { currencyCode: currency, value: centsToDecimalString(amountCents) } },
      }), assertAccess);
    },

    voidAuthorization(authorizationId, { requestId, assertAccess }) {
      return call(() => guardedController(PaymentsController, payments, assertAccess).voidPayment({ authorizationId, paypalRequestId: requestId, prefer: 'return=representation' }), assertAccess);
    },

    getOrder(orderId, { recipient, assertAccess } = {}) {
      return call(() => guardedController(OrdersController, orders, assertAccess).getOrder({ id: orderId,
        ...(recipient ? { paypalAuthAssertion: paypalAuthAssertion(clientId, recipient) } : {}) }), assertAccess);
    },

    getCapture(captureId) {
      return call(() => payments.getCapturedPayment({ captureId }));
    },

    refundCapture(captureId, { amountCents, currency, requestId, note, assertAccess }) {
      return call(() => guardedController(PaymentsController, payments, assertAccess).refundCapturedPayment({
        captureId,
        paypalRequestId: requestId,
        prefer: 'return=representation',
        body: {
          amount: { currencyCode: currency, value: centsToDecimalString(amountCents) },
          noteToPayer: (note ?? 'Our Castle sandbox refund').slice(0, 255),
        },
      }), assertAccess);
    },

    verifyWebhookSignature: (args) => rest.verifyWebhookSignature(args),
    generateClientToken: (args) => rest.generateClientToken(args),
  };
}
