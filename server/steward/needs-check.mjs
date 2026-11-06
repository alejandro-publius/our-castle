// "Any contributions that need a PayPal check?" answered from the contribution views already loaded for this
// household's active goal. It reads saved checks and record statuses only: no model, no provider call, no write, and
// no claim of fresh verification. Each named receipt is returned so the interface can open it.
import { formatCents } from '../../src/core/rules.js';
import { checkStatus } from '../../src/core/check-status.js';

const REASON = {
  pending: 'pending in PayPal', failed: 'the last check did not get an answer from PayPal',
  mismatch: 'the last check did not match', action: 'the saved check needs a receipt recheck', refund_pending: 'a refund is pending',
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function needsCheckAnswer(list) {
  const payments = list.filter((c) => !c.simulated && c.providerOrderId);
  const statuses = payments.map((c) => ({ c, status: checkStatus(c) }));
  const flagged = statuses.filter((x) => x.status.needsCheck);
  const unchecked = statuses.filter((x) => x.status.key === 'unchecked');
  const money = (c) => formatCents(c.amountCents, c.currency);
  const sentences = [];
  if (!payments.length) {
    sentences.push(list.some((c) => c.simulated)
      ? 'There are no PayPal contributions for this goal; the example contributions are simulated and have no PayPal record.'
      : 'There are no PayPal contributions for this goal.');
  } else if (!flagged.length) {
    sentences.push(`Nothing needs a PayPal check right now across ${plural(payments.length, 'PayPal contribution', 'PayPal contributions')}.`);
  } else {
    sentences.push(`${plural(flagged.length, 'contribution needs', 'contributions need')} a PayPal check: `
      + `${flagged.map((x) => `${money(x.c)} (${REASON[x.status.key] ?? x.status.label.toLowerCase()})`).join('; ')}. Open the receipt and use Check with PayPal.`);
  }
  if (unchecked.length) {
    sentences.push(`${plural(unchecked.length, 'contribution has', 'contributions have')} no saved check.`);
  }
  sentences.push('This reads saved records only; no new PayPal check was made.');
  return {
    status: 'ok', source: 'local-records', kind: 'needs-check', answer: sentences.join(' '), warnings: [], model: null, paypalTools: false,
    verification: null, // nothing was looked up; saved records never become fresh verification
    receipts: [...flagged, ...unchecked].map((x) => ({ contributionId: x.c.id, orderId: x.c.providerOrderId, amount: money(x.c), status: x.status.label, needsCheck: x.status.needsCheck })),
    checks: [{ tool: 'read_household_ledger', source: 'Saved household records',
      summary: `Read ${plural(payments.length, 'PayPal contribution record', 'PayPal contribution records')} for this goal. No provider was contacted.` }],
  };
}
