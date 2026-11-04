import test from 'node:test';
import assert from 'node:assert/strict';
import {
  centsToDecimalString, decimalStringToCents, formatCents, formatPercent, milestoneCents, milestoneSpaces, nextMilestone,
  parseAmountToCents, positionForProgress, tierForProgress,
} from '../../src/core/rules.js';

test('default demo arithmetic: $60 of $300 is space 4, a $15 contribution reaches the Manor at space 5', () => {
  assert.equal(positionForProgress(6000, 30000), 4);
  assert.equal(tierForProgress(6000, 30000), 0);
  assert.equal(positionForProgress(7500, 30000), 5);
  assert.equal(tierForProgress(7500, 30000), 1);
  const next = nextMilestone(6000, 30000);
  assert.equal(next.key, 'manor');
  assert.equal(next.targetCents, 7500);
  assert.equal(next.awayCents, 1500);
});

test('milestones are 25%, 60% and 100%, rounded up to whole cents', () => {
  assert.deepEqual([25, 60, 100].map((p) => milestoneCents(30000, p)), [7500, 18000, 30000]);
  assert.equal(milestoneCents(1001, 25), 251); // 250.25 rounds up, never down
  assert.equal(tierForProgress(250, 1001), 0);
  assert.equal(tierForProgress(251, 1001), 1);
  assert.deepEqual(milestoneSpaces(30000).map((m) => m.space), [5, 12, 20]);
});

test('board position is clamped to the route', () => {
  assert.equal(positionForProgress(-500, 30000), 0);
  assert.equal(positionForProgress(30000, 30000), 20);
  assert.equal(positionForProgress(99999, 30000), 20);
  assert.equal(positionForProgress(100, 0), 0);
  assert.equal(nextMilestone(30000, 30000), null);
});

test('amount parsing is strict and integer-based', () => {
  assert.equal(parseAmountToCents('15'), 1500);
  assert.equal(parseAmountToCents('$15.5'), 1550);
  assert.equal(parseAmountToCents('1,200.00'), 120000);
  assert.equal(parseAmountToCents('0.07'), 7);
  for (const bad of ['', 'abc', '15.555', '-5', '1,20', '1e3', '15..0']) assert.equal(parseAmountToCents(bad), null, bad);
});

test('provider decimal strings round-trip without floating point drift', () => {
  assert.equal(centsToDecimalString(1500), '15.00');
  assert.equal(centsToDecimalString(7), '0.07');
  assert.equal(decimalStringToCents('15.00'), 1500);
  assert.equal(decimalStringToCents('0.1'), 10);
  assert.equal(decimalStringToCents('15.001'), null);
  assert.equal(decimalStringToCents(15), null);
  assert.throws(() => centsToDecimalString(1.5));
  assert.equal(formatCents(123456789), '$1,234,567.89');
  assert.equal(formatPercent(7500, 30000), '25%');
  assert.equal(formatPercent(1, 3), '33.3%');
});
