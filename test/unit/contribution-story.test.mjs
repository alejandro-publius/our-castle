import test from 'node:test';
import assert from 'node:assert/strict';
import { contributionStory, countsSentence, storyKey } from '../../src/core/contribution-story.js';
import { formatCents } from '../../src/core/rules.js';

// Expected cents are written from each scenario ($15.00 recorded, $5.00 refunded, so $10.00 counts), never computed from
// the fixtures. Fixtures follow the shapes the server sends: state.contributions and state.ledger.goalEntries.
const money = (cents) => formatCents(cents, 'USD');
const SCOPE = { householdId: 'hh_alder', goalId: 'goal_alder', currency: 'USD' };
const T = (minute) => `2026-11-08T10:${String(minute).padStart(2, '0')}:00.000Z`;
const row = (id, kind, effect, amountCents, sourceRef, minute, extra = {}) => ({ id, kind, effect, amountCents, currency: 'USD', sourceRef, createdAt: T(minute), ...extra });
const START = row(1, 'starting_progress', 1, 6000, 'starting:goal_alder', 0, { source: 'user-reported' });
const refund = (refundId, amountCents, { credited = true, status = 'COMPLETED', minute = 30 } = {}) => ({ refundId, amountCents, currency: 'USD', status, credited, createdAt: T(minute) });
const capture = (captureId, { credited = true, amountCents = 1500, refundedCents = 0, status = 'COMPLETED', refunds = [] } = {}) =>
  ({ captureId, amountCents, currency: 'USD', status, credited, refundedCents, refunds });
const order = (overrides = {}) => ({ id: 'ctb_1', provider: 'paypal-sandbox', simulated: false, householdId: 'hh_alder', goalId: 'goal_alder',
  approvedBy: 'm_rowan', amountCents: 1500, currency: 'USD', status: 'completed', createdAt: T(1), updatedAt: T(59), captures: [], checks: [], lastCheck: null, ...overrides });
const story = (c, entries, scope = SCOPE) => contributionStory(c, { ...scope, entries });
const summary = (s) => (s.known ? [s.recordedCents, s.refundedCents, s.countsCents] : s.reason);

const credit15 = row(2, 'contribution', 1, 1500, 'paypal-capture:CAP1', 2);
const refund5 = row(3, 'refund', -1, 500, 'paypal-refund:REF1', 30);
const refund15 = row(3, 'refund', -1, 1500, 'paypal-refund:REF1', 30);

test('each story counts only settled ledger effects: completed, partial, full and pending refunds', () => {
  const cases = [
    { name: 'completed', c: order({ captures: [capture('CAP1')] }), entries: [START, credit15],
      want: [1500, 0, 1500], key: 'counted', sentence: '$15.00 of this contribution counts toward the goal.' },
    { name: '$15.00 credit, $5.00 refund', c: order({ status: 'partially_refunded', captures: [capture('CAP1', { refundedCents: 500, status: 'PARTIALLY_REFUNDED', refunds: [refund('REF1', 500)] })] }),
      entries: [START, credit15, refund5], want: [1500, 500, 1000], key: 'partial', sentence: '$10.00 of this contribution counts toward the goal.' },
    { name: 'full refund', c: order({ status: 'refunded', captures: [capture('CAP1', { refundedCents: 1500, status: 'REFUNDED', refunds: [refund('REF1', 1500)] })] }),
      entries: [START, credit15, refund15], want: [1500, 1500, 0], key: 'refunded', sentence: 'All $15.00 was refunded, so none of this contribution counts toward the goal.' },
    { name: 'pending refund is not subtracted', c: order({ captures: [capture('CAP1', { refunds: [refund('REF2', 500, { credited: false, status: 'PENDING' })] })] }),
      entries: [START, credit15], want: [1500, 0, 1500], key: 'counted', sentence: '$15.00 of this contribution counts toward the goal.' },
  ];
  for (const { name, c, entries, want, key, sentence } of cases) {
    const s = story(c, entries);
    assert.deepEqual(summary(s), want, name);
    assert.equal(storyKey(s), key, name);
    assert.equal(countsSentence(s, money), sentence, name);
  }
});

test('attempts that were never credited count nothing, with "yet" only while they still could', () => {
  const cases = [
    ['pending capture', order({ status: 'pending', captures: [capture('CAP1', { credited: false, status: 'PENDING' })] }), 'No contribution has been counted yet.'],
    ['awaiting approval', order({ status: 'created' }), 'No contribution has been counted yet.'],
    ['checkout closed', order({ status: 'approval_canceled' }), 'No contribution has been counted yet.'],
    ['declined', order({ status: 'declined', captures: [capture('CAP1', { credited: false, status: 'DECLINED' })] }), 'No contribution has been counted.'],
    ['rejected mismatch', order({ status: 'rejected' }), 'No contribution has been counted.'],
    // PayPal refunded the capture before anything was recorded here: the refund is kept, nothing is subtracted.
    ['refunded before it was recorded', order({ status: 'failed', captures: [capture('CAP1', { credited: false, status: 'REFUNDED', refunds: [refund('REF1', 1500, { credited: false })] })] }), 'No contribution has been counted.'],
  ];
  for (const [name, c, sentence] of cases) {
    const s = story(c, [START]);
    assert.deepEqual(summary(s), [0, 0, 0], name);
    assert.equal(storyKey(s), 'none', name);
    assert.equal(countsSentence(s, money), sentence, name);
  }
  const early = story(cases[5][1], [START]);
  assert.deepEqual(early.history.map((f) => [f.kind, f.cents ?? null]), [['order', null], ['refund_not_counted', 1500]]);
});

test('simulated contributions are read from their own simulated rows and references', () => {
  const c = order({ provider: 'simulated', simulated: true, status: 'refunded',
    captures: [capture('SIM-CAPTURE-ABC', { refundedCents: 1500, status: 'REFUNDED', refunds: [refund('SIM-REFUND-ABC-1', 1500)] })] });
  const entries = [START, row(2, 'simulated_contribution', 1, 1500, 'simulated-capture:SIM-CAPTURE-ABC', 1), row(3, 'simulated_refund', -1, 1500, 'simulated-refund:SIM-REFUND-ABC-1', 4)];
  assert.deepEqual(summary(story(c, entries)), [1500, 1500, 0]);
  // PayPal-style rows for the same ids are not this simulated record's.
  assert.equal(story(c, [START, row(2, 'contribution', 1, 1500, 'paypal-capture:SIM-CAPTURE-ABC', 1)]).reason, 'inconsistent');
});

test('only exact identities count; other records, bills, gifts and reported progress are never added', () => {
  const c = order({ status: 'partially_refunded', captures: [capture('CAP1', { refundedCents: 500, status: 'PARTIALLY_REFUNDED', refunds: [refund('REF1', 500)] })] });
  const noise = [
    row(4, 'contribution', 1, 2500, 'paypal-capture:CAP10', 5), // another contribution whose id only starts the same
    row(5, 'contribution', 1, 900, 'paypal-capture:XCAP1', 6), // ends the same
    row(6, 'refund', -1, 700, 'paypal-refund:CAP1', 7), // the capture id under the refund reference: not a refund of ours
    row(7, 'bill_paid', 0, 9000, 'bill:7', 8),
    row(8, 'gift_sent', 0, 4000, 'gift:8', 9),
    { id: 9, kind: 'contribution', effect: 1, amountCents: 1500, currency: 'USD', createdAt: T(10) }, // no reference at all
  ];
  assert.deepEqual(summary(story(c, [START, credit15, refund5, ...noise])), [1500, 500, 1000]);
});

test('another household, goal or currency is out of scope, and nothing is summed', () => {
  const c = order({ captures: [capture('CAP1')] });
  assert.equal(story({ ...c, householdId: 'hh_other' }, [START, credit15]).reason, 'scope');
  assert.equal(story({ ...c, goalId: 'goal_other' }, [START, credit15]).reason, 'scope');
  assert.equal(story({ ...c, currency: 'EUR' }, [START, credit15]).reason, 'scope');
  assert.equal(story(c, [START, credit15], { ...SCOPE, currency: 'usd' }).reason, 'scope');
  assert.equal(countsSentence(story({ ...c, goalId: 'goal_other' }, [START, credit15]), money), 'How much of this counts can’t be shown from the saved records.');
});

test('missing, duplicated or conflicting evidence gives no number at all', () => {
  const partial = (overrides) => order({ status: 'partially_refunded', captures: [capture('CAP1', { refundedCents: 500, status: 'PARTIALLY_REFUNDED', refunds: [refund('REF1', 500)], ...overrides })] });
  const cases = [
    ['credited capture without its row', order({ captures: [capture('CAP1')] }), [START], 'inconsistent'],
    ['two rows for one credit', order({ captures: [capture('CAP1')] }), [START, credit15, { ...credit15, id: 9 }], 'inconsistent'],
    ['row amount differs from the capture', order({ captures: [capture('CAP1')] }), [START, { ...credit15, amountCents: 1400 }], 'inconsistent'],
    ['credit row with the wrong direction', order({ captures: [capture('CAP1')] }), [START, { ...credit15, effect: -1 }], 'inconsistent'],
    ['credit row of another kind', order({ captures: [capture('CAP1')] }), [START, { ...credit15, kind: 'simulated_contribution' }], 'inconsistent'],
    ['credit row in another currency', order({ captures: [capture('CAP1')] }), [START, { ...credit15, currency: 'EUR' }], 'inconsistent'],
    ['credit row with no time', order({ captures: [capture('CAP1')] }), [START, { ...credit15, createdAt: null }], 'inconsistent'],
    ['credit row with a null amount', order({ captures: [capture('CAP1')] }), [START, { ...credit15, amountCents: null }], 'inconsistent'],
    ['row for a capture that never counted', order({ status: 'pending', captures: [capture('CAP1', { credited: false, status: 'PENDING' })] }), [START, credit15], 'inconsistent'],
    ['credited refund without its reversal', partial({}), [START, credit15], 'inconsistent'],
    ['reversal for a refund never applied', partial({ refundedCents: 0, refunds: [refund('REF1', 500, { credited: false, status: 'PENDING' })] }), [START, credit15, refund5], 'inconsistent'],
    ['refunded total disagrees with the reversals', partial({ refundedCents: 0 }), [START, credit15, refund5], 'inconsistent'],
    ['reversal larger than the credit', order({ status: 'refunded', captures: [capture('CAP1', { refundedCents: 2000, refunds: [refund('REF1', 2000)] })] }), [START, credit15, row(3, 'refund', -1, 2000, 'paypal-refund:REF1', 30)], 'inconsistent'],
    ['completed with nothing credited', order({ status: 'completed', captures: [capture('CAP1', { credited: false })] }), [START], 'inconsistent'],
    ['credited while the order reads declined', order({ status: 'declined', captures: [capture('CAP1')] }), [START, credit15], 'inconsistent'],
    ['duplicate capture ids', order({ captures: [capture('CAP1'), capture('CAP1')] }), [START, credit15], 'inconsistent'],
    ['duplicate refund ids', partial({ refundedCents: 1000, refunds: [refund('REF1', 500), refund('REF1', 500)] }), [START, credit15, refund5], 'inconsistent'],
    ['the same capture under another provider', order({ captures: [capture('CAP1')] }), [START, credit15, row(9, 'simulated_contribution', 1, 1500, 'simulated-capture:CAP1', 3)], 'inconsistent'],
    ['a capture amount that is not whole cents', order({ captures: [capture('CAP1', { amountCents: 15.5 })] }), [START, credit15], 'malformed'],
    ['a refund with a null amount', partial({ refunds: [{ ...refund('REF1', 500), amountCents: null }] }), [START, credit15, refund5], 'malformed'],
    ['captures that are not a list', order({ captures: { length: 1 } }), [START, credit15], 'malformed'],
    ['an unknown provider', order({ provider: 'cash', captures: [capture('CAP1')] }), [START, credit15], 'malformed'],
  ];
  for (const [name, c, entries, reason] of cases) {
    const s = story(c, entries);
    assert.deepEqual([s.known, s.reason], [false, reason], name);
    assert.equal('countsCents' in s || 'history' in s, false, `${name}: no number and no timeline`);
  }
  // A ledger that is not a list of rows is not counted as one.
  assert.equal(story(order({ captures: [capture('CAP1')] }), { length: 2, 0: START, 1: credit15 }).reason, 'malformed');
  assert.equal(story(order({ captures: [capture('CAP1')] }), null).reason, 'malformed');
  assert.equal(story(null, [START]).reason, 'malformed');
});

test('the history uses only the times its records carry, oldest first, and a saved check stays in the past', () => {
  const checkedBeforeRefund = { checkedAt: T(20), verdict: 'match', note: 'PayPal and the ledger agree.' };
  const c = order({ status: 'partially_refunded', lastCheck: checkedBeforeRefund, checks: [checkedBeforeRefund],
    captures: [capture('CAP1', { refundedCents: 500, status: 'PARTIALLY_REFUNDED', refunds: [refund('REF1', 500, { minute: 29 }), refund('REF2', 300, { credited: false, status: 'PENDING', minute: 40 })] })] });
  const s = story(c, [START, credit15, refund5]);
  // The order's creation time, the ledger rows' times, the pending refund's own time and the check's time. The order's
  // last update (minute 59) and the clock are never used.
  assert.deepEqual(s.history.map((f) => [f.kind, f.at, f.cents ?? null]), [
    ['order', T(1), null], ['credit', T(2), 1500], ['check', T(20), null], ['refund', T(30), 500], ['refund_pending', T(40), 300]]);
  assert.deepEqual(s.history[2].before, ['refund'], 'the match was saved before the later refund');
  assert.equal(s.history[0].approvedBy, 'm_rowan');

  const checkedAfter = story({ ...c, lastCheck: { ...checkedBeforeRefund, checkedAt: T(45) } }, [START, credit15, refund5]);
  assert.deepEqual(checkedAfter.history.at(-1).before, [], 'a check after every record names none');
  const beforeCredit = story({ ...c, lastCheck: { ...checkedBeforeRefund, checkedAt: T(1) } }, [START, credit15, refund5]);
  assert.deepEqual(beforeCredit.history.find((f) => f.kind === 'check').before, ['credit', 'refund']);

  // A missing order time is left out rather than invented; a check without a time is not shown.
  const undated = story({ ...c, createdAt: 'not a date', lastCheck: { verdict: 'match' } }, [START, credit15, refund5]);
  assert.deepEqual(undated.history.map((f) => f.kind), ['credit', 'refund', 'refund_pending']);
  // Records saved in the same instant keep the order, then the credit.
  const sameInstant = story(order({ createdAt: T(2), captures: [capture('CAP1')] }), [START, credit15]);
  assert.deepEqual(sameInstant.history.map((f) => f.kind), ['order', 'credit']);
});

test('reading a story changes neither input, whatever their order', () => {
  const freeze = (value) => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const c = freeze(order({ status: 'partially_refunded', lastCheck: { checkedAt: T(20), verdict: 'match', note: 'Agree.' },
    captures: [capture('CAP1', { refundedCents: 500, status: 'PARTIALLY_REFUNDED', refunds: [refund('REF1', 500)] })] }));
  const entries = freeze([refund5, START, credit15]); // not in id order
  const before = JSON.stringify([c, entries]);
  const s = story(c, entries);
  assert.deepEqual(summary(s), [1500, 500, 1000]);
  assert.deepEqual(s.history.map((f) => f.kind), ['order', 'credit', 'check', 'refund']);
  assert.equal(JSON.stringify([c, entries]), before);
});
