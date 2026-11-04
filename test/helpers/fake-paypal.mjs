// A stateful stand-in for the PayPal sandbox REST API, used only by automated tests.
// It exercises our server logic; it is NOT evidence that the real sandbox integration works.

export function createFakePayPal(options = {}) {
  const behavior = {
    captureStatus: 'COMPLETED',
    captureAmountOverride: null,
    captureCurrencyOverride: null,
    captureCustomIdOverride: null,
    captureError: null, // e.g. { status: 422, issue: 'INSTRUMENT_DECLINED' }
    createStatus: 'CREATED',
    webhookVerification: 'SUCCESS',
    refundStatus: 'COMPLETED',
    ...options,
  };
  const orders = new Map();
  const idempotency = new Map();
  const requests = [];
  let counter = 0;
  let tokenCalls = 0;
  const nextId = (prefix) => `${prefix}${String(++counter).padStart(6, '0')}TEST`;

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
      return json(200, { access_token: params.get('response_type') === 'client_token' ? 'client-token-fake' : `access-${tokenCalls}`, expires_in: 32400 });
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
    m = /^\/v2\/checkout\/orders\/([^/]+)$/.exec(pathname);
    if (m && method === 'GET') {
      const order = orders.get(m[1]);
      return order ? json(200, structuredClone(order)) : issue(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID');
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
