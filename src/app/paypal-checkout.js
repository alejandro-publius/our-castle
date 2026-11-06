import { api } from './api.js';

// PayPal JavaScript SDK v6 (sandbox host). The browser only starts checkout and reports approval;
// the server creates the order with its own amount and decides the outcome by capturing it.
// Follows PayPal's Node integration guide (Oct 2026): createInstance({ clientId, components,
// pageType }) and a createOrder promise resolving to { orderId }. A server-issued client token is
// kept as a fallback because some v6 reference pages still describe token-based initialization.

let sdkPromise = null;
const hasV6 = () => typeof window.paypal?.createInstance === 'function';
function loadSdk(src) {
  if (!/^https:\/\/www\.sandbox\.paypal\.com\//.test(src)) return Promise.reject(new Error('Only the PayPal sandbox SDK may be loaded.'));
  if (hasV6()) return Promise.resolve(window.paypal);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const fail = (message) => {
        clearTimeout(timer); script.onload = script.onerror = null; script.remove(); reject(new Error(message));
      };
      const loaded = () => {
        clearTimeout(timer); script.onload = script.onerror = null; resolve(window.paypal);
      };
      // Match PayPal's v6 loader resilience: allow slow downloads, and accept an available v6
      // namespace if the element's load event was missed. A v5 namespace is insufficient.
      const timer = setTimeout(() => {
        if (hasV6()) loaded(); else fail('PayPal sandbox checkout took too long to load.');
      }, 60_000);
      script.src = src;
      script.async = true;
      script.onload = () => {
        if (!hasV6()) { fail('PayPal SDK loaded without window.paypal'); return; }
        loaded();
      };
      script.onerror = () => fail('The PayPal sandbox SDK could not be loaded.');
      document.head.append(script);
    }).catch((error) => {
      sdkPromise = null; // only an explicit initialization retry loads again; never retry a payment here
      throw error;
    });
  }
  return sdkPromise;
}

/**
 * Initialize with the client id (PayPal's guide), and check eligibility. Some v6 failures only
 * appear at the eligibility call, so a failure anywhere in that pair retries once with a
 * server-issued, domain-bound client token before giving up with both reasons.
 */
async function initialize(paypal, config) {
  const base = { components: ['paypal-payments'], pageType: 'checkout', locale: 'en-US' };
  const attempt = async (auth) => {
    const instance = await paypal.createInstance({ ...base, ...auth });
    const methods = await instance.findEligibleMethods({ currencyCode: config.currency });
    return { instance, methods };
  };
  try {
    return await attempt({ clientId: config.clientId });
  } catch (first) {
    console.warn('[paypal] clientId initialization failed; trying a server-issued client token', first);
    try {
      const { accessToken } = await api.post('/api/paypal/client-token');
      return await attempt({ clientToken: accessToken });
    } catch (second) {
      throw new Error(`${first?.message ?? first} (client-token fallback: ${second?.message ?? second})`);
    }
  }
}

/**
 * Mount the sandbox PayPal button. `getOrderInput()` returns the adult-approved request or null.
 * Callbacks receive server responses only; nothing here can mark a payment as captured.
 */
export async function mountPayPalButton(container, { getOrderInput, getOwnership, onStatus, onResult }) {
  const config = await api.get('/api/paypal/config');
  if (config.mode !== 'sandbox') throw new Error('PayPal sandbox is not configured on the server.');
  const paypal = await loadSdk(config.sdkUrl);
  const { instance, methods } = await initialize(paypal, config);
  if (!methods.isEligible('paypal')) throw new Error('PayPal is not eligible for this sandbox account or browser.');

  let enabled = false, active = null, latest = null;
  const button = document.createElement('paypal-button');
  button.setAttribute('type', 'pay');
  button.id = 'paypal-button';
  const syncButton = () => {
    button.toggleAttribute('disabled', !enabled || Boolean(active));
    button.setAttribute('aria-disabled', String(!enabled || Boolean(active)));
    button.setAttribute('aria-busy', String(Boolean(active)));
  };
  const finish = (attempt) => { if (active === attempt) { active = null; syncButton(); } };
  const status = (attempt, value) => { if (latest === attempt) onStatus(value); };
  syncButton();
  container.replaceChildren(button);
  button.addEventListener('click', async () => {
    if (!enabled || active) return;
    const input = getOrderInput();
    if (!input) return;
    // One user-approved attempt owns its session, order and household scope. Late callbacks from a previous window
    // cannot cancel the next order or unlock its button. Returning from start() is not a financial outcome.
    const attempt = { orderId: null, order: null, ownership: { ...getOwnership() }, approving: false };
    active = latest = attempt; syncButton();
    try {
      const session = instance.createPayPalOneTimePaymentSession({
        async onApprove(data) {
          attempt.approving = true;
          status(attempt, { kind: 'working', message: 'Approved in PayPal. The server is capturing and checking it…' });
          try {
            await attempt.order;
            if (!attempt.orderId || (data?.orderId && data.orderId !== attempt.orderId)) throw new Error('The PayPal approval did not match this checkout. Check the contribution record.');
            onResult(await api.post(`/api/paypal/orders/${encodeURIComponent(attempt.orderId)}/capture`, attempt.ownership));
          } catch (error) {
            status(attempt, { kind: 'error', message: error.message, debugId: error.debugId });
          } finally { attempt.approving = false; finish(attempt); }
        },
        async onCancel() {
          if (attempt.approving || latest !== attempt) return;
          try {
            await attempt.order;
            if (attempt.approving) return; // approval may have arrived while creation was still resolving
            if (attempt.orderId) {
              onResult(await api.post(`/api/paypal/orders/${encodeURIComponent(attempt.orderId)}/cancel`, attempt.ownership));
              return; // the server's canonical receipt owns the result, including completed/pending
            }
          } catch { /* closing a window cannot establish a financial result when the local read fails */ }
          finally { if (!attempt.approving) finish(attempt); }
          status(attempt, { kind: 'info', message: 'PayPal window closed. Check the contribution record before trying again.' });
        },
        async onError(error) {
          if (latest !== attempt) return;
          console.error('[paypal] checkout error', error);
          status(attempt, { kind: 'error', message: 'PayPal sandbox reported an error. Check the contribution record before trying again.' });
          // Creation/capture may still be in flight. Do not release the button while either callback owns it.
          await attempt.order?.catch(() => {});
          if (!attempt.approving) finish(attempt);
        },
      });
      status(attempt, { kind: 'working', message: 'Creating a sandbox order on the server…' });
      // Docs: createOrder resolves to { orderId }; the server sets the amount. A click creates one request id.
      attempt.order = api.post('/api/paypal/orders', input).then((created) => {
        attempt.orderId = created.orderId;
        status(attempt, { kind: 'working', message: 'Waiting for approval in the PayPal sandbox window…' });
        return { orderId: created.orderId };
      });
      attempt.order.catch((error) => {
        status(attempt, { kind: 'error', message: error.message });
        if (!attempt.approving) finish(attempt);
      });
      await session.start({ presentationMode: 'auto' }, attempt.order);
    } catch (error) {
      console.error('[paypal] session.start failed', error);
      await attempt.order?.catch(() => {});
      status(attempt, { kind: 'error', message: error?.message || 'Could not open PayPal sandbox checkout. Check the contribution record before trying again.' });
      if (!attempt.approving) finish(attempt);
    }
  });
  return {
    setEnabled(value) { enabled = Boolean(value); syncButton(); },
    refresh: (orderId) => api.post(`/api/paypal/orders/${encodeURIComponent(orderId)}/refresh`, getOwnership()),
  };
}
