import { PAYPAL_SANDBOX_API } from '../config.mjs';
import { centsToDecimalString } from '../../src/core/rules.js';

export class PayPalError extends Error {
  constructor(message, { status = null, name = null, issues = [], debugId = null, details = null } = {}) {
    super(message);
    this.status = status;
    this.paypalName = name;
    this.issues = issues;
    this.debugId = debugId;
    this.details = details;
  }
  hasIssue(issue) {
    return this.issues.includes(issue);
  }
}

/**
 * Minimal PayPal REST client for the sandbox only (Orders v2, Payments v2, Webhooks v1).
 * The base URL is fixed: this prototype has no path to live endpoints.
 */
export function createPayPalClient({ clientId, clientSecret, fetch = globalThis.fetch, now = () => Date.now() }) {
  if (!clientId || !clientSecret) throw new Error('PayPal sandbox credentials are required');
  const base = PAYPAL_SANDBOX_API;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  let cached = null;

  async function readJson(response) {
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return { raw: text.slice(0, 500) }; }
  }

  async function oauth(body) {
    const response = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    const data = await readJson(response);
    if (!response.ok || !data?.access_token) {
      throw new PayPalError('PayPal sandbox authentication failed. Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.', {
        status: response.status, name: data?.error ?? null, debugId: response.headers.get('paypal-debug-id'),
      });
    }
    return data;
  }

  async function accessToken() {
    if (cached && cached.expiresAt - 60_000 > now()) return cached.value;
    const data = await oauth(new URLSearchParams({ grant_type: 'client_credentials' }));
    cached = { value: data.access_token, expiresAt: now() + Number(data.expires_in ?? 300) * 1000 };
    return cached.value;
  }

  async function request(method, path, { body, requestId, prefer = 'return=representation' } = {}) {
    const headers = { Authorization: `Bearer ${await accessToken()}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (requestId) headers['PayPal-Request-Id'] = requestId;
    if (prefer) headers.Prefer = prefer;
    const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await readJson(response);
    const debugId = response.headers.get('paypal-debug-id') ?? data?.debug_id ?? null;
    if (!response.ok) {
      const issues = Array.isArray(data?.details) ? data.details.map((d) => d.issue).filter(Boolean) : [];
      throw new PayPalError(data?.message ?? `PayPal sandbox request failed (${response.status})`, {
        status: response.status, name: data?.name ?? null, issues, debugId, details: data?.details ?? null,
      });
    }
    return { data, debugId, status: response.status };
  }

  return {
    environment: 'sandbox',

    /** Create a CAPTURE order whose purchase unit carries our local contribution id. */
    createOrder({ localId, amountCents, currency, description, requestId }) {
      return request('POST', '/v2/checkout/orders', {
        requestId,
        body: {
          intent: 'CAPTURE',
          purchase_units: [{
            reference_id: localId,
            custom_id: localId,
            invoice_id: localId,
            description: description.slice(0, 127),
            amount: { currency_code: currency, value: centsToDecimalString(amountCents) },
          }],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: 'Our House (sandbox demo)',
                shipping_preference: 'NO_SHIPPING',
                user_action: 'PAY_NOW',
              },
            },
          },
        },
      });
    },

    captureOrder(orderId, { requestId }) {
      return request('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { requestId, body: {} });
    },

    getOrder(orderId) {
      return request('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`, { prefer: null });
    },

    getCapture(captureId) {
      return request('GET', `/v2/payments/captures/${encodeURIComponent(captureId)}`, { prefer: null });
    },

    refundCapture(captureId, { amountCents, currency, requestId, note }) {
      return request('POST', `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
        requestId,
        body: {
          amount: { currency_code: currency, value: centsToDecimalString(amountCents) },
          note_to_payer: (note ?? 'Our House sandbox refund').slice(0, 255),
        },
      });
    },

    /** Ask PayPal to verify a webhook delivery. Never act on an unverified event. */
    async verifyWebhookSignature({ headers, event, webhookId }) {
      const h = (name) => headers[name] ?? headers[name.toLowerCase()];
      const required = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
      if (required.some((name) => !h(name))) return false;
      const { data } = await request('POST', '/v1/notifications/verify-webhook-signature', {
        prefer: null,
        body: {
          auth_algo: h('paypal-auth-algo'),
          cert_url: h('paypal-cert-url'),
          transmission_id: h('paypal-transmission-id'),
          transmission_sig: h('paypal-transmission-sig'),
          transmission_time: h('paypal-transmission-time'),
          webhook_id: webhookId,
          webhook_event: event,
        },
      });
      return data?.verification_status === 'SUCCESS';
    },

    /** Browser-safe client token for the JavaScript SDK v6 (used only if clientId init is refused). */
    async generateClientToken({ domains = [] } = {}) {
      const params = new URLSearchParams({ grant_type: 'client_credentials', response_type: 'client_token' });
      // PayPal accepts bare domain names only (example.com); it rejects schemes, ports, localhost and IPs.
      for (const domain of domains) params.append('domains[]', domain);
      const data = await oauth(params);
      return { accessToken: data.access_token, expiresIn: Number(data.expires_in ?? 900) };
    },
  };
}
