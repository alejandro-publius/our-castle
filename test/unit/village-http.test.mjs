import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, browser, familyWith } from '../helpers/family-http.mjs';
import { startDemo } from '../../scripts/demo.mjs';
import { createClock } from '../../server/household.mjs';
import { loadConfig, ConfigError } from '../../server/config.mjs';

const ok = r => { assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
const action = (b, input) => b.call('POST', '/api/village', input);
const village = async b => ok(await b.call('GET', '/api/village')).village;
async function setup(s) {
  const { owner, Wren } = await familyWith(s, [['Wren', 'child']]);
  const neighbor = browser(s.origin), outsider = browser(s.origin);
  await neighbor.createFamily('Willow'); await outsider.createFamily('Stranger');
  ok(await owner.call('POST', '/api/exchange', { action: 'create', name: 'School families', alias: 'Alder' }));
  const invitation = ok(await owner.call('POST', '/api/exchange', { action: 'invite' })).invitation;
  ok(await neighbor.call('POST', '/api/exchange', { action: 'join', token: invitation.token, alias: 'Willow', confirmed: true }));
  const created = ok(await action(owner, { action: 'create', title: 'Class trip', targetMinor: 10000, deadline: '2026-12-12', rail: 'simulated', confirmed: true }));
  return { owner, Wren, neighbor, outsider, fundId: created.fundId };
}
test('HTTP shared contributions are approved once, notify the same fund and never credit private savings', async () => {
  const s = await startServer(); try {
    const { owner, Wren, neighbor, outsider, fundId } = await setup(s);
    const privateRows = s.db.prepare('SELECT * FROM ledger_entries').all();
    assert.equal((await outsider.call('GET', `/api/village/funds/${fundId}`)).status, 403);
    const fund = (await village(owner)).funds[0];
    const approved = { fundId, amountMinor: 4000, expectedRevision: fund.revision, approvalConfirmed: true, requestId: 'village_http_payment_0001' };
    assert.equal((await Wren.call('POST', '/api/village/payments', approved)).status, 403);
    assert.equal((await owner.call('POST', '/api/village/payments', approved, { csrf: false })).status, 403);
    assert.equal((await owner.call('POST', '/api/village/payments', { ...approved, approvalConfirmed: false })).status, 400);
    ok(await owner.call('POST', '/api/village/payments', approved));
    ok(await owner.call('POST', '/api/village/payments', approved));
    let fresh = (await village(neighbor)).funds[0];
    assert.equal(fresh.progress.netMinor, 4000); assert.equal(fresh.receipts.length, 1);
    ok(await neighbor.call('POST', '/api/village/payments', { ...approved, amountMinor: 6000, expectedRevision: fresh.revision, requestId: 'village_http_payment_0002' }));
    fresh = (await village(owner)).funds[0];
    assert.equal(fresh.progress.netMinor, 10000); assert.equal(fresh.progress.stage, 3);
    assert.equal(fresh.shares.find(x => x.alias === 'Willow').paidMinor, 6000);
    const answer = ok(await owner.call('POST', '/api/village/treasurer', { fundId, question: 'Who has contributed?' }));
    assert.equal(answer.facts.netMinor, 10000); assert.equal(answer.source.mode, 'records');
    assert.equal(answer.facts.households.reduce((sum, h) => sum + h.paidMinor, 0), 10000);
    assert.equal((await outsider.call('POST', '/api/village/treasurer', { fundId, question: 'Who has contributed?' })).status, 403);
    assert.deepEqual(s.db.prepare('SELECT * FROM ledger_entries').all(), privateRows);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM payment_orders').get().n, 0);
    assert.equal((await owner.call('POST', '/api/exchange', { action: 'leave' })).status, 409);
  } finally { s.app.close(); await s.close(); }
});

test('published view, presence and MCP retain session/membership boundaries over real HTTP', async () => {
  const s = await startServer(); try {
    const { owner, Wren, neighbor, outsider, fundId } = await setup(s);
    const anonymous = browser(s.origin);
    assert.equal((await anonymous.call('GET', `/api/village/public/${fundId}`)).status, 404);
    let f = (await village(owner)).funds[0];
    ok(await action(owner, { action: 'publish', fundId, published: true, expectedRevision: f.revision, confirmed: true }));
    const publicFund = ok(await anonymous.call('GET', `/api/village/public/${fundId}`)).fund;
    assert.ok(!('shares' in publicFund) && !('receipts' in publicFund) && !('recipient' in publicFund));
    assert.equal((await Wren.call('POST', '/api/mcp/grants', { fundId })).status, 403);
    assert.equal((await outsider.call('POST', '/api/mcp/grants', { fundId })).status, 404);
    const grant = ok(await owner.call('POST', '/api/mcp/grants', { fundId }));
    const read = () => anonymous.call('GET', '/api/mcp/fund?view=status', undefined, { headers: { Authorization: `Bearer ${grant.token}` } });
    assert.equal(ok(await read()).fund.id, fundId);
    assert.equal((await anonymous.call('GET', '/api/mcp/fund?view=status')).status, 401);
    ok(await owner.call('POST', '/api/village/presence', { action: 'join', fundId, confirmed: true }));
    ok(await neighbor.call('POST', '/api/village/presence', { action: 'join', fundId, confirmed: true }));
    let people = ok(await neighbor.call('GET', `/api/village/presence?fundId=${fundId}`));
    assert.equal(people.members.length, 2);
    assert.doesNotMatch(JSON.stringify(people), /sessionId|householdId|memberId|token/);
    assert.equal((await outsider.call('GET', `/api/village/presence?fundId=${fundId}`)).status, 403);
    ok(await owner.call('POST', '/api/auth/signout', {}));
    assert.equal((await read()).status, 401);
    people = ok(await neighbor.call('GET', `/api/village/presence?fundId=${fundId}`));
    assert.equal(people.members.length, 1); assert.equal(people.members[0].alias, 'Willow');
  } finally { s.app.close(); await s.close(); }
});

test('sentence proposals are retained on the server and become a fund only after the same adult reviews', async () => {
  const s = await startServer(); try {
    const { owner, neighbor } = await setup(s), originalCount = (await village(owner)).funds.length;
    const proposal = ok(await owner.call('POST', '/api/village/draft', { text: 'We need $400 for the class trip by December 12, 2026' }));
    assert.equal(proposal.status, 'ready'); assert.equal(proposal.source.mode, 'rules');
    assert.equal((await village(owner)).funds.length, originalCount);
    assert.equal(proposal.draft.shares.reduce((s, x) => s + x.committedMinor, 0), 40000);
    assert.equal((await neighbor.call('POST', '/api/village/draft/accept', { revision: proposal.draft.revision, confirmed: true })).status, 409);
    assert.equal((await owner.call('POST', '/api/village/draft/accept', { revision: proposal.draft.revision })).status, 400);
    const accepted = ok(await owner.call('POST', '/api/village/draft/accept', { revision: proposal.draft.revision, confirmed: true, targetMinor: 1, rail: 'paypal-sandbox' }));
    const fund = accepted.village.funds.find(x => x.id === accepted.fundId);
    assert.equal(fund.targetMinor, 40000); assert.equal(fund.rail, 'simulated');
    assert.ok(fund.shares.every(x => x.committedMinor === 0));
    assert.equal(fund.progress.netMinor, 0); assert.equal(accepted.paymentScheduled, false);
  } finally { s.app.close(); await s.close(); }
});

test('fresh five-family demo and QR remain local, labeled and resettable without changing private progress', async () => {
  const demo = await startDemo({ villageFund: true, clock: createClock('2026-11-10T12:00:00Z') });
  const read = async () => (await fetch(demo.url + '/api/state')).json();
  try {
    const before = await read(), fund = before.village.funds[0];
    assert.equal(before.example.id, 'village-fund'); assert.equal(before.village.members.length, 5);
    assert.equal(fund.rail, 'simulated'); assert.equal(fund.progress.netMinor, 20000); assert.equal(fund.targetMinor, 40000);
    const send = body => fetch(demo.url + '/api/village/payments', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: demo.url }, body: JSON.stringify(body) });
    const response = await send({ fundId: fund.id, memberId: 'm_rowan', amountMinor: 4000, expectedRevision: fund.revision, approvalConfirmed: true, requestId: 'village_demo_payment_0001' });
    assert.equal(response.status, 200, await response.text());
    const after = await read();
    assert.equal(after.village.funds[0].progress.netMinor, 24000); assert.equal(after.village.funds[0].progress.stage, 2);
    assert.deepEqual(after.progress, before.progress);
    const qr = await fetch(`${demo.url}/api/village/qr?fundId=${fund.id}`);
    assert.equal(qr.status, 200); assert.match(qr.headers.get('content-type'), /image\/svg\+xml/); assert.match(await qr.text(), /<svg/);
    const reset = await fetch(demo.url + '/api/demo/reset', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: demo.url }, body: '{}' });
    assert.equal(reset.status, 200, await reset.text());
    assert.equal((await read()).village.funds[0].progress.netMinor, 20000);
  } finally { await demo.close(); }
});

test('published outside support remains private, and recovery uses only the same adult’s stored approval', async () => {
  const s = await startServer(); try {
    const { owner, outsider, neighbor, fundId } = await setup(s);
    const f = (await village(owner)).funds[0];
    ok(await action(owner, { action: 'publish', fundId, published: true, expectedRevision: f.revision, confirmed: true }));
    const review = ok(await outsider.call('GET', `/api/village/review/${fundId}`)).fund;
    assert.equal(review.viewerMember, false); assert.deepEqual(review.receipts, []); assert.deepEqual(review.shares, []);
    const payment = ok(await outsider.call('POST', '/api/village/payments', { fundId, amountMinor: 2000,
      approvalConfirmed: true, expectedRevision: review.revision, requestId: 'outside_http_payment_001' })).payment.contribution;
    const list = ok(await outsider.call('GET', `/api/village/payments?fundId=${fundId}`)).payments;
    assert.equal(list.length, 1); assert.equal(list[0].id, payment.id);
    assert.equal(ok(await neighbor.call('GET', `/api/village/payments?fundId=${fundId}`)).payments.length, 0);
    assert.equal((await neighbor.call('POST', '/api/village/payments/resume', { orderId: payment.id })).status, 404);
    ok(await outsider.call('POST', '/api/village/payments/resume', { orderId: payment.id, amountMinor: 999999, fundId: 'forged' }));
    const fresh = (await village(owner)).funds[0];
    assert.equal(fresh.progress.netMinor, 2000); assert.equal(fresh.receipts.length, 1);
    assert.equal(fresh.receipts[0].familyReference, null); assert.equal(fresh.progress.unmatchedMinor, 2000);
    ok(await action(owner, { action: 'publish', fundId, published: false, expectedRevision: fresh.revision, confirmed: true }));
    assert.equal((await outsider.call('GET', `/api/village/review/${fundId}`)).status, 404);
    assert.equal(ok(await outsider.call('GET', `/api/village/payments?fundId=${fundId}`)).payments[0].id, payment.id);
    assert.equal((await outsider.call('POST', '/api/village/payments', { fundId, amountMinor: 1000,
      approvalConfirmed: true, expectedRevision: fresh.revision, requestId: 'outside_http_payment_002' })).status, 404);
  } finally { s.app.close(); await s.close(); }
});

test('recurring agreements stay disconnected without explicit platform setup and never imply a fund payment', async () => {
  const s = await startServer(); try {
    const { owner, Wren, fundId } = await setup(s);
    const before = s.db.prepare('SELECT * FROM ledger_entries').all();
    const response = ok(await owner.call('POST', '/api/village/subscriptions/propose', { fundId, requestId: 'subscription_http_01', amountMinor: 1000, cycles: 4, startDate: '2026-11-17' }));
    assert.equal(response.subscription.status, 'setup_needed'); assert.equal(response.subscription.paymentScheduled, false);
    assert.equal(response.subscription.chargesImported, false);
    assert.equal((await Wren.call('POST', '/api/village/subscriptions/propose', { fundId })).status, 403);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM village_subscriptions').get().n, 0);
    assert.deepEqual(s.db.prepare('SELECT * FROM ledger_entries').all(), before);
  } finally { s.app.close(); await s.close(); }
});

test('sandbox recurring setup requires a separately declared platform, seller and product; devnet has no mainnet fallback', () => {
  assert.equal(loadConfig({}).villageSubscriptions.mode, 'off');
  assert.throws(() => loadConfig({ OUR_CASTLE_VAULT: 'mainnet' }), ConfigError);
  const complete = { OUR_CASTLE_ACCESS: 'family', OUR_CASTLE_ORIGIN: 'http://localhost:3000',
    PAYPAL_CLIENT_ID: 'nonworking-fixture', PAYPAL_CLIENT_SECRET: 'nonworking-fixture', OUR_CASTLE_SUBSCRIPTIONS: 'sandbox-platform',
    PAYPAL_SUBSCRIPTIONS_SELLER_ONBOARDED: 'true', PAYPAL_SUBSCRIPTIONS_MERCHANT_ID: 'TESTSELLER123',
    PAYPAL_PARTNER_ATTRIBUTION_ID: 'TEST_BN', PAYPAL_SUBSCRIPTIONS_PRODUCT_ID: 'PROD-TEST' };
  assert.equal(loadConfig(complete).villageSubscriptions.capabilities.environment, 'sandbox');
  for (const key of ['PAYPAL_SUBSCRIPTIONS_SELLER_ONBOARDED', 'PAYPAL_SUBSCRIPTIONS_MERCHANT_ID', 'PAYPAL_PARTNER_ATTRIBUTION_ID', 'PAYPAL_SUBSCRIPTIONS_PRODUCT_ID']) {
    assert.throws(() => loadConfig({ ...complete, [key]: '' }), ConfigError);
  }
});

test('configured recurring HTTP review binds its adult and reports checked agreement status without contribution credit', async () => {
  let s, creates = 0;
  const merchantId = 'TESTSELLER123';
  const adapter = { environment: 'sandbox',
    async createApproval({ prepared, assertAccess, onApproval }) {
      assertAccess(); creates++;
      const result = { status: 'approval_pending', planId: 'P-ROOTHTTP', subscriptionId: 'I-ROOTHTTP',
        revision: prepared.revision, recipientMerchantId: merchantId,
        approvalUrl: 'https://www.sandbox.paypal.com/approve?fixture=yes', paymentScheduled: false };
      onApproval?.(result); return result;
    },
    async readAgreement({ prepared, planId, subscriptionId, assertAccess }) {
      assertAccess(); return { revision: prepared.revision, recipientMerchantId: merchantId, planId, subscriptionId,
        status: 'active', statusUpdatedAt: s.clock.iso(), buyerAgreementVerified: true, chargesImported: false };
    },
  };
  s = await startServer({ env: { PAYPAL_CLIENT_ID: 'nonworking-fixture', PAYPAL_CLIENT_SECRET: 'nonworking-fixture',
    OUR_CASTLE_SUBSCRIPTIONS: 'sandbox-platform', PAYPAL_SUBSCRIPTIONS_SELLER_ONBOARDED: 'true',
    PAYPAL_SUBSCRIPTIONS_MERCHANT_ID: merchantId, PAYPAL_PARTNER_ATTRIBUTION_ID: 'TEST_BN', PAYPAL_SUBSCRIPTIONS_PRODUCT_ID: 'PROD-TEST' },
    extra: { subscriptionAdapter: adapter } });
  try {
    const { owner, neighbor } = await setup(s);
    const { fundId } = ok(await action(owner, { action: 'create', title: 'Sandbox class trip', rail: 'paypal-sandbox',
      targetMinor: 40000, deadline: '2026-12-12', recipient: { kind: 'paypal', merchantId }, confirmed: true }));
    const p = ok(await owner.call('POST', '/api/village/subscriptions/propose', { fundId,
      requestId: 'root_http_propose_01', amountMinor: 1000, cycles: 4, startDate: '2026-11-17' })).subscription;
    const approve = { proposalId: p.id, reviewedRevision: p.revision, approvalConfirmed: true, requestId: 'root_http_approve_01' };
    assert.equal((await neighbor.call('POST', '/api/village/subscriptions/approve', approve)).status, 404);
    assert.equal((await owner.call('POST', '/api/village/subscriptions/approve', { ...approve, reviewedRevision: 'changed' })).status, 400);
    assert.equal(ok(await owner.call('POST', '/api/village/subscriptions/approve', approve)).subscription.status, 'approval_pending');
    ok(await owner.call('POST', '/api/village/subscriptions/approve', approve));
    assert.equal(creates, 1);
    const checked = ok(await owner.call('POST', '/api/village/subscriptions/check', { proposalId: p.id })).subscription;
    assert.equal(checked.buyerAgreementVerified, true); assert.equal(checked.chargesImported, false);
    assert.equal((await village(owner)).funds.find(f => f.id === fundId).progress.netMinor, 0);
    assert.equal(ok(await owner.call('GET', `/api/village/subscriptions/${p.id}`)).subscription.id, p.id);
    const revoked = ok(await owner.call('POST', '/api/village/subscriptions/revoke', approve)).subscription;
    assert.equal(revoked.cancellationRequired, true); assert.equal(revoked.paymentScheduled, true);
    assert.equal(revoked.approvalUrl, null);
  } finally { s.app.close(); await s.close(); }
});
