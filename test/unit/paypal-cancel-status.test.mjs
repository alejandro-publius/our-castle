import test from 'node:test';
import assert from 'node:assert/strict';
import { contribution, setupDomain } from '../helpers/setup.mjs';

// A closed SDK window is an observation, not proof that a capture did not happen. Both adapters use only the
// stateful fake sandbox. Cancellation must preserve the server's canonical result and make no provider call.
const rows = db => JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
for (const adapter of ['rest', 'sdk']) {
  for (const state of ['completed', 'refunded', 'pending', 'declined']) {
    test(`[${adapter}] a late cancel preserves a ${state} record and reports its current result`, async () => {
      const e = setupDomain({ mode: 'sandbox', adapter, paypalOptions: state === 'pending' ? { captureStatus: 'PENDING' }
        : state === 'declined' ? { captureError: { status: 422, issue: 'INSTRUMENT_DECLINED' } } : {} });
      try {
        const { orderId } = await e.service.createPayPalOrder(contribution());
        const owner = { providerOrderId: orderId, householdId: e.householdId, goalId: e.goalId };
        const captured = await e.service.capturePayPalOrder(owner);
        if (state === 'refunded') await e.service.refundPayPalCapture({ captureId: captured.contribution.captures[0].captureId,
          householdId: e.householdId, approverId: 'm_rowan', approvalConfirmed: true });
        const before = rows(e.db), calls = e.fake.requests.length;
        const result = e.service.cancelPayPalOrder(owner);
        assert.equal(result.contribution.status, state);
        assert.equal(result.outcome, ['completed', 'refunded'].includes(state) ? 'already_completed' : state === 'pending' ? 'pending' : 'record_unchanged');
        assert.equal(result.progress.progressCents, state === 'completed' ? 7500 : 6000);
        assert.equal(rows(e.db), before, 'closing the window changes no application row');
        assert.equal(e.fake.requests.length, calls, 'no capture, refund or even provider read is sent');
      } finally { e.db.close(); }
    });
  }

  test(`[${adapter}] a locally canceled approval does not claim a charge is impossible and a later capture still credits once`, async () => {
    const e = setupDomain({ mode: 'sandbox', adapter });
    try {
      const { orderId } = await e.service.createPayPalOrder(contribution());
      const owner = { providerOrderId: orderId, householdId: e.householdId, goalId: e.goalId };
      const calls = e.fake.requests.length;
      const canceled = e.service.cancelPayPalOrder(owner);
      assert.equal(canceled.outcome, 'canceled');
      assert.equal(canceled.contribution.status, 'approval_canceled');
      assert.doesNotMatch(canceled.contribution.statusDetail, /nothing was charged|without paying/i);
      assert.equal(e.fake.requests.length, calls);
      const late = await e.service.capturePayPalOrder(owner);
      assert.equal(late.progress.progressCents, 7500);
      assert.equal(late.contribution.status, 'completed');
      assert.equal((await e.service.capturePayPalOrder(owner)).outcome, 'already_completed');
      assert.equal(e.fake.requests.filter(r => r.pathname.endsWith('/capture')).length, 1);
      assert.equal(e.db.prepare("SELECT count(*) AS n FROM ledger_entries WHERE kind='contribution'").get().n, 1);
    } finally { e.db.close(); }
  });

  test(`[${adapter}] cancel still refuses a foreign household or goal before reading a provider or changing records`, async () => {
    const e = setupDomain({ mode: 'sandbox', adapter });
    try {
      const { orderId } = await e.service.createPayPalOrder(contribution());
      const before = rows(e.db), calls = e.fake.requests.length;
      for (const foreign of [{ householdId: 'foreign', goalId: e.goalId }, { householdId: e.householdId, goalId: 'foreign' }]) {
        assert.throws(() => e.service.cancelPayPalOrder({ providerOrderId: orderId, ...foreign }), { code: 'order_mismatch' });
      }
      assert.equal(rows(e.db), before); assert.equal(e.fake.requests.length, calls);
    } finally { e.db.close(); }
  });
}
