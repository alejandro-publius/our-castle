// What one contribution has done to the goal, read only from records the page already has. Two inputs matter:
// - the exact ledger credit and reversal rows for the capture and refund identities the server validated;
// - the times those local records carry.
// Pure: it never calls a provider or saves anything. An order amount, a status, a note or a saved check never becomes
// money here. When the records do not support a number, the answer says so instead of guessing one.

// The ledger kinds and source references the server writes for each provider (server/payments/contributions.mjs).
const BOOKS = Object.freeze({
  'paypal-sandbox': Object.freeze({ credit: 'contribution', reversal: 'refund', prefix: 'paypal' }),
  simulated: Object.freeze({ credit: 'simulated_contribution', reversal: 'simulated_refund', prefix: 'simulated' }),
});
// Order states that the server sets only together with a credited capture.
const SETTLED = new Set(['completed', 'refunded', 'partially_refunded']);
// Order states in which nothing has been counted yet but still could be.
const OPEN = new Set(['creating', 'created', 'approval_canceled', 'pending']);
// Within one instant: the order before its credit, a credit before its refunds, and saved records before a check.
const SEQUENCE = { order: 0, credit: 1, refund: 2, refund_pending: 2, refund_not_counted: 2, check: 3 };

const isCents = (n) => Number.isSafeInteger(n) && n > 0;
const isText = (s) => typeof s === 'string' && s.length > 0;
const instant = (iso) => (typeof iso === 'string' ? Date.parse(iso) : NaN);
const dated = (iso) => Number.isFinite(instant(iso));

/**
 * @param {object} contribution one record from `state.contributions`
 * @param {{ householdId: string, goalId: string, currency: string, entries: object[] }} scope the current household and
 *   goal, the goal's currency and `state.ledger.goalEntries`
 * @returns {{ known: false, reason: 'malformed'|'scope'|'inconsistent' }
 *   | { known: true, open: boolean, recordedCents: number, refundedCents: number, countsCents: number, history: object[] }}
 *   `history` is a new array, oldest first, holding only facts with a time. Neither input is changed.
 */
export function contributionStory(contribution, { householdId, goalId, currency, entries } = {}) {
  const unknown = (reason) => ({ known: false, reason });
  const c = contribution;
  const book = BOOKS[c?.provider];
  if (!book || !isText(c.id) || !Array.isArray(c.captures) || !Array.isArray(entries)) return unknown('malformed');
  // Only this household's goal, in its currency. Another household's, goal's or currency's money is never added here.
  if (!isText(householdId) || !isText(goalId) || !/^[A-Z]{3}$/.test(currency ?? '')
    || c.householdId !== householdId || c.goalId !== goalId || c.currency !== currency) return unknown('scope');

  // Ledger rows by exact source reference. A row without one cannot belong to this contribution.
  const byRef = new Map();
  for (const e of entries) if (isText(e?.sourceRef)) byRef.set(e.sourceRef, [...(byRef.get(e.sourceRef) ?? []), e]);
  const rowsFor = (ref) => byRef.get(ref) ?? [];
  // The one row that records a credit or reversal: exactly one, of the expected kind, direction, amount and currency.
  const theRow = (ref, kind, effect, cents) => {
    const rows = rowsFor(ref);
    const [row] = rows;
    return rows.length === 1 && row.kind === kind && row.effect === effect && row.amountCents === cents
      && row.currency === currency && dated(row.createdAt) ? row : null;
  };
  // The same identity under another provider's reference would mean the records disagree about what this payment was.
  const otherPrefixes = Object.values(BOOKS).map((b) => b.prefix).filter((p) => p !== book.prefix);
  const elsewhere = (type, id) => otherPrefixes.some((p) => rowsFor(`${p}-${type}:${id}`).length > 0);

  const credits = [], reversals = [], uncounted = [];
  const captureIds = new Set(), refundIds = new Set();
  for (const cap of c.captures) {
    if (!isText(cap?.captureId) || typeof cap.credited !== 'boolean' || !isCents(cap.amountCents) || cap.currency !== currency
      || !Number.isSafeInteger(cap.refundedCents) || cap.refundedCents < 0 || !Array.isArray(cap.refunds)) return unknown('malformed');
    if (captureIds.has(cap.captureId) || elsewhere('capture', cap.captureId)) return unknown('inconsistent');
    captureIds.add(cap.captureId);
    const creditRef = `${book.prefix}-capture:${cap.captureId}`;
    if (cap.credited) {
      const row = theRow(creditRef, book.credit, 1, cap.amountCents);
      if (!row) return unknown('inconsistent');
      credits.push({ row, captureId: cap.captureId });
    } else if (rowsFor(creditRef).length) return unknown('inconsistent'); // a credit row for a capture that never counted

    let reversed = 0;
    for (const r of cap.refunds) {
      if (!isText(r?.refundId) || typeof r.credited !== 'boolean' || !isCents(r.amountCents) || r.currency !== currency || !isText(r.status)) return unknown('malformed');
      if (refundIds.has(r.refundId) || elsewhere('refund', r.refundId)) return unknown('inconsistent');
      refundIds.add(r.refundId);
      const refundRef = `${book.prefix}-refund:${r.refundId}`;
      if (r.credited) {
        const row = cap.credited ? theRow(refundRef, book.reversal, -1, r.amountCents) : null;
        if (!row) return unknown('inconsistent');
        reversals.push({ row, refundId: r.refundId });
        reversed += r.amountCents;
      } else if (rowsFor(refundRef).length) return unknown('inconsistent'); // a reversal row for a refund never applied
      else uncounted.push(r);
    }
    // The capture's own refunded total must be exactly its reversal rows: none missing, none counted twice.
    if (reversed !== cap.refundedCents || reversed > cap.amountCents) return unknown('inconsistent');
  }
  // The server marks an order completed or refunded only together with a credited capture, and the reverse.
  if (SETTLED.has(c.status) !== credits.length > 0) return unknown('inconsistent');
  const recordedCents = credits.reduce((sum, x) => sum + x.row.amountCents, 0);
  const refundedCents = reversals.reduce((sum, x) => sum + x.row.amountCents, 0);

  // Dated facts, from the times the records carry. Nothing is dated by the order's last update or by the clock now.
  const facts = [];
  if (dated(c.createdAt)) facts.push({ kind: 'order', at: c.createdAt, approvedBy: isText(c.approvedBy) ? c.approvedBy : null });
  for (const { row, captureId } of credits) facts.push({ kind: 'credit', at: row.createdAt, cents: row.amountCents, captureId });
  for (const { row, refundId } of reversals) facts.push({ kind: 'refund', at: row.createdAt, cents: row.amountCents, refundId });
  for (const r of uncounted) {
    if (dated(r.createdAt)) facts.push({ kind: r.status === 'PENDING' ? 'refund_pending' : 'refund_not_counted', at: r.createdAt, cents: r.amountCents, refundId: r.refundId });
  }
  // The latest saved check, kept as a past result: it names the credit or refund records saved after it.
  const check = c.lastCheck;
  if (check && dated(check.checkedAt) && isText(check.verdict)) {
    const later = facts.filter((f) => (f.kind === 'credit' || f.kind === 'refund') && instant(f.at) > instant(check.checkedAt));
    facts.push({ kind: 'check', at: check.checkedAt, verdict: check.verdict, note: isText(check.note) ? check.note : null,
      before: [...new Set(later.map((f) => f.kind))] });
  }
  const history = facts.map((fact, index) => ({ fact, index }))
    .sort((a, b) => instant(a.fact.at) - instant(b.fact.at) || SEQUENCE[a.fact.kind] - SEQUENCE[b.fact.kind] || a.index - b.index)
    .map(({ fact }) => fact);
  return { known: true, open: OPEN.has(c.status), recordedCents, refundedCents, countsCents: recordedCents - refundedCents, history };
}

/** A short key for the story, for styling and tests: unavailable, none, refunded, partial or counted. */
export function storyKey(story) {
  if (!story.known) return 'unavailable';
  if (story.recordedCents === 0) return 'none';
  if (story.countsCents === 0) return 'refunded';
  return story.refundedCents > 0 ? 'partial' : 'counted';
}

/** The one sentence both receipts show. `money` formats integer cents with the existing formatter. */
export function countsSentence(story, money) {
  switch (storyKey(story)) {
    case 'unavailable': return 'How much of this counts can’t be shown from the saved records.';
    case 'none': return story.open ? 'No contribution has been counted yet.' : 'No contribution has been counted.';
    case 'refunded': return `All ${money(story.refundedCents)} was refunded, so none of this contribution counts toward the goal.`;
    default: return `${money(story.countsCents)} of this contribution counts toward the goal.`;
  }
}
