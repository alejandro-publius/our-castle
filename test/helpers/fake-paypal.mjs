// A stateful stand-in for the PayPal sandbox REST API, used only by automated tests.
// It exercises our server logic; it is NOT evidence that the real sandbox integration works.

export function createFakePayPal(options = {}) {
  const behavior = {
    captureStatus: 'COMPLETED',
    captureAmountOverride: null,
    captureCurrencyOverride: null,
    captureCustomIdOverride: null,
    captureError: null, // e.g. { status: 422, issue: 'INSTRUMENT_DECLINED' }
    authorizeError: null, // the same, for placing a hold
    authorizationStatus: 'CREATED',
    authorizationAmountOverride: null,
    releaseError: null, // the same, for capturing a hold
    voidError: null,
    reauthorizeError: null, // the same, for extending a hold
    reauthorizationAmountOverride: null,
    reauthorizationCurrencyOverride: null,
    reauthorizationCustomIdOverride: null,
    reauthorizationStatus: 'CREATED',
    orderListsReauthorizations: true, // false: an order read leaves a reauthorization out; it can still be read on its own
    staleOrderReads: 0, // this many order reads come back without the newest capture, as a read made too early would
    createStatus: 'CREATED',
    webhookVerification: 'SUCCESS',
    refundStatus: 'COMPLETED',
    ...options,
  };
  const orders = new Map();
  const unlisted = new Map(); // reauthorizations an order read leaves out (orderListsReauthorizations: false)
  const idempotency = new Map();
  const requests = [];
  let counter = 0;
  let tokenCalls = 0;
  const nextId = (prefix) => `${prefix}${String(++counter).padStart(8, '0')}TEST`; // 17 chars, like real ids

  const json = (status, body, extraHeaders = {}) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'paypal-debug-id': 'debug-fake', ...extraHeaders },
  });
  const issue = (status, name, issueName, message = issueName) => json(status, { name, message, details: [{ issue: issueName, description: message }], debug_id: 'debug-fake' });

  async function fetch(url, init = {}) {
    const { pathname } = new URL(url);
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const body = typeof init.body === 'string' && headers['content-type']?.includes('json') ? JSON.parse(init.body) : init.body;
    requests.push({ method, pathname, headers, body });
    if (!new URL(url).origin.startsWith('https://api-m.sandbox.paypal.com')) throw new Error(`Non-sandbox URL called: ${url}`);

    if (pathname === '/v1/oauth2/token') {
      tokenCalls++;
      if (!headers.authorization?.startsWith('Basic ')) return json(401, { error: 'invalid_client' });
      const params = new URLSearchParams(String(init.body));
      // Mirrors the real sandbox (checked Nov 3, 2026): bare domains only; schemes, ports, localhost and IPs are refused.
      const badDomain = params.getAll('domains[]').some((d) => !/^(?!localhost$)(?=.*[a-z])[a-z0-9.-]+\.[a-z]{2,}$/i.test(d));
      if (params.get('response_type') === 'client_token' && badDomain) return json(401, { error: 'invalid_domain', error_description: 'Domain format not valid' });
      // PayPal answers with a token type; the SDK's own OAuth schema requires it.
      return json(200, { access_token: params.get('response_type') === 'client_token' ? 'client-token-fake' : `access-${tokenCalls}`, token_type: 'Bearer', expires_in: 32400 });
    }
    if (!headers.authorization?.startsWith('Bearer ')) return json(401, { name: 'AUTHENTICATION_FAILURE' });

    const requestId = headers['paypal-request-id'];
    if (requestId && idempotency.has(requestId)) return json(200, structuredClone(idempotency.get(requestId)));
    const remember = (data) => { if (requestId) idempotency.set(requestId, structuredClone(data)); return json(201, data); };

    if (pathname === '/v2/checkout/orders' && method === 'POST') {
      const unit = body.purchase_units[0];
      const order = {
        id: nextId('ORDER'),
        status: behavior.createStatus,
        intent: body.intent,
        purchase_units: [{ reference_id: unit.reference_id, custom_id: unit.custom_id, invoice_id: unit.invoice_id, amount: { ...unit.amount }, description: unit.description }],
      };
      order.links = [{ rel: 'payer-action', method: 'GET', href: `https://www.sandbox.paypal.com/checkoutnow?token=${order.id}` }];
      orders.set(order.id, order);
      return remember(structuredClone(order));
    }
    let m = /^\/v2\/checkout\/orders\/([^/]+)\/capture$/.exec(pathname);
    if (m && method === 'POST') {
      const order = orders.get(m[1]);
      if (!order) return issue(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID');
      if (order.status === 'COMPLETED') return issue(422, 'UNPROCESSABLE_ENTITY', 'ORDER_ALREADY_CAPTURED');
      if (behavior.captureError) return issue(behavior.captureError.status, 'UNPROCESSABLE_ENTITY', behavior.captureError.issue);
      const unit = order.purchase_units[0];
      const capture = {
        id: nextId('CAPTURE'),
        status: behavior.captureStatus,
        amount: {
          currency_code: behavior.captureCurrencyOverride ?? unit.amount.currency_code,
          value: behavior.captureAmountOverride ?? unit.amount.value,
        },
        custom_id: behavior.captureCustomIdOverride ?? unit.custom_id,
        final_capture: true,
        ...(behavior.captureStatus === 'PENDING' ? { status_details: { reason: 'PENDING_REVIEW' } } : {}),
      };
      unit.payments = { captures: [capture] };
      order.status = 'COMPLETED';
      return remember(structuredClone(order));
    }
    m = /^\/v2\/checkout\/orders\/([^/]+)\/authorize$/.exec(pathname);
    if (m && method === 'POST') {
      const order = orders.get(m[1]);
      if (!order) return issue(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID');
      if (order.intent !== 'AUTHORIZE') return issue(422, 'UNPROCESSABLE_ENTITY', 'ACTION_DOES_NOT_MATCH_INTENT');
      if (order.status === 'COMPLETED') return issue(422, 'UNPROCESSABLE_ENTITY', 'ORDER_ALREADY_AUTHORIZED');
      if (behavior.authorizeError) return issue(behavior.authorizeError.status, 'UNPROCESSABLE_ENTITY', behavior.authorizeError.issue);
      const unit = order.purchase_units[0];
      const authorization = {
        id: nextId('AUTH'), status: behavior.authorizationStatus,
        amount: { currency_code: unit.amount.currency_code, value: behavior.authorizationAmountOverride ?? unit.amount.value },
        custom_id: unit.custom_id, expiration_time: '2026-12-02T12:00:00Z',
      };
      unit.payments = { authorizations: [authorization] };
      order.status = 'COMPLETED';
      return remember(structuredClone(order));
    }
    const heldBy = (id) => {
      if (unlisted.has(id)) return unlisted.get(id);
      for (const order of orders.values()) {
        const unit = order.purchase_units[0];
        const authorization = unit.payments?.authorizations?.find((a) => a.id === id);
        if (authorization) return { unit, authorization };
      }
      return null;
    };
    // Cents captured so far from one authorization.
    const tookNothing = (capture) => ['DECLINED', 'DENIED', 'FAILED'].includes(capture.status);
    const capturedFrom = (unit, id) => (unit.payments.captures ?? [])
      .filter((c) => !tookNothing(c) && c.links?.some((l) => l.rel === 'up' && l.href.endsWith(`/authorizations/${id}`)))
      .reduce((sum, c) => sum + Math.round(Number(c.amount.value) * 100), 0);
    m = /^\/v2\/payments\/authorizations\/([^/]+)$/.exec(pathname);
    if (m && method === 'GET') {
      const held = heldBy(m[1]);
      return held ? json(200, structuredClone(held.authorization)) : issue(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID');
    }
    m = /^\/v2\/payments\/authorizations\/([^/]+)\/reauthorize$/.exec(pathname);
    if (m && method === 'POST') {
      const held = heldBy(m[1]);
      if (!held) return issue(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID');
      if (behavior.reauthorizeError) return issue(behavior.reauthorizeError.status, 'UNPROCESSABLE_ENTITY', behavior.reauthorizeError.issue);
      if (held.authorization.status === 'VOIDED') return issue(422, 'UNPROCESSABLE_ENTITY', 'AUTHORIZATION_VOIDED');
      if (held.authorization.status !== 'CREATED') return issue(422, 'UNPROCESSABLE_ENTITY', 'AUTHORIZATION_ALREADY_CAPTURED');
      const reauthorization = {
        id: nextId('AUTH'), status: behavior.reauthorizationStatus,
        amount: {
          currency_code: behavior.reauthorizationCurrencyOverride ?? body?.amount?.currency_code ?? held.authorization.amount.currency_code,
          value: behavior.reauthorizationAmountOverride ?? body?.amount?.value ?? held.authorization.amount.value,
        },
        custom_id: behavior.reauthorizationCustomIdOverride ?? held.unit.custom_id, expiration_time: held.authorization.expiration_time,
        links: [{ rel: 'up', href: `https://api-m.sandbox.paypal.com/v2/payments/authorizations/${m[1]}` }],
      };
      if (behavior.orderListsReauthorizations) held.unit.payments.authorizations.push(reauthorization);
      else unlisted.set(reauthorization.id, { unit: held.unit, authorization: reauthorization });
      return remember(structuredClone(reauthorization));
    }
    m = /^\/v2\/payments\/authorizations\/([^/]+)\/capture$/.exec(pathname);
    if (m && method === 'POST') {
      const held = heldBy(m[1]);
      if (!held) return issue(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID');
      if (behavior.releaseError) return issue(behavior.releaseError.status, 'UNPROCESSABLE_ENTITY', behavior.releaseError.issue);
      if (held.authorization.status === 'VOIDED') return issue(422, 'UNPROCESSABLE_ENTITY', 'AUTHORIZATION_VOIDED');
      if (!['CREATED', 'PARTIALLY_CAPTURED'].includes(held.authorization.status)) return issue(422, 'UNPROCESSABLE_ENTITY', 'AUTHORIZATION_ALREADY_CAPTURED');
      const left = Math.round(Number(held.authorization.amount.value) * 100) - capturedFrom(held.unit, m[1]);
      if (Math.round(Number(body.amount.value) * 100) > left) return issue(422, 'UNPROCESSABLE_ENTITY', 'MAX_CAPTURE_AMOUNT_EXCEEDED');
      const capture = {
        id: nextId('CAPTURE'), status: behavior.captureStatus,
        amount: { currency_code: behavior.captureCurrencyOverride ?? body.amount.currency_code, value: behavior.captureAmountOverride ?? body.amount.value },
        custom_id: behavior.captureCustomIdOverride ?? held.unit.custom_id, final_capture: body.final_capture === true,
        links: [{ rel: 'up', href: `https://api-m.sandbox.paypal.com/v2/payments/authorizations/${m[1]}` }],
        ...(behavior.captureStatus === 'PENDING' ? { status_details: { reason: 'PENDING_REVIEW' } } : {}),
      };
      held.unit.payments.captures = [...(held.unit.payments.captures ?? []), capture];
      // A declined capture takes nothing and leaves the authorization as it was.
      if (!tookNothing(capture)) held.authorization.status = body.final_capture === true ? 'CAPTURED' : 'PARTIALLY_CAPTURED';
      return remember(structuredClone(capture));
    }
    m = /^\/v2\/payments\/authorizations\/([^/]+)\/void$/.exec(pathname);
    if (m && method === 'POST') {
      const held = heldBy(m[1]);
      if (!held) return issue(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID');
      if (behavior.voidError) return issue(behavior.voidError.status, 'UNPROCESSABLE_ENTITY', behavior.voidError.issue);
      if (held.authorization.status === 'VOIDED') return issue(422, 'UNPROCESSABLE_ENTITY', 'PREVIOUSLY_VOIDED');
      // A partly captured authorization can still be voided: that gives back what is left.
      if (!['CREATED', 'PARTIALLY_CAPTURED'].includes(held.authorization.status)) return issue(422, 'UNPROCESSABLE_ENTITY', 'PREVIOUSLY_CAPTURED');
      held.authorization.status = 'VOIDED';
      return json(200, structuredClone(held.authorization));
    }
    m = /^\/v2\/checkout\/orders\/([^/]+)$/.exec(pathname);
    if (m && method === 'GET') {
      const order = orders.get(m[1]);
      if (!order) return issue(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID');
      const read = structuredClone(order);
      if (behavior.staleOrderReads > 0) { behavior.staleOrderReads--; read.purchase_units[0].payments?.captures?.pop(); }
      return json(200, read);
    }
    m = /^\/v2\/payments\/captures\/([^/]+)\/refund$/.exec(pathname);
    if (m && method === 'POST') {
      const refund = { id: nextId('REFUND'), status: behavior.refundStatus, amount: { ...body.amount }, links: [{ rel: 'up', href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${m[1]}` }] };
      return remember(refund);
    }
    if (pathname === '/v1/notifications/verify-webhook-signature' && method === 'POST') {
      return json(200, { verification_status: behavior.webhookVerification });
    }
    return json(404, { name: 'NOT_FOUND', message: `Fake has no route for ${method} ${pathname}` });
  }

  return {
    fetch,
    behavior,
    orders,
    requests,
    get tokenCalls() { return tokenCalls; },
    /** Simulate PayPal completing a previously pending capture (as a webhook would report). */
    completePendingCapture(orderId) {
      const capture = orders.get(orderId).purchase_units[0].payments.captures[0];
      capture.status = 'COMPLETED';
      delete capture.status_details;
      return structuredClone(capture);
    },
  };
}

export const webhookHeaders = {
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-fake',
  'paypal-transmission-id': 'transmission-1',
  'paypal-transmission-sig': 'signature-fake',
  'paypal-transmission-time': '2026-11-03T20:00:00Z',
};

// Stand-in for the official Server SDK controllers, routed through the same fake sandbox so the
// payment tests can run against the SDK adapter too. Mirrors the SDK: camelCase request models,
// a raw JSON `body` on success, and the SDK's own ApiError on HTTP errors.
import { ApiError } from '@paypal/paypal-server-sdk';

const toSnake = (value) => {
  if (Array.isArray(value)) return value.map(toSnake);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`), toSnake(v)]));
  }
  return value;
};

export function fakeSdkControllers(fake) {
  const sdkCalls = [];
  async function send(method, path, { body, paypalRequestId, prefer } = {}) {
    const headers = { Authorization: 'Bearer sdk-fake-token', 'Content-Type': 'application/json' };
    if (paypalRequestId) headers['PayPal-Request-Id'] = paypalRequestId;
    if (prefer) headers.Prefer = prefer;
    const response = await fake.fetch(`https://api-m.sandbox.paypal.com${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(toSnake(body)) });
    const text = await response.text();
    const responseHeaders = Object.fromEntries(response.headers.entries());
    if (!response.ok) throw new ApiError({ request: { method, url: path }, response: { statusCode: response.status, body: text, headers: responseHeaders } }, `HTTP ${response.status}`);
    return { statusCode: response.status, headers: responseHeaders, body: text, result: {} };
  }
  const record = (name, args) => { sdkCalls.push({ name, args }); };
  return {
    sdkCalls,
    orders: {
      createOrder(args) { record('createOrder', args); return send('POST', '/v2/checkout/orders', args); },
      captureOrder(args) { record('captureOrder', args); return send('POST', `/v2/checkout/orders/${args.id}/capture`, { ...args, body: {} }); },
      getOrder(args) { record('getOrder', args); return send('GET', `/v2/checkout/orders/${args.id}`); },
      authorizeOrder(args) { record('authorizeOrder', args); return send('POST', `/v2/checkout/orders/${args.id}/authorize`, { ...args, body: {} }); },
    },
    payments: {
      getCapturedPayment(args) { record('getCapturedPayment', args); return send('GET', `/v2/payments/captures/${args.captureId}`); },
      refundCapturedPayment(args) { record('refundCapturedPayment', args); return send('POST', `/v2/payments/captures/${args.captureId}/refund`, args); },
      getAuthorizedPayment(args) { record('getAuthorizedPayment', args); return send('GET', `/v2/payments/authorizations/${args.authorizationId}`); },
      captureAuthorizedPayment(args) { record('captureAuthorizedPayment', args); return send('POST', `/v2/payments/authorizations/${args.authorizationId}/capture`, args); },
      voidPayment(args) { record('voidPayment', args); return send('POST', `/v2/payments/authorizations/${args.authorizationId}/void`, args); },
      reauthorizePayment(args) { record('reauthorizePayment', args); return send('POST', `/v2/payments/authorizations/${args.authorizationId}/reauthorize`, args); },
    },
  };
}
