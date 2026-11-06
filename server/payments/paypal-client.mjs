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
export function createPayPalClient({ clientId, clientSecret, fetch: rawFetch = globalThis.fetch, now = () => Date.now(), timeoutMs = 30_000 }) {
  if (!clientId || !clientSecret) throw new Error('PayPal sandbox credentials are required');
  const base = PAYPAL_SANDBOX_API;
  function transportError(error, debugId = null) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return new PayPalError('PayPal sandbox did not answer in time.', { name: 'TIMEOUT', debugId });
    if (error instanceof TypeError) return new PayPalError('Could not reach PayPal sandbox.', { name: 'NETWORK_ERROR', debugId });
    return error;
  }
  // Every REST call has a bounded wait, like the Server SDK client. No answer (timed out) and no connection (fetch's
  // TypeError) are both reported as a PayPalError without an HTTP status, which callers already treat as an unknown
  // outcome rather than a failure. Any other error is a bug and is left alone.
  async function fetch(url, init) {
    try { return await rawFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }); }
    catch (error) { throw transportError(error); }
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  let cached = null;

  async function readJson(response) {
    // fetch resolves at the response headers; its timeout/reset can still happen while consuming the body.
    let text;
    try { text = await response.text(); }
    catch (error) { throw transportError(error, response.headers.get('paypal-debug-id')); }
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

  async function request(method, path, { body, json, requestId, prefer = 'return=representation' } = {}) {
    const headers = { Authorization: `Bearer ${await accessToken()}`, Accept: 'application/json' };
    if (json === undefined && body !== undefined) json = JSON.stringify(body);
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    if (requestId) headers['PayPal-Request-Id'] = requestId;
    if (prefer) headers.Prefer = prefer;
    const response = await fetch(`${base}${path}`, { method, headers, body: json });
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
                brand_name: 'Our Castle (sandbox demo)',
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
          note_to_payer: (note ?? 'Our Castle sandbox refund').slice(0, 255),
        },
      });
    },

    /**
     * Ask PayPal to verify a webhook delivery. Never act on an unverified event.
     * The event is sent back exactly as delivered (`rawBody`): re-serializing parsed JSON can change escapes or number
     * formatting, and then a genuine delivery fails verification (PayPal AI Toolkit, webhooks best practice).
     */
    async verifyWebhookSignature({ headers, rawBody, event, webhookId }) {
      const h = (name) => headers[name] ?? headers[name.toLowerCase()];
      const required = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
      if (required.some((name) => !h(name))) return false;
      const fields = JSON.stringify({
        auth_algo: h('paypal-auth-algo'),
        cert_url: h('paypal-cert-url'),
        transmission_id: h('paypal-transmission-id'),
        transmission_sig: h('paypal-transmission-sig'),
        transmission_time: h('paypal-transmission-time'),
        webhook_id: webhookId,
      });
      // The request body is assembled as text so the delivered event is embedded byte-for-byte: `fields` minus its
      // closing brace, then the event as PayPal sent it. `rawBody` was already parsed by the caller, so it is valid JSON.
      const deliveredEvent = typeof rawBody === 'string' ? rawBody : JSON.stringify(event);
      const { data } = await request('POST', '/v1/notifications/verify-webhook-signature', {
        prefer: null,
        json: `${fields.slice(0, -1)},"webhook_event":${deliveredEvent}}`,
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
