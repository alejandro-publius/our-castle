import { PayPalAgentToolkit } from '@paypal/agent-toolkit/openai';
import { PAYPAL_READ_TOOLS } from '../../src/core/steward-policy.js';

// PayPal's Agent Toolkit, restricted to two read-only actions. The steward can look up an order and
// list sandbox transactions; it is never given create, capture ("pay_order"), refund, invoice or
// subscription tools. Arguments are rebuilt by the server, never passed through from the model.
export const READ_ONLY_ACTIONS = Object.freeze({ orders: Object.freeze({ get: true }), transactions: Object.freeze({ list: true }) });
const ALLOWED_TOOLS = new Set(PAYPAL_READ_TOOLS);
const ORDER_ID = /^[A-Z0-9]{17,32}$/;

export function createPayPalReadTools({ clientId, clientSecret, toolkit = null, now = () => new Date(), timeoutMs = 30_000 }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) throw new Error('PayPal tool timeout must be a positive 32-bit integer.');
  const kit = toolkit ?? new PayPalAgentToolkit({
    clientId,
    clientSecret,
    // context.sandbox defaults to false (production) in the toolkit, so it is set explicitly.
    configuration: { actions: READ_ONLY_ACTIONS, context: { sandbox: true } },
  });
  const baseUrl = kit.client?.getBaseUrl?.() ?? '';
  let endpoint;
  try { endpoint = new URL(baseUrl); } catch { /* rejected below */ }
  if (!endpoint || endpoint.protocol !== 'https:' || !['api.sandbox.paypal.com', 'api-m.sandbox.paypal.com'].includes(endpoint.host) || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash)
    throw new Error('The PayPal Agent Toolkit must point at the PayPal sandbox.');
  const enabled = kit.getTools().map((t) => t.function?.name);
  for (const name of enabled) if (!ALLOWED_TOOLS.has(name)) throw new Error(`Refusing to start: PayPal tool "${name}" is not read-only.`);

  async function run(name, args) {
    if (!ALLOWED_TOOLS.has(name)) throw new Error(`PayPal tool "${name}" is not allowed.`);
    let timer;
    try {
      // The toolkit does not expose a per-call abort/timeout option. Bound the answer's wait;
      // a late read may finish upstream, but cannot become proof for this answer. Never retry here.
      const message = await Promise.race([
        kit.handleToolCall({ id: `steward_${Date.now()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('PayPal did not respond in time. Check this payment again later.'), { code: 'PAYPAL_TOOL_TIMEOUT' })), timeoutMs); }),
      ]);
      try { return JSON.parse(message.content); } catch { return { error: { message: 'PayPal tool returned non-JSON output.' } }; }
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    tools: enabled,
    baseUrl,
    /** Look up one order the server already knows belongs to this household. */
    getOrder(orderId) {
      if (!ORDER_ID.test(orderId)) throw new Error('Invalid PayPal order id.');
      return run('get_order', { id: orderId });
    },
    /** List sandbox transactions for the last `days` days (1–31, PayPal's maximum window). */
    listTransactions({ days, status }) {
      const span = Math.min(31, Math.max(1, Number.isInteger(days) ? days : 7));
      const end = now();
      const start = new Date(end.getTime() - span * 86_400_000);
      return run('list_transactions', {
        start_date: start.toISOString(),
        end_date: end.toISOString(),
        transaction_status: ['S', 'P', 'D', 'V'].includes(status) ? status : 'S',
      });
    },
  };
}
