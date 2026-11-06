// The compact saved-check status of one PayPal contribution, read from the record the server already sends: its own
// status and the newest saved "Check with PayPal" result (`lastCheck`, newest first whatever its verdict, so a later
// failed check is never hidden behind an earlier success). Pure and shared by the browser and the server. It never
// calls a provider, never implies a check that was not made, and never turns a pending match into a completed payment.

const REFUNDED = new Set(['REFUNDED', 'PARTIALLY_REFUNDED']);
const CHECKABLE = new Set(['pending', 'completed', 'refunded', 'partially_refunded']);
const status = (key, label, short, tone, needsCheck) => ({ key, label, short, tone, needsCheck });
const NONE = status('none', '', '', 'muted', false);

/**
 * @returns {{ key: string, label: string, short: string, tone: 'ok'|'warn'|'bad'|'muted', needsCheck: boolean }}
 *   `label` is the receipt wording, `short` the one-line grid wording, `needsCheck` whether the family should run
 *   "Check with PayPal" on this record (pending, failed, mismatched or completed-but-uncounted).
 */
export function checkStatus(c) {
  if (!c || c.simulated || !c.providerOrderId) return NONE;
  const k = c.lastCheck ?? null;
  if (!k) {
    if (c.status === 'pending') return status('pending', 'Pending · not checked yet', 'pending, not checked', 'warn', true);
    if (CHECKABLE.has(c.status)) return status('unchecked', 'No saved check', 'no saved check', 'muted', false);
    return NONE;
  }
  if (k.verdict === 'unavailable') return status('failed', 'Check failed · PayPal did not answer', 'check failed', 'bad', true);
  if (k.verdict === 'differs') return status('mismatch', 'Check failed · did not match', 'check failed', 'bad', true);
  if (k.verdict === 'action') return status('action', 'Needs a PayPal check', 'needs a check', 'warn', true);
  if (k.verdict !== 'match') return status('unknown', 'Check saved', 'check saved', 'muted', false);
  if (REFUNDED.has(k.captureStatus) || (k.refundIds?.length ?? 0) > 0) {
    return status('refunded', k.captureStatus === 'PARTIALLY_REFUNDED' ? 'Checked · partly refunded' : 'Checked · refunded', 'checked, refunded', 'muted', false);
  }
  // The record was refunded after this check: the match is true of an earlier state, not of the refund.
  if (c.status === 'refunded' || c.status === 'partially_refunded') return status('stale', 'Checked before the refund', 'checked before refund', 'muted', false);
  if (k.captureStatus === 'PENDING') return status('pending', 'Checked · still pending', 'checked, pending', 'warn', true);
  if (k.captureStatus === 'COMPLETED') return status('match', 'Checked · matches PayPal', 'checked, matches', 'ok', false);
  return status('uncaptured', 'Checked · not paid yet', 'checked, not paid', 'warn', false);
}
