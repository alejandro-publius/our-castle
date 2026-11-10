import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpCapabilities, projectMcpFund } from '../../server/mcp/capabilities.mjs';

const adult = Object.freeze({ mode: 'family', sessionId: 'session_a', householdId: 'family_a', memberId: 'adult_a', role: 'adult' });
const fund = () => ({
  id: 'fund_a', title: 'Class trip', rail: 'paypal-sandbox', currency: 'USD', decimals: 2, targetMinor: 40000,
  deadline: '2026-12-12', revision: 2, status: 'open',
  progress: { netMinor: 6000, capturedMinor: 8000, refundedMinor: 2000, remainingMinor: 34000, basisPoints: 1500, stage: 1 },
  recipient: { merchantId: 'private-merchant', address: 'private-wallet' },
  shares: [{ familyReference: 'HOUSE-A', alias: 'Alder', committedMinor: 10000, paidMinor: 6000, householdId: 'private-id' }],
  receipts: [{ reference: 'VRC-1', kind: 'capture', amountMinor: 8000, alias: 'Alder', familyReference: 'HOUSE-A',
    at: '2026-11-10T20:00:00Z', eventRef: 'private-provider-id', senderAddress: 'private-sender', source: { approvalToken: 'private-token' } }],
});
function harness(limits = {}) {
  let at = Date.parse('2026-11-10T20:00:00Z'), scope = { ...adult }, member = true, value = fund();
  const calls = [];
  const api = createMcpCapabilities({ now: () => at, resolveSessionScope: (id) => id === scope?.sessionId ? scope : null,
    readFund: (s, id) => { calls.push({ scope: s, id }); if (!member || id !== value.id) throw Error('Private membership detail'); return value; }, ...limits });
  return { api, calls, advance: (ms) => { at += ms; }, session: (s) => { scope = s; }, membership: (b) => { member = b; }, value: (v) => { value = v; } };
}

test('an adult grants only one scoped fund; projections retain units and omit private records', async () => {
  const h = harness(), g = await h.api.issue(adult, { fundId: 'fund_a' });
  assert.match(g.token, /^[\w-]{43}$/); assert.equal(g.expiresAt, '2026-11-10T20:15:00.000Z');
  const status = await h.api.read(g.token, 'status');
  assert.equal(status.fund.progress.netMinor, 6000); assert.equal(status.fund.currency, 'USD');
  assert.match(status.fund.label, /sandbox/);
  const contributions = await h.api.read(g.token, 'contributions');
  assert.equal(contributions.shares[0].paidMinor, 6000); assert.equal(contributions.receipts[0].reference, 'VRC-1');
  assert.doesNotMatch(JSON.stringify([status, contributions]), /private-|householdId|approvalToken|recipient|eventRef|senderAddress/);
  const link = await h.api.read(g.token, 'review-link');
  assert.equal(link.path, '/?villageFund=fund_a'); assert.equal(link.createsPayment, false);
  assert.ok(h.calls.every(({ scope, id }) => scope.householdId === adult.householdId && id === 'fund_a'));
  assert.deepEqual(h.api.stats(), { grants: 1, closed: false });
});

test('grant creation rejects child, example, forged scope and inaccessible fund', async () => {
  const h = harness();
  for (const scope of [{ ...adult, role: 'child' }, { ...adult, mode: 'example' }, { ...adult, memberId: 'adult_b' }, { ...adult, householdId: 'family_b' }, { ...adult, sessionId: 'other' }]) {
    await assert.rejects(h.api.issue(scope, { fundId: 'fund_a' }), { code: 'mcp_grant_unavailable' });
  }
  await assert.rejects(h.api.issue(adult, { fundId: 'fund_b' }), { code: 'mcp_fund_unavailable' });
  assert.equal(h.api.stats().grants, 0);
});

test('every read rechecks membership, session expiry, current adult role and household', async () => {
  for (const change of [h => h.session(null), h => h.session({ ...adult, role: 'child' }), h => h.session({ ...adult, householdId: 'family_b' })]) {
    const h = harness(), g = await h.api.issue(adult, { fundId: 'fund_a' }); change(h);
    await assert.rejects(h.api.read(g.token, 'status'), { code: 'mcp_grant_unavailable' });
    assert.equal(h.api.stats().grants, 0);
  }
  const h = harness(), g = await h.api.issue(adult, { fundId: 'fund_a' }); h.membership(false);
  await assert.rejects(h.api.read(g.token, 'contributions'), { code: 'mcp_fund_unavailable' });
});

test('grants expire, are bounded, and only their issuing adult session can revoke them', async () => {
  const h = harness({ maxGrants: 2, perSession: 2, ttlMs: 1000 });
  const a = await h.api.issue(adult, { fundId: 'fund_a' }), b = await h.api.issue(adult, { fundId: 'fund_a' });
  await assert.rejects(h.api.issue(adult, { fundId: 'fund_a' }), { code: 'mcp_grants_full' });
  await assert.rejects(h.api.revoke({ ...adult, memberId: 'adult_b' }, { grantId: a.grantId }), { code: 'mcp_grant_unavailable' });
  await h.api.revoke(adult, { grantId: a.grantId });
  await assert.rejects(h.api.read(a.token, 'status'), { code: 'mcp_grant_unavailable' });
  h.advance(1000);
  await assert.rejects(h.api.read(b.token, 'status'), { code: 'mcp_grant_unavailable' });
  assert.equal(h.api.stats().grants, 0);
  const c = await h.api.issue(adult, { fundId: 'fund_a' }); h.api.close();
  await assert.rejects(h.api.read(c.token, 'status'), { code: 'mcp_grant_unavailable' });
  assert.deepEqual(h.api.stats(), { grants: 0, closed: true });
});

test('a revoked or expired grant cannot return from an already pending read', async () => {
  let finish, reading = false, now = 0;
  const api = createMcpCapabilities({ resolveSessionScope: () => adult, now: () => now, ttlMs: 50,
    readFund: () => reading ? new Promise(resolve => { finish = resolve; }) : fund() });
  const grant = await api.issue(adult, { fundId: 'fund_a' });
  reading = true;
  const pending = api.read(grant.token, 'status');
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await api.revoke(adult, { grantId: grant.grantId }); finish(fund());
  await assert.rejects(pending, { code: 'mcp_grant_unavailable' });
  reading = false;
  const next = await api.issue(adult, { fundId: 'fund_a' }); reading = true; finish = null;
  const expired = api.read(next.token, 'status');
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  now = 50; finish(fund());
  await assert.rejects(expired, { code: 'mcp_grant_unavailable' });
});

test('membership revoked during an asynchronous fund read cannot release the earlier authorized snapshot', async () => {
  let member = true, pending = false, finish;
  const api = createMcpCapabilities({ resolveSessionScope: () => adult,
    readFund: () => {
      if (!member) throw Error('Membership revoked');
      const snapshot = fund();
      if (!pending) return snapshot;
      pending = false;
      return new Promise(resolve => { finish = () => resolve(snapshot); });
    } });
  const grant = await api.issue(adult, { fundId: 'fund_a' });
  pending = true;
  const result = api.read(grant.token, 'contributions');
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  member = false; finish();
  await assert.rejects(result, { code: 'mcp_fund_unavailable' });
});

test('an asynchronous initial read returns the fresh authorized view and cannot issue a grant after membership loss', async () => {
  let member = true, value = fund(), finish, pending = false;
  const authoritative = () => { if (!member) throw Error('Membership revoked'); return value; };
  const api = createMcpCapabilities({ resolveSessionScope: () => adult, readFundNow: authoritative,
    readFund: () => {
      const snapshot = structuredClone(authoritative());
      return pending ? new Promise(resolve => { finish = () => resolve(snapshot); }) : snapshot;
    } });
  const grant = await api.issue(adult, { fundId: 'fund_a' }); pending = true;
  const reading = api.read(grant.token, 'status');
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  value.progress.netMinor = 7000; finish();
  assert.equal((await reading).fund.progress.netMinor, 7000);
  finish = null;
  const issuing = api.issue(adult, { fundId: 'fund_a' });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  member = false; finish();
  await assert.rejects(issuing, { code: 'mcp_fund_unavailable' });
  assert.equal(api.stats().grants, 1);
});

test('a final authorization reader that yields asynchronously is refused rather than trusted after a gap', async () => {
  const api = createMcpCapabilities({ resolveSessionScope: () => adult, readFund: async () => fund() });
  await assert.rejects(api.issue(adult, { fundId: 'fund_a' }), { code: 'mcp_fund_unavailable' });
  assert.equal(api.stats().grants, 0);
});

test('invalid tokens, mismatched fund responses and mixed financial units fail closed', async () => {
  const h = harness(), g = await h.api.issue(adult, { fundId: 'fund_a' });
  for (const token of [null, '', 'x'.repeat(43), g.token + '\r\nAuthorization: secret']) {
    await assert.rejects(h.api.read(token, 'status'), { code: 'mcp_grant_unavailable' });
  }
  await assert.rejects(h.api.read(g.token, 'capture'), { code: 'mcp_view_invalid' });
  h.value({ ...fund(), id: 'fund_b' });
  await assert.rejects(h.api.read(g.token, 'status'), { code: 'mcp_fund_unavailable' });
  h.value({ ...fund(), rail: 'pyusd-devnet' });
  await assert.rejects(h.api.read(g.token, 'status'), { code: 'mcp_fund_unavailable' });
  const devnet = projectMcpFund({ ...fund(), rail: 'pyusd-devnet', currency: 'PYUSD', decimals: 6 }, 'status');
  assert.equal(devnet.fund.decimals, 6); assert.match(devnet.fund.label, /no monetary value/);
});

test('large receipt lists explicitly report truncation and do not invent total contribution amounts', () => {
  const f = fund(); f.receipts = Array.from({ length: 103 }, (_, i) => ({ ...f.receipts[0], reference: `VRC-${i}` }));
  const result = projectMcpFund(f, 'contributions');
  assert.equal(result.receipts.length, 100); assert.equal(result.totalReceipts, 103); assert.equal(result.truncated, true);
  assert.equal(result.fund.netMinor, undefined);
});
