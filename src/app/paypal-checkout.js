import { api } from './api.js';

// PayPal JavaScript SDK v6 (sandbox host). The browser only starts checkout and reports approval;
// the server creates the order with its own amount and decides the outcome by capturing it.
// Unverified until run with real sandbox credentials: the SDK's docs disagree on whether
// createInstance takes clientId or a client token, so both are tried.

let sdkPromise = null;
function loadSdk(src) {
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      if (!/^https:\/\/www\.sandbox\.paypal\.com\//.test(src)) { reject(new Error('Only the PayPal sandbox SDK may be loaded.')); return; }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error('PayPal SDK loaded without window.paypal')));
      script.onerror = () => reject(new Error('The PayPal sandbox SDK could not be loaded.'));
      document.head.append(script);
    });
  }
  return sdkPromise;
}

async function createInstance(paypal, config) {
  const base = { components: ['paypal-payments'], pageType: 'checkout', locale: 'en-US' };
  try {
    return await paypal.createInstance({ ...base, clientId: config.clientId });
  } catch (first) {
    console.warn('[paypal] clientId initialization failed; trying a server-issued client token', first);
    const { accessToken } = await api.post('/api/paypal/client-token');
    return paypal.createInstance({ ...base, clientToken: accessToken });
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
  const instance = await createInstance(paypal, config);
  const methods = await instance.findEligibleMethods({ currencyCode: config.currency });
  if (!methods.isEligible('paypal')) throw new Error('PayPal is not eligible for this sandbox account or browser.');

  let currentOrderId = null;
  const session = instance.createPayPalOneTimePaymentSession({
    async onApprove(data) {
      const orderId = data?.orderId ?? currentOrderId;
      onStatus({ kind: 'working', message: 'Approved in PayPal. The server is capturing and checking it…' });
      try {
        const result = await api.post(`/api/paypal/orders/${encodeURIComponent(orderId)}/capture`, getOwnership());
        onResult(result);
      } catch (error) {
        onStatus({ kind: 'error', message: error.message, debugId: error.debugId });
      }
    },
    async onCancel() {
      if (currentOrderId) {
        try { onResult(await api.post(`/api/paypal/orders/${encodeURIComponent(currentOrderId)}/cancel`, getOwnership())); } catch { /* status below is enough */ }
      }
      onStatus({ kind: 'info', message: 'PayPal was closed before approval. Nothing was charged and progress is unchanged.' });
    },
    onError(error) {
      console.error('[paypal] checkout error', error);
      onStatus({ kind: 'error', message: 'PayPal sandbox reported an error. No progress was recorded.' });
    },
  });

  const button = document.createElement('paypal-button');
  button.setAttribute('type', 'pay');
  button.id = 'paypal-button';
  container.replaceChildren(button);
  button.addEventListener('click', async () => {
    const input = getOrderInput();
    if (!input) return;
    currentOrderId = null;
    onStatus({ kind: 'working', message: 'Creating a sandbox order on the server…' });
    // Docs: createOrder must resolve to { orderId }. The server sets the amount, not the browser.
    const orderPromise = api.post('/api/paypal/orders', input).then((created) => {
      currentOrderId = created.orderId;
      onStatus({ kind: 'working', message: 'Waiting for approval in the PayPal sandbox window…' });
      return { orderId: created.orderId };
    });
    orderPromise.catch((error) => onStatus({ kind: 'error', message: error.message }));
    try {
      await session.start({ presentationMode: 'auto' }, orderPromise);
    } catch (error) {
      console.error('[paypal] session.start failed', error);
      onStatus({ kind: 'error', message: error?.message || 'Could not open PayPal sandbox checkout.' });
    }
  });
  return {
    setEnabled(enabled) { button.toggleAttribute('disabled', !enabled); button.setAttribute('aria-disabled', String(!enabled)); },
    refresh: (orderId) => api.post(`/api/paypal/orders/${encodeURIComponent(orderId)}/refresh`, getOwnership()),
  };
}
