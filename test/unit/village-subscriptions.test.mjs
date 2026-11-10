import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../server/db.mjs';
import { createVillageSubscriptions, ensureVillageSubscriptionsSchema } from '../../server/planner/village-subscriptions.mjs';
import { DEMO_HOUSEHOLD_ID, ensureDemoHousehold } from '../../server/household.mjs';

const capabilities = { environment: 'sandbox', platformSubscriptions: true, sellerOnboarded: true, merchantId: 'TESTSELLER123', bnCode: 'TEST_BN' };
const scope = { householdId: DEMO_HOUSEHOLD_ID, memberId: 'm_rowan' };
const input = { requestId: 'proposal-0001', amountMinor: 2000, cycles: 4, startDate: '2026-11-17' };

function fixture({ file = ':memory:', provider = null } = {}) {
  let time = new Date('2026-11-10T12:00:00Z').getTime(), authorized = true;
  const clock = { now: () => new Date(time), iso: () => new Date(time).toISOString(), today: () => new Date(time).toISOString().slice(0, 10) };
  const db = openDatabase(file);
  ensureDemoHousehold(db, clock);
  ensureVillageSubscriptionsSchema(db);
  const fund = { id: 'fund_a', revision: 2, status: 'open', rail: 'paypal-sandbox', currency: 'USD', decimals: 2,
    deadline: '2026-12-12', recipient: { merchantId: capabilities.merchantId } };
  const remote = new Map(), stats = { creates: 0, reads: 0 };
  const adapter = provider ?? { environment: 'sandbox',
    async createApproval({ prepared, assertAccess, assertResponseAccess, onApproval }) {
      assertAccess(); stats.creates++;
      if (!remote.has(prepared.revision)) remote.set(prepared.revision, { status: 'approval_pending', planId: `P-TESTPLAN${remote.size + 1}`, subscriptionId: `I-TESTSUB${remote.size + 1}`,
        revision: prepared.revision, recipientMerchantId: capabilities.merchantId, approvalUrl: 'https://www.sandbox.paypal.com/approve?fake=yes', paymentScheduled: false });
      const result = remote.get(prepared.revision);
      onApproval?.(result); assertResponseAccess?.();
      return result;
    },
    async readAgreement({ prepared, planId, subscriptionId, assertAccess }) {
      assertAccess(); stats.reads++;
      return { revision: prepared.revision, recipientMerchantId: capabilities.merchantId, planId, subscriptionId,
        status: 'active', statusUpdatedAt: clock.iso(), buyerAgreementVerified: true, chargesImported: false };
    },
  };
  const assertAccess = () => { if (!authorized) throw Object.assign(new Error('membership revoked'), { code: 'access_revoked' }); };
  const make = overrides => createVillageSubscriptions({ db, clock, capabilities, adapter, readAuthorizedFund: (s, id) => {
    assertAccess(); if (s.householdId !== scope.householdId || id !== fund.id) throw Object.assign(new Error('not found'), { status: 404 });
    return { ...fund };
  }, ...overrides });
  const service = make();
  const propose = (extra = {}) => service.propose({ scope, fundId: fund.id, input, assertAccess, ...extra });
  const approve = (proposal, extra = {}) => service.approve({ scope, proposalId: proposal.id, reviewedRevision: proposal.revision,
    approvalConfirmed: true, requestId: 'approval-0001', assertAccess, ...extra });
  return { db, clock, fund, remote, stats, adapter, make, service, propose, approve, assertAccess, tick: ms => { time += ms; }, revokeAccess: () => { authorized = false; } };
}

test('default-off capability produces no proposal row or provider call', async () => {
  const e = fixture();
  for (const service of [e.make({ adapter: null }), e.make({ capabilities: null }), e.make({ capabilities: { ...capabilities, sellerOnboarded: false } })]) {
    assert.equal(service.propose({ scope, fundId: 'fund_a', input }).status, 'setup_needed');
    assert.equal((await service.approve({ scope })).status, 'setup_needed');
  }
  assert.equal(e.db.prepare('SELECT count(*) AS n FROM village_subscriptions').get().n, 0);
  assert.equal(e.stats.creates, 0);
  e.db.close();
});

test('durable reviewed proposal, provider approval, real agreement check and truthful local revocation', async () => {
  const e = fixture(), p = e.propose();
  assert.equal(p.status, 'proposal');
  assert.equal(p.paymentScheduled, false);
  assert.equal(e.propose().id, p.id);
  assert.equal(e.propose({ input: { ...input, requestId: 'another-request-id' } }).id, p.id);
  assert.throws(() => e.propose({ input: { ...input, amountMinor: 3000 } }), { code: 'subscription_request_reused' });
  const pending = await e.approve(p);
  assert.equal(pending.status, 'approval_pending');
  assert.equal(pending.paymentScheduled, false);
  assert.equal(pending.buyerAgreementVerified, false);
  const active = await e.service.check({ scope, proposalId: p.id, assertAccess: e.assertAccess });
  assert.equal(active.status, 'active');
  assert.equal(active.recurringAgreementStatus, 'active');
  assert.equal(active.buyerAgreementVerified, true);
  assert.equal(active.chargesImported, false);
  assert.match(active.accountingNote, /not imported/);
  const revoked = e.service.revoke({ scope, proposalId: p.id, reviewedRevision: p.revision, approvalConfirmed: true });
  assert.equal(revoked.status, 'cancellation_required');
  assert.equal(revoked.approvalUrl, null);
  assert.equal(revoked.paymentScheduled, true, 'local revocation does not pretend PayPal stopped an active agreement');
  assert.match(revoked.message, /does not cancel/);
  assert.equal(e.stats.creates, 1);
  assert.equal(e.stats.reads, 1);
  e.db.close();
});

test('revoked proposal, child, other adult and changed fund terms cannot dispatch a provider request', async () => {
  const e = fixture(), p = e.propose();
  await assert.rejects(e.approve(p, { approvalConfirmed: false }), { code: 'subscription_approval' });
  assert.throws(() => e.propose({ scope: { ...scope, memberId: 'm_wren' } }), { code: 'adult_required' });
  await assert.rejects(e.approve(p, { scope: { ...scope, memberId: 'm_wren' } }), { status: 404 });
  e.db.prepare("UPDATE members SET role='adult' WHERE id='m_wren'").run();
  await assert.rejects(e.approve(p, { scope: { ...scope, memberId: 'm_wren' } }), { status: 404 });
  e.fund.revision++;
  await assert.rejects(e.approve(p), { code: 'subscription_changed' });
  e.fund.revision--;
  e.fund.recipient = { merchantId: 'OTHERSELLER12' };
  await assert.rejects(e.approve(p), { code: 'subscription_changed' });
  e.fund.recipient = { merchantId: capabilities.merchantId };
  const local = e.service.revoke({ scope, proposalId: p.id, reviewedRevision: p.revision, approvalConfirmed: true });
  assert.equal(local.status, 'revoked');
  await assert.rejects(e.approve(p), { code: 'subscription_revoked' });
  assert.equal(e.stats.creates, 0);
  assert.throws(() => e.db.prepare('UPDATE village_subscriptions SET intent_json=? WHERE id=?').run('{}', p.id), /immutable/);
  e.db.close();
});

test('a known provider agreement survives database restart and is never recreated after the idempotency window', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'our-castle-subscription-'));
  try {
    const file = path.join(dir, 'synthetic.sqlite'), first = fixture({ file }), p = first.propose();
    const pending = await first.approve(p);
    first.db.close();
    const later = fixture({ file });
    later.tick(80 * 3_600_000);
    const after = await later.approve(p);
    assert.equal(after.subscriptionId, pending.subscriptionId);
    assert.equal(after.planId, pending.planId);
    assert.equal(later.stats.creates, 0);
    later.db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('unknown dispatch retries use the same immutable intent and refuse a blind retry after 71 hours', async () => {
  const e = fixture(), p = e.propose(), seen = [];
  let first = true;
  const original = e.adapter.createApproval;
  e.adapter.createApproval = async args => {
    seen.push(args.prepared.revision);
    if (first) { first = false; throw new Error('lost response after dispatch'); }
    return original(args);
  };
  await assert.rejects(e.approve(p), /lost response/);
  assert.equal(e.service.get({ scope, proposalId: p.id }).status, 'dispatch_unknown');
  const resumed = e.make();
  await resumed.approve({ scope, proposalId: p.id, reviewedRevision: p.revision, approvalConfirmed: true, requestId: 'approval-0001' });
  assert.deepEqual(seen, [p.revision, p.revision]);
  const second = e.propose({ input: { ...input, requestId: 'proposal-0002', amountMinor: 2100 } });
  e.adapter.createApproval = async () => { throw new Error('unknown'); };
  await assert.rejects(e.approve(second, { requestId: 'approval-0002' }), /unknown/);
  e.tick(71 * 3_600_000);
  const result = await e.approve(second, { requestId: 'approval-0002' });
  assert.equal(result.status, 'needs_reconciliation');
  assert.equal(result.lastErrorCode, 'idempotency_window_elapsed');
  e.db.close();
});

test('a concurrent approval or unexpired process claim cannot launch a competing provider create', async () => {
  const e = fixture(), p = e.propose();
  let unblock;
  const original = e.adapter.createApproval;
  e.adapter.createApproval = async args => { await new Promise(resolve => { unblock = resolve; }); return original(args); };
  const running = e.approve(p);
  const concurrent = await e.approve(p);
  assert.equal(concurrent.status, 'in_progress');
  assert.equal(e.stats.creates, 0);
  unblock();
  await running;
  assert.equal(e.stats.creates, 1);
  const next = e.propose({ input: { ...input, requestId: 'proposal-0002', amountMinor: 2100 } });
  e.db.prepare("UPDATE village_subscriptions SET status='dispatching',dispatch_owner='old-process',dispatch_until_ms=?,first_dispatch_ms=?,approval_request_id='approval-0002' WHERE id=?")
    .run(e.clock.now().getTime() + 120000, e.clock.now().getTime(), next.id);
  assert.equal((await e.approve(next, { requestId: 'approval-0002' })).status, 'in_progress');
  e.tick(120001);
  e.adapter.createApproval = original;
  assert.equal((await e.approve(next, { requestId: 'approval-0002' })).status, 'approval_pending');
  e.db.close();
});

test('validated remote identity is retained even if the adult loses response access', async () => {
  const e = fixture(), p = e.propose();
  const original = e.adapter.createApproval;
  e.adapter.createApproval = async args => original({ ...args, onApproval: result => { args.onApproval(result); e.revokeAccess(); } });
  await assert.rejects(e.approve(p), { code: 'access_revoked' });
  const stored = e.db.prepare('SELECT subscription_id,status FROM village_subscriptions WHERE id=?').get(p.id);
  assert.equal(stored.subscription_id, 'I-TESTSUB1');
  assert.equal(stored.status, 'approval_pending');
  e.db.close();
});

test('an adult role removed before provider dispatch cannot continue an already-approved request', async () => {
  const e = fixture(), p = e.propose();
  e.adapter.createApproval = async ({ assertAccess }) => {
    e.db.prepare("UPDATE members SET role='child' WHERE id='m_rowan'").run();
    assertAccess();
    throw new Error('should not reach provider dispatch');
  };
  await assert.rejects(e.approve(p), { code: 'adult_required' });
  assert.equal(e.stats.creates, 0);
  assert.equal(e.remote.size, 0);
  e.db.close();
});

test('a stale provider read cannot overwrite a newer cancelled agreement, and cancellation imports no money', async () => {
  const e = fixture(), p = e.propose();
  const ledgerBefore = e.db.prepare('SELECT * FROM ledger_entries ORDER BY id').all();
  await e.approve(p);
  const original = e.adapter.readAgreement;
  e.adapter.readAgreement = async args => ({ ...await original(args), status: 'cancelled', buyerAgreementVerified: false });
  const cancelled = await e.service.check({ scope, proposalId: p.id });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.paymentScheduled, false);
  e.adapter.readAgreement = async args => ({ ...await original(args), statusUpdatedAt: '2026-11-10T11:59:00Z' });
  assert.equal((await e.service.check({ scope, proposalId: p.id })).status, 'cancelled');
  e.tick(1000);
  e.adapter.readAgreement = original;
  await assert.rejects(e.service.check({ scope, proposalId: p.id }), { code: 'subscription_agreement_conflict' });
  assert.deepEqual(e.db.prepare('SELECT * FROM ledger_entries ORDER BY id').all(), ledgerBefore, 'agreements are never contribution credit');
  e.db.close();
});

test('turning off provider capability still allows local revocation and reading already-retained records', async () => {
  const e = fixture(), p = e.propose();
  await e.approve(p);
  const off = e.make({ adapter: null, capabilities: null });
  assert.equal(off.get({ scope, proposalId: p.id }).connectionStatus, 'setup_needed');
  assert.equal((await off.check({ scope, proposalId: p.id })).connectionStatus, 'setup_needed');
  assert.equal(off.revoke({ scope, proposalId: p.id, reviewedRevision: p.revision, approvalConfirmed: true }).status, 'cancellation_required');
  assert.equal(e.stats.reads, 0);
  e.db.close();
});
