import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillageSubscriptionsSdk } from '../../server/planner/village-subscriptions-sdk.mjs';
import { prepareVillageSubscriptionIntent, approveVillageSubscriptionIntent } from '../../server/planner/village-subscription-intent.mjs';

const capabilities = { environment: 'sandbox', platformSubscriptions: true, sellerOnboarded: true, merchantId: 'TESTSELLER123', bnCode: 'TEST_BN' };
const actor = { memberId: 'adult_a', householdId: 'hh_a', role: 'adult' };
const fund = { id: 'fund_a', revision: 2, rail: 'paypal-sandbox', currency: 'USD', decimals: 2, deadline: '2026-12-12' };
const base = { capabilities, productId: 'PROD-TEST123', appOrigin: 'http://localhost:3200', clientId: 'test-client', clientSecret: 'test-secret' };
const terms = { fund, actor, recipientMerchantId: capabilities.merchantId, amountMinor: 2000, cycles: 4, startDate: '2026-11-17', today: '2026-11-10' };
const prepare = (overrides = {}) => {
  const input = { ...terms, ...overrides }, storedProposal = prepareVillageSubscriptionIntent(input);
  return approveVillageSubscriptionIntent({ ...input, storedProposal, reviewedRevision: storedProposal.revision, approvalConfirmed: true, capabilities });
};

function transport({ transformPlan = plan => plan, transformSubscription = subscription => subscription, transformAgreement = agreement => agreement, after = () => {} } = {}) {
  const calls = [], plans = new Map(), subscriptions = new Map();
  let sequence = 0;
  const adapter = async config => {
    const pathname = new URL(config.url).pathname;
    const headers = Object.fromEntries(Object.entries(config.headers).map(([key, value]) => [key.toLowerCase(), value]));
    const body = typeof config.data === 'string' && config.data.startsWith('{') ? JSON.parse(config.data) : config.data;
    const method = config.method.toUpperCase();
    calls.push({ pathname, body, headers, url: config.url, method });
    let response;
    if (pathname === '/v1/oauth2/token') response = { access_token: 'fake-test-token', token_type: 'Bearer', expires_in: 3600 };
    else if (pathname === '/v1/billing/plans' && method === 'POST') {
      const key = headers['paypal-request-id'];
      if (!plans.has(key)) plans.set(key, { ...body, id: `P-TEST${++sequence}` });
      response = plans.get(key);
    } else if (pathname.startsWith('/v1/billing/plans/')) response = transformPlan([...plans.values()].find(plan => plan.id === pathname.split('/').at(-1)));
    else if (pathname.startsWith('/v1/billing/subscriptions/')) {
      const sub = [...subscriptions.values()].find(subscription => subscription.id === pathname.split('/').at(-1));
      const plan = [...plans.values()].find(p => p.id === sub.plan_id);
      response = transformAgreement({ ...sub, status: 'ACTIVE', status_update_time: '2026-11-10T12:00:00Z',
        subscriber: { payer_id: 'TESTBUYER1234' }, plan: { billing_cycles: plan.billing_cycles, payment_preferences: plan.payment_preferences } });
    } else if (pathname === '/v1/billing/subscriptions') {
      const key = headers['paypal-request-id'];
      if (!subscriptions.has(key)) subscriptions.set(key, { ...body, id: `I-TEST${++sequence}`, status: 'APPROVAL_PENDING',
        links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=FAKE', method: 'GET' }] });
      response = transformSubscription(subscriptions.get(key));
    } else throw new Error(`Unexpected provider operation: ${pathname}`);
    await after({ pathname, body, headers });
    return { data: JSON.stringify(response), status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, config };
  };
  return { adapter, calls, plans, subscriptions };
}

test('real pinned SDK serializes exact finite terms, seller scope and only a genuine sandbox approval URL', async () => {
  const fake = transport(), adapter = createVillageSubscriptionsSdk({ ...base, httpAdapter: fake.adapter });
  const prepared = prepare();
  const result = await adapter.createApproval({ prepared });
  assert.equal(result.status, 'approval_pending');
  assert.equal(result.paymentScheduled, false);
  assert.equal(result.buyerAgreementRequired, true);
  assert.equal(result.recipientMerchantId, capabilities.merchantId);
  assert.match(result.approvalUrl, /^https:\/\/www\.sandbox\.paypal\.com\//);
  assert.equal(result.amountMinor, 2000);
  assert.equal(result.cycles, 4);
  assert.equal(fake.calls.length, 4, 'token, create plan, check plan, create pending subscription');
  assert.ok(fake.calls.every(call => new URL(call.url).hostname === 'api-m.sandbox.paypal.com'));
  const operations = fake.calls.filter(call => call.pathname !== '/v1/oauth2/token');
  for (const call of operations) {
    assert.equal(call.headers['paypal-partner-attribution-id'], 'TEST_BN');
    const jwt = call.headers['paypal-auth-assertion'].split('.');
    assert.equal(jwt.length, 3);
    assert.equal(jwt[2], '');
    assert.deepEqual(JSON.parse(Buffer.from(jwt[1], 'base64url').toString()), { iss: 'test-client', payer_id: capabilities.merchantId });
  }
  const plan = operations[0].body;
  assert.deepEqual(plan.billing_cycles, [{ frequency: { interval_unit: 'WEEK', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 1, total_cycles: 4,
    pricing_scheme: { fixed_price: { currency_code: 'USD', value: '20.00' } } }]);
  assert.deepEqual(plan.payment_preferences, { auto_bill_outstanding: false, payment_failure_threshold: 1 });
  assert.equal(plan.product_id, 'PROD-TEST123');
  const subscription = operations[2].body;
  assert.equal(subscription.custom_id, `village-${prepared.revision}`);
  assert.equal(subscription.start_time, '2026-11-17T12:00:00Z');
  assert.equal(subscription.application_context.user_action, 'CONTINUE');
  assert.equal(subscription.application_context.shipping_preference, 'NO_SHIPPING');
  assert.ok(!fake.calls.some(call => /activate|capture|transactions|cancel/.test(call.pathname)));
});

test('provider plan mismatches cannot lead to a subscription request', async () => {
  const changes = [
    plan => ({ ...plan, product_id: 'PROD-OTHER' }),
    plan => ({ ...plan, quantity_supported: true }),
    plan => ({ ...plan, taxes: { percentage: '5', inclusive: false } }),
    plan => ({ ...plan, billing_cycles: [{ ...plan.billing_cycles[0], total_cycles: 0 }] }),
    plan => ({ ...plan, payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 1 } }),
    plan => ({ ...plan, billing_cycles: [{ ...plan.billing_cycles[0], pricing_scheme: { fixed_price: { currency_code: 'USD', value: '25.00' } } }] }),
  ];
  for (const transformPlan of changes) {
    const fake = transport({ transformPlan }), adapter = createVillageSubscriptionsSdk({ ...base, httpAdapter: fake.adapter });
    await assert.rejects(adapter.createApproval({ prepared: prepare() }), { code: 'subscription_plan_mismatch' });
    assert.equal(fake.subscriptions.size, 0);
  }
});

test('unexpected active states, changed terms and non-sandbox approval URLs are not accepted', async () => {
  const changes = [
    sub => ({ ...sub, status: 'ACTIVE' }),
    sub => ({ ...sub, plan_id: 'P-OTHER' }),
    sub => ({ ...sub, custom_id: 'other' }),
    sub => ({ ...sub, start_time: '2026-11-18T12:00:00Z' }),
    sub => ({ ...sub, plan_overridden: true }),
    sub => ({ ...sub, shipping_amount: { currency_code: 'USD', value: '5.00' } }),
    sub => ({ ...sub, links: [{ rel: 'approve', href: 'https://www.paypal.com/billing/subscriptions' }] }),
    sub => ({ ...sub, links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com@evil.example/' }] }),
  ];
  for (const transformSubscription of changes) {
    const fake = transport({ transformSubscription }), adapter = createVillageSubscriptionsSdk({ ...base, httpAdapter: fake.adapter });
    await assert.rejects(adapter.createApproval({ prepared: prepare() }), { code: 'subscription_approval_mismatch' });
  }
});

test('unconfigured capability or unreviewed/changed terms cause zero SDK transport calls', async () => {
  const fake = transport();
  for (const config of [{ ...base, capabilities: null }, { ...base, capabilities: { ...capabilities, environment: 'live' } },
    { ...base, productId: '' }, { ...base, capabilities: { ...capabilities, sellerOnboarded: false } }])
    assert.throws(() => createVillageSubscriptionsSdk({ ...config, httpAdapter: fake.adapter }), { code: 'subscription_unavailable' });
  const adapter = createVillageSubscriptionsSdk({ ...base, httpAdapter: fake.adapter }), prepared = prepare();
  await assert.rejects(adapter.createApproval({ prepared: { ...prepared, intent: { ...prepared.intent, amountMinor: 1 } } }), { code: 'subscription_not_reviewed' });
  await assert.rejects(adapter.createApproval({ prepared: { ...prepared, status: 'proposal' } }), { code: 'subscription_not_reviewed' });
  assert.equal(fake.calls.length, 0);
});

test('revoked access during OAuth or plan checking blocks the next provider write', async () => {
  for (const stopAt of ['/v1/oauth2/token', '/v1/billing/plans/P-TEST1']) {
    let allowed = true;
    const fake = transport({ after: ({ pathname }) => { if (pathname === stopAt) allowed = false; } });
    const adapter = createVillageSubscriptionsSdk({ ...base, httpAdapter: fake.adapter });
    await assert.rejects(adapter.createApproval({ prepared: prepare(), assertAccess: () => { if (!allowed) throw new Error('adult signed out'); } }), /adult signed out/);
    assert.equal(fake.subscriptions.size, 0);
    if (stopAt.endsWith('/token')) assert.equal(fake.plans.size, 0);
  }
});

test('retrying the same reviewed intent reuses both PayPal idempotency keys', async () => {
  const fake = transport(), adapter = createVillageSubscriptionsSdk({ ...base, httpAdapter: fake.adapter }), prepared = prepare();
  const first = await adapter.createApproval({ prepared });
  const second = await adapter.createApproval({ prepared });
  assert.equal(first.planId, second.planId);
  assert.equal(first.subscriptionId, second.subscriptionId);
  assert.equal(fake.plans.size, 1);
  assert.equal(fake.subscriptions.size, 1);
  const creates = fake.calls.filter(call => call.method === 'POST' && call.pathname !== '/v1/oauth2/token');
  assert.equal(creates[0].headers['paypal-request-id'], creates[2].headers['paypal-request-id']);
  assert.equal(creates[1].headers['paypal-request-id'], creates[3].headers['paypal-request-id']);
});

test('agreement readback verifies the effective terms and buyer state without importing a charge', async () => {
  const fake = transport(), adapter = createVillageSubscriptionsSdk({ ...base, httpAdapter: fake.adapter }), prepared = prepare();
  const pending = await adapter.createApproval({ prepared });
  const result = await adapter.readAgreement({ prepared, planId: pending.planId, subscriptionId: pending.subscriptionId });
  assert.equal(result.status, 'active');
  assert.equal(result.buyerAgreementVerified, true);
  assert.equal(result.chargesImported, false);
  assert.equal(result.statusUpdatedAt, '2026-11-10T12:00:00.000Z');
  assert.equal(fake.calls.at(-2).method, 'GET');
  assert.match(fake.calls.at(-2).url, /fields=plan/);
  assert.equal(fake.calls.at(-1).method, 'GET');
  assert.ok(!('payerId' in result), 'buyer identity is checked but not published in the village DTO');
});

test('agreement readback rejects a missing buyer, effective-plan change or absent provider status time', async () => {
  for (const transformAgreement of [
    a => ({ ...a, subscriber: {} }), a => ({ ...a, status_update_time: undefined }),
    a => ({ ...a, plan: undefined }), a => ({ ...a, plan_overridden: true }),
    a => ({ ...a, plan: { ...a.plan, billing_cycles: [{ ...a.plan.billing_cycles[0], total_cycles: 0 }] } }),
    a => ({ ...a, plan: { ...a.plan, payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 1 } } }),
  ]) {
    const fake = transport({ transformAgreement }), adapter = createVillageSubscriptionsSdk({ ...base, httpAdapter: fake.adapter }), prepared = prepare();
    const pending = await adapter.createApproval({ prepared });
    await assert.rejects(adapter.readAgreement({ prepared, planId: pending.planId, subscriptionId: pending.subscriptionId }), { code: 'subscription_agreement_mismatch' });
  }
});

test('validated provider identity is saved before a late response-access loss is reported', async () => {
  const fake = transport(), adapter = createVillageSubscriptionsSdk({ ...base, httpAdapter: fake.adapter }), prepared = prepare();
  let persisted = null;
  await assert.rejects(adapter.createApproval({ prepared, onApproval: result => { persisted = result; }, assertResponseAccess: () => { throw new Error('signed out'); } }), /signed out/);
  assert.equal(persisted.status, 'approval_pending');
  assert.match(persisted.subscriptionId, /^I-/);
});
