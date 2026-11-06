// Read the contribution views already loaded from this household's active goal. This never calls a provider or writes.
const stamp = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) + ' UTC';
const validTime = (iso) => typeof iso === 'string' && Number.isFinite(Date.parse(iso));
const statusText = { completed: 'completed', refunded: 'refunded', partially_refunded: 'partly refunded', pending: 'pending', created: 'awaiting approval', approval_canceled: 'canceled', declined: 'declined', failed: 'failed', rejected: 'rejected' };

export function confirmationHistoryAnswer(list, focusOrderId = null) {
  const order = list.find(c => !c.simulated && c.providerOrderId && (!focusOrderId || c.providerOrderId === focusOrderId));
  const checks = order?.checks ?? [];
  const latest = checks[0] ?? null;
  // A pending/uncaptured 'match' means the records agree; it is not a confirmed payment. Bind a historical completed
  // check to the credited capture, exact amount and currency before describing it as a recorded confirmation.
  const confirmed = checks.find(k => k.verdict === 'match' && k.captureStatus === 'COMPLETED' && validTime(k.checkedAt)
    && k.amountCents === order.amountCents && k.currency === order.currency
    && order.captures.some(c => c.credited && c.captureId === k.captureId && c.amountCents === k.amountCents && c.currency === k.currency));
  const sentences = [];
  if (confirmed) sentences.push(`A saved check confirmed this contribution at ${stamp(confirmed.checkedAt)}.`);
  else if (!order) sentences.push(list.some(c => c.simulated) ? 'Example contributions are simulated; there is no saved PayPal confirmation for this goal.' : 'There is no saved PayPal confirmation for this goal.');
  else sentences.push('No completed-payment confirmation time is saved for this contribution.');
  if (order && (!confirmed || order.status !== 'completed')) sentences.push(`The ledger currently records it as ${statusText[order.status] ?? 'unresolved'}.`);
  if (latest && latest !== confirmed && validTime(latest.checkedAt)) {
    const state = latest.verdict === 'unavailable' ? 'unavailable' : latest.verdict === 'differs' ? 'a mismatch'
      : latest.verdict === 'action' ? 'needing a receipt recheck' : latest.captureStatus === 'PENDING' ? 'pending'
        : latest.captureStatus === 'REFUNDED' ? 'refunded' : latest.captureStatus === 'PARTIALLY_REFUNDED' ? 'partly refunded' : 'a recorded status check';
    sentences.push(`The latest saved check at ${stamp(latest.checkedAt)} was ${state}.`);
  }
  sentences.push('No new PayPal check was made.');
  return {
    status: 'ok', source: 'local-records', answer: sentences.join(' '), warnings: [], model: null, paypalTools: false,
    verification: null, // This request did not run get_order; historical evidence cannot become fresh verification.
    recordedConfirmation: order ? { orderId: order.providerOrderId, checkedAt: confirmed?.checkedAt ?? null,
      latestCheckAt: latest?.checkedAt ?? null, latestVerdict: latest?.verdict ?? null, ledgerStatus: order.status } : null,
    checks: [{ tool: 'read_household_ledger', source: 'Saved household records',
      summary: order ? `Read ${checks.length} saved check${checks.length === 1 ? '' : 's'} for this contribution. No provider was contacted.` : 'Read this goal’s local contribution records. No provider was contacted.' }],
  };
}
