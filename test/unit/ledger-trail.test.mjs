import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerTrail } from '../../src/core/ledger.js';

const entry = (id, amountCents, effect = 1, sourceRef = 'reported:' + id) =>
  ({ id, kind: effect < 0 ? 'refund' : id === 1 ? 'starting_progress' : 'contribution', effect, amountCents, sourceRef });
function fixture(entries, contributions = [], bills = []) {
  return { goal: { targetCents: 30000 }, ledger: { goalEntries: entries, bills, gifts: [] }, contributions };
}
test('the trail links capture/refund records to their order and shows one first milestone crossing', () => {
  const payment = { id: 'c1', status: 'refunded', captures: [{ captureId: 'CAP1', credited: true, refunds: [{ refundId: 'REF1' }] }] };
  const rows = ledgerTrail(fixture([
    entry(1, 6000), entry(2, 1500, 1, 'paypal-capture:CAP1'),
    entry(3, 1500, -1, 'paypal-refund:REF1'), entry(4, 1500),
  ], [payment]));
  assert.deepEqual(rows.map((r) => r.afterCents), [6000, 7500, 6000, 7500]);
  assert.deepEqual(rows.map((r) => r.districts), [[], ['manor'], [], []]);
  assert.equal(rows[1].contribution.id, 'c1');
  assert.equal(rows[2].contribution.id, 'c1');
  assert.equal(rows.length, 4, 'a represented order does not become a duplicate credit row');
});
test('pending/failed orders are inspectable with no credited effect or milestone', () => {
  const attempts = ['pending', 'failed'].map((status) => ({ id: status, status, captures: [] }));
  const rows = ledgerTrail(fixture([entry(1, 6000)], attempts));
  assert.equal(rows.length, 3);
  for (const row of rows.slice(1)) {
    assert.equal(row.entry, null);
    assert.equal(row.afterCents, null);
    assert.deepEqual(row.districts, []);
  }
  assert.equal(rows[0].afterCents, 6000);
});
test('bill/gift records never count as savings or create utility-provider rewards', () => {
  const rows = ledgerTrail(fixture([entry(1, 6000)], [], [{ ...entry(2, 90000, 0), kind: 'bill_paid' }]));
  assert.equal(rows[1].category, 'bill');
  assert.equal(rows[1].afterCents, null);
  assert.deepEqual(rows[1].districts, []);
  assert.equal(rows[0].afterCents, 6000);
});
