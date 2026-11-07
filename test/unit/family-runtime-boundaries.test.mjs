import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanText, rulesAmounts } from '../../server/planner/basis.mjs';
import { PlannerProviderError } from '../../server/planner/anthropic-provider.mjs';
import { createPayPalClient } from '../../server/payments/paypal-client.mjs';
import { createFakePayPal } from '../helpers/fake-paypal.mjs';
import { familyWith, startServer } from '../helpers/family-http.mjs';

// Real HTTP, software passkeys, memory-only households and gated fake providers. No external calls.
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
async function removeAdult(owner, adultId) {
  assert.equal((await owner.call('POST', `/api/family/members/${adultId}/revoke`, {})).status, 200);
}
function privateResponseEnded(result) {
  assert.equal(result.status, 401, 'ended access gets an authorization error');
  assert.ok(['session_required', 'session_expired'].includes(result.json.error.code));
  assert.equal(result.json.state, undefined);
  assert.equal(result.json.plan, undefined);
  assert.equal(result.json.contribution, undefined);
}

for (const [reason, output] of [
  ['revocation', 'valid'], ['idle expiry', 'valid'], ['sign-out', 'valid'], ['renewed sign-in', 'valid'],
  ['revocation', 'invalid'], ['revocation', 'provider error'], ['active', 'valid'],
]) test(`${reason} during a ${output} AI plan wait controls storage and the private response`, { timeout: 10_000 }, async () => {
  const entered = gate(), finish = gate();
  const s = await startServer({ extra: { aiProvider: {
    provider: 'anthropic', model: 'fake-planner',
    async proposePlan(basis) {
      entered.release(); await finish.promise;
      if (output === 'provider error') throw new PlannerProviderError('rate_limit', 'Fake provider error');
      return { output: output === 'invalid' ? {} : buildPlanText(basis, rulesAmounts(basis)), model: 'fake-planner', requestId: 'fake-plan' };
    },
  } } });
  try {
    const { owner, Ash: adult } = await familyWith(s, [['Ash', 'adult']]);
    const before = (await adult.call('GET', '/api/state')).json;
    const pending = adult.call('POST', '/api/plans', {});
    await entered.promise;
    const seenAtStart = s.db.prepare('SELECT last_seen_at FROM sessions WHERE member_id = ? AND revoked_at IS NULL').get(before.access.me.memberId).last_seen_at;
    if (reason === 'idle expiry') s.clock.advance(31 * 60_000);
    else if (reason === 'sign-out') assert.equal((await adult.call('POST', '/api/auth/signout', {})).status, 200);
    else if (reason === 'renewed sign-in') assert.equal((await adult.signIn()).done.status, 200);
    else if (reason === 'active') s.clock.advance(2 * 60_000);
    else await removeAdult(owner, before.access.me.memberId);
    finish.release();
    const result = await pending;
    if (reason === 'active') {
      assert.equal(result.status, 200, JSON.stringify(result.json));
      assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM plans').get().n, 1);
      assert.equal(s.db.prepare('SELECT last_seen_at FROM sessions WHERE member_id = ? AND revoked_at IS NULL').get(before.access.me.memberId).last_seen_at, seenAtStart, 'runtime rechecks are not new activity');
      return;
    }
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM plans').get().n, 0, 'no late AI proposal is saved');
    privateResponseEnded(result);
    if (reason === 'renewed sign-in') assert.equal((await adult.call('GET', '/api/state')).status, 200, 'an old response must not clear the newer session cookie');
  } finally { finish.release(); await s.close(); }
});

for (const operation of ['capture', 'refund']) test(`a dispatched ${operation} is recorded once after access ends, without returning private state`, { timeout: 10_000 }, async () => {
  const entered = gate(), finish = gate(), fake = createFakePayPal();
  const paypal = createPayPalClient({ clientId: 'fake-family-client', clientSecret: 'fake-family-secret', fetch: async (url, init) => {
    if (new URL(url).pathname.endsWith(`/${operation}`)) { entered.release(); await finish.promise; }
    return fake.fetch(url, init);
  } });
  const s = await startServer({ paypal, env: { PAYPAL_CLIENT_ID: 'fake-family-client', PAYPAL_CLIENT_SECRET: 'fake-family-secret' } });
  try {
    const { owner, Ash: adult } = await familyWith(s, [['Ash', 'adult']]);
    const before = (await adult.call('GET', '/api/state')).json;
    const created = await adult.call('POST', '/api/paypal/orders', { amountCents: 1500, approvalConfirmed: true, requestId: 'runtime-boundary-fake-order-1' });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const captureUrl = `/api/paypal/orders/${created.json.orderId}/capture`;
    let pending;
    if (operation === 'refund') {
      const captured = await adult.call('POST', captureUrl, {});
      assert.equal(captured.status, 200, JSON.stringify(captured.json));
      pending = adult.call('POST', `/api/paypal/captures/${captured.json.contribution.captures[0].captureId}/refund`, { approvalConfirmed: true });
    } else pending = adult.call('POST', captureUrl, {});
    await entered.promise;
    await removeAdult(owner, before.access.me.memberId);
    finish.release();
    const result = await pending;
    const current = (await owner.call('GET', '/api/state')).json;
    assert.equal(current.progress.confirmedNetCents, operation === 'capture' ? 1500 : 0, 'already-dispatched settlement is kept');
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE source_ref LIKE 'paypal-capture:%'").get().n, 1);
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE source_ref LIKE 'paypal-refund:%'").get().n, operation === 'refund' ? 1 : 0);
    assert.equal(fake.requests.filter(r => r.pathname.endsWith('/capture')).length, 1);
    assert.equal(fake.requests.filter(r => r.pathname.endsWith('/refund')).length, operation === 'refund' ? 1 : 0);
    privateResponseEnded(result);
    const recovered = await owner.call('POST', captureUrl, {});
    assert.equal(recovered.status, 200, JSON.stringify(recovered.json));
    assert.equal(fake.requests.filter(r => r.pathname.endsWith('/capture')).length, 1, 'owner can recover the stored result without another capture');
  } finally { finish.release(); await s.close(); }
});
