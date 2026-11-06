import test from 'node:test';
import assert from 'node:assert/strict';
import { checkStatus } from '../../src/core/check-status.js';

// The compact saved-check status is derived from the record alone. These cases pin the wording and the one rule that
// matters most: a newer failed check is never hidden behind an older success, and a pending match is never "completed".
const check = (overrides) => ({ checkedAt: '2026-11-03T20:00:00.000Z', verdict: 'match', outcome: 'already_completed', note: 'PayPal and the ledger agree.',
  paypalOrderStatus: 'COMPLETED', captureId: 'CAP1', captureStatus: 'COMPLETED', amountCents: 1500, currency: 'USD', refundIds: [], ...overrides });
const record = (status, checks = [], extra = {}) => ({ id: 'ctb_1', simulated: false, providerOrderId: 'ORDER1', status, captures: [], checks, lastCheck: checks[0] ?? null, ...extra });

test('completed match, pending match, refunds and failed checks read differently', () => {
  assert.deepEqual(checkStatus(record('completed', [check()])), { key: 'match', label: 'Checked · matches PayPal', short: 'checked, matches', tone: 'ok', needsCheck: false });
  const pending = checkStatus(record('pending', [check({ captureStatus: 'PENDING', outcome: 'pending', note: 'Pending in PayPal, and not counted yet.' })]));
  assert.deepEqual(pending, { key: 'pending', label: 'Checked · still pending', short: 'checked, pending', tone: 'warn', needsCheck: true });
  assert.notEqual(pending.tone, 'ok', 'a pending match never looks like a completed payment');
  assert.equal(checkStatus(record('refunded', [check({ captureStatus: 'REFUNDED', refundIds: ['REF1'], outcome: 'refunded' })])).label, 'Checked · refunded');
  assert.equal(checkStatus(record('partially_refunded', [check({ captureStatus: 'PARTIALLY_REFUNDED', refundIds: ['REF1'] })])).label, 'Checked · partly refunded');
  assert.deepEqual(checkStatus(record('completed', [check({ verdict: 'unavailable', outcome: 'unavailable', captureId: null, captureStatus: null, amountCents: null, note: 'PayPal did not answer this check. Nothing was changed.' })])),
    { key: 'failed', label: 'Check failed · PayPal did not answer', short: 'check failed', tone: 'bad', needsCheck: true });
  assert.deepEqual(checkStatus(record('rejected', [check({ verdict: 'differs', outcome: 'rejected_mismatch', amountCents: 5000 })])).key, 'mismatch');
  assert.equal(checkStatus(record('pending', [check({ verdict: 'action', outcome: 'pending' })])).label, 'Needs a PayPal check');
  assert.equal(checkStatus(record('created', [check({ captureStatus: null, captureId: null, note: 'Not captured in PayPal, and not counted in the ledger.' })])).label, 'Checked · not paid yet');
});

test('a captured payment with no saved check says so without implying failure; pending with no check asks for one', () => {
  assert.deepEqual(checkStatus(record('completed')), { key: 'unchecked', label: 'No saved check', short: 'no saved check', tone: 'muted', needsCheck: false });
  assert.deepEqual(checkStatus(record('pending')), { key: 'pending', label: 'Pending · not checked yet', short: 'pending, not checked', tone: 'warn', needsCheck: true });
  for (const status of ['created', 'approval_canceled', 'declined', 'failed', 'rejected']) assert.equal(checkStatus(record(status)).key, 'none', status);
});

test('a newer failed check is never replaced by an older successful one', () => {
  const older = check({ checkedAt: '2026-11-03T20:00:00.000Z' });
  const newer = check({ checkedAt: '2026-11-04T09:00:00.000Z', verdict: 'unavailable', outcome: 'unavailable', captureId: null, captureStatus: null, amountCents: null, note: 'PayPal did not answer this check. Nothing was changed.' });
  const status = checkStatus(record('completed', [newer, older]));
  assert.equal(status.key, 'failed');
  assert.equal(status.tone, 'bad');
  // And the reverse order of events reads as the success it is.
  assert.equal(checkStatus(record('completed', [older, newer])).key, 'match');
});

test('a match saved before a later refund is not shown as a current match', () => {
  assert.deepEqual(checkStatus(record('refunded', [check()])), { key: 'stale', label: 'Checked before the refund', short: 'checked before refund', tone: 'muted', needsCheck: false });
});

test('simulated and non-PayPal records have no saved-check status', () => {
  assert.equal(checkStatus(record('completed', [check()], { simulated: true })).key, 'none');
  assert.equal(checkStatus(record('completed', [], { providerOrderId: null })).key, 'none');
  assert.equal(checkStatus(null).key, 'none');
});
