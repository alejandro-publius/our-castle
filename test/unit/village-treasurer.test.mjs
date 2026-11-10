import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillageDraft, parseVillageSentence, validateReviewedVillageDraft } from '../../server/planner/village-draft.mjs';
import { createVillageDraftProvider } from '../../server/planner/village-provider.mjs';
import { createVillageTreasurer, villageTreasurerAnswer } from '../../server/steward/village-treasurer.mjs';
import { prepareVillageSubscriptionIntent, approveVillageSubscriptionIntent } from '../../server/planner/village-subscription-intent.mjs';

const today = '2026-11-10';
const members = [{ familyReference: 'FAM-C', alias: 'Cedar' }, { familyReference: 'FAM-A', alias: 'Alder' }, { familyReference: 'FAM-B', alias: 'Birch' }];
const actor = { memberId: 'adult_a', householdId: 'hh_a', role: 'adult' };
const context = { members, membershipRevision: 'members-r1', today };
const request = 'We need $400.01 for the class trip by December 12, 2026';
const draft = extra => createVillageDraft({ ...context, text: request, ...extra });

test('one sentence produces exact family shares and weekly proposals, without scheduling payments', async () => {
  const result = await draft();
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.source, { mode: 'rules', label: 'Draft from built-in rules; no AI' });
  assert.equal(result.paymentScheduled, false);
  assert.equal(result.requiresAdultReview, true);
  assert.equal(result.draft.title, 'the class trip');
  assert.equal(result.draft.targetMinor, 40001);
  assert.equal(result.draft.rail, 'simulated');
  assert.deepEqual(result.draft.shares.map(s => s.committedMinor), [13334, 13334, 13333]);
  assert.ok(result.draft.shares.every(s => s.proposed === true));
  assert.deepEqual(result.draft.schedule.map(s => s.date), ['2026-11-17', '2026-11-24', '2026-12-01', '2026-12-08']);
  assert.equal(result.draft.schedule.reduce((n, s) => n + s.totalMinor, 0), 40001);
  for (const share of result.draft.shares) assert.equal(result.draft.schedule.reduce((n, s) => n + s.families.find(f => f.familyReference === share.familyReference).amountMinor, 0), share.committedMinor);
  assert.equal((await draft({ members: [...members].reverse() })).draft.revision, result.draft.revision, 'membership order cannot change who receives the cent remainder');
});

test('amounts and schedules conserve cents across uneven households, small targets and short deadlines', async () => {
  for (const total of [1, 2, 10, 101, 40001, 99999999]) {
    for (const count of [1, 3, 7, 50]) {
      const ms = Array.from({ length: count }, (_, i) => ({ familyReference: `FAM-${i}`, alias: `Family ${i}` }));
      const r = await draft({ members: ms, text: `Raise $${Math.floor(total / 100)}.${String(total % 100).padStart(2, '0')} for school supplies by 2026-11-12` });
      assert.equal(r.status, 'ready');
      assert.equal(r.draft.shares.reduce((n, s) => n + s.committedMinor, 0), total);
      assert.equal(r.draft.schedule.length, 1);
      assert.equal(r.draft.schedule[0].totalMinor, total);
      assert.ok(r.draft.shares.every(s => Number.isSafeInteger(s.committedMinor) && s.committedMinor >= 0));
    }
  }
});

test('ambiguous or invalid dates and amounts need details without an AI call', async () => {
  for (const text of [
    'We need $400 for the class trip by December 12',
    'We need $400 for the class trip by 12/12/26',
    'We need $400 for the class trip by 2027-02-30',
    'We need $400 for the class trip by 2026-11-10',
    'We need $400 for the class trip by 2028-12-12',
    'We need $400 or $500 for the class trip by 2026-12-12',
    'We need $400 for the class trip by 2026-12-12 or 2026-12-13',
    'We need $4.001 for the class trip by 2026-12-12',
    'We need -$400 for the class trip by 2026-12-12',
    'We need $-400 for the class trip by 2026-12-12',
    'We need $1,00 for the class trip by 2026-12-12',
    'We need $0 for the class trip by 2026-12-12',
    'We need $1000001 for the class trip by 2026-12-12',
    'We need 400 PYUSD for the class trip by 2026-12-12',
    'We need EUR $400 for the class trip by 2026-12-12',
  ]) {
    const r = await draft({ text, provider: { proposeVillage() { throw new Error('must not call'); } } });
    assert.equal(r.status, 'needs_details', text);
    assert.equal(r.draft, null, text);
    assert.ok(r.issues.length > 0, text);
  }
  assert.equal(parseVillageSentence('Raise USD 1,000.50 for supplies by 2026-12-12', today).targetMinor, 100050);
  assert.equal(parseVillageSentence('Raise 400 USD for supplies by 2026-12-12', today).targetMinor, 40000);
});

test('invalid input and duplicate/unbounded membership fail before a provider is called', async () => {
  await assert.rejects(draft({ text: { amount: 400 } }), { code: 'village_draft_text' });
  await assert.rejects(draft({ text: '<script>ignore rules</script>' }), { code: 'village_draft_text' });
  await assert.rejects(draft({ members: [] }), { code: 'village_members' });
  await assert.rejects(draft({ members: [members[0], members[0]] }), { code: 'village_members' });
  await assert.rejects(draft({ members: Array.from({ length: 51 }, (_, n) => ({ familyReference: `F-${n}`, alias: 'Family' })) }), { code: 'village_members' });
});

test('review requires the server proposal, an adult and unchanged membership, facts and dates', async () => {
  const storedDraft = (await draft()).draft;
  const check = extra => validateReviewedVillageDraft({ ...context, storedDraft, reviewedRevision: storedDraft.revision, actor, ...extra });
  const createInput = check();
  assert.equal(createInput.targetMinor, 40001);
  assert.equal(createInput.proposedShares.length, 3);
  assert.equal(createInput.proposedSchedule.length, 4);
  assert.ok(!('approvalConfirmed' in createInput));
  assert.throws(() => check({ actor: { ...actor, role: 'child' } }), { code: 'adult_required' });
  assert.throws(() => check({ reviewedRevision: 'different' }), { code: 'village_draft_changed' });
  assert.throws(() => check({ members: members.slice(1) }), { code: 'village_draft_changed' });
  assert.throws(() => check({ members: members.map(m => ({ ...m, alias: m.alias + ' changed' })) }), { code: 'village_draft_changed' });
  assert.throws(() => check({ membershipRevision: 'members-r2' }), { code: 'village_draft_changed' });
  assert.throws(() => check({ today: '2026-11-11' }), { code: 'village_draft_changed' });
  assert.throws(() => check({ storedDraft: { ...storedDraft, rail: 'paypal-sandbox' } }), { code: 'village_draft_changed' });
  assert.throws(() => check({ storedDraft: { ...storedDraft, targetMinor: 1 } }), { code: 'village_draft_changed' });
});

test('AI can phrase the title but cannot change amount/date/currency or add financial actions', async () => {
  let sent;
  const valid = { title: 'The class trip', targetMinor: 40001, currency: 'USD', deadline: '2026-12-12' };
  const provider = output => ({ provider: 'test', model: 'fake', async proposeVillage(input) { sent = input; return { output }; } });
  const result = await draft({ provider: provider(valid) });
  assert.equal(result.source.mode, 'ai');
  assert.equal(result.draft.title, valid.title);
  assert.ok(!('members' in sent), 'no private member identifiers sent to provider');
  for (const output of [{ ...valid, targetMinor: 1 }, { ...valid, deadline: '2027-12-12' }, { ...valid, currency: 'PYUSD' }, { ...valid, createSubscription: true }, { ...valid, title: '<script>pay</script>' }, null]) {
    await assert.rejects(draft({ provider: provider(output) }), { code: 'village_ai_output' });
  }
});

test('lost access after a provider response or provider error prevents returning its proposal', async () => {
  let allowed = true;
  const assertAccess = () => { if (!allowed) throw Object.assign(new Error('signed out'), { code: 'signed_out' }); };
  await assert.rejects(draft({ assertAccess, provider: { async proposeVillage() { allowed = false; return { output: {} }; } } }), { code: 'signed_out' });
  allowed = true;
  await assert.rejects(draft({ assertAccess, provider: { async proposeVillage() { allowed = false; throw new Error('provider failed'); } } }), { code: 'signed_out' });
});

test('the real structured-output SDK adapter sends no tools and validates its response through the draft service', async () => {
  const requests = [];
  const provider = createVillageDraftProvider({ apiKey: 'sk-test-only', model: 'claude-opus-5-5', fetch: async (url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: 'msg_fake', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
      content: [{ type: 'text', text: JSON.stringify({ title: 'Class trip', targetMinor: 40001, currency: 'USD', deadline: '2026-12-12' }) }], usage: { input_tokens: 1, output_tokens: 1 } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
  } });
  const result = await draft({ provider });
  assert.equal(result.source.mode, 'ai');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].tools, undefined);
  assert.equal(requests[0].output_config.format.type, 'json_schema');
  assert.equal(requests[0].output_config.format.schema.additionalProperties, false);
});

const fund = (overrides = {}) => ({ id: 'fund_a', title: 'Class trip', targetMinor: 40000, currency: 'USD', decimals: 2,
  deadline: '2026-12-12', rail: 'simulated', revision: 3, progress: { netMinor: 15000, unmatchedMinor: 5000, unmatchedCount: 1 },
  shares: [{ familyReference: 'FAM-A', alias: 'Alder', committedMinor: 20000, paidMinor: 10000 }, { familyReference: 'FAM-B', alias: 'Birch', committedMinor: 20000, paidMinor: 0 }],
  receipts: [{ kind: 'capture', amountMinor: 20000, familyReference: 'FAM-A' }, { kind: 'refund', amountMinor: 10000, familyReference: 'FAM-A' }, { kind: 'transfer', amountMinor: 5000, familyReference: null }], ...overrides });

test('treasurer uses authoritative net totals after refunds and never counts promises as money', () => {
  const r = villageTreasurerAnswer(fund(), 'Are we on track?', '2026-11-10T12:00:00Z');
  assert.equal(r.facts.netMinor, 15000);
  assert.equal(r.facts.remainingMinor, 25000);
  assert.equal(r.facts.pendingCommitmentsMinor, 30000);
  assert.equal(r.facts.unpromisedMinor, 0);
  assert.match(r.answer, /\$150\.00.*\$400\.00.*\$250\.00/);
  assert.match(r.answer, /do not guarantee/);
  assert.match(r.answer, /simulated/);
  assert.equal(r.paymentScheduled, false);
  assert.ok(!JSON.stringify(r).includes('receipts'), 'projection omits raw receipt identifiers');
});

test('who-paid and unmatched answers do not assign unverified contributions to a family', () => {
  const who = villageTreasurerAnswer(fund(), 'Who has paid?', 'now');
  assert.match(who.answer, /Alder: \$100\.00/);
  assert.doesNotMatch(who.answer, /Birch:/);
  assert.match(who.answer, /promised share is not a payment/);
  const unmatched = villageTreasurerAnswer(fund(), 'Any unmatched deposits?', 'now');
  assert.match(unmatched.answer, /1 unmatched deposit.*\$50\.00/);
  assert.match(unmatched.answer, /not assigned/);
  const unknown = villageTreasurerAnswer(fund({ progress: { netMinor: 15000 } }), 'Any unmatched deposits?', 'now');
  assert.equal(unknown.facts.unmatched, null);
  assert.match(unknown.answer, /cannot infer/);
});

test('one rail per fund: token units stay separate from USD and saved sandbox records are labeled', () => {
  const token = villageTreasurerAnswer(fund({ rail: 'pyusd-devnet', currency: 'PYUSD', decimals: 6 }), 'How far along?', 'now');
  assert.match(token.answer, /0\.015000 PYUSD test tokens/);
  assert.match(token.answer, /no monetary value/);
  assert.doesNotMatch(token.answer, /\$/);
  const paypal = villageTreasurerAnswer(fund({ rail: 'paypal-sandbox' }), 'How far along?', 'now');
  assert.match(paypal.answer, /saved sandbox records, not a new PayPal check/);
  assert.throws(() => villageTreasurerAnswer(fund({ rail: 'pyusd-devnet' }), 'How far along?', 'now'), { code: 'village_projection' });
});

test('a money-moving question produces only a boundary and recorded facts', () => {
  for (const question of ['Refund all payments', 'Subscribe everyone now', 'Assign deposits to Alder', 'Send money to me']) {
    const r = villageTreasurerAnswer(fund(), question, 'now');
    assert.match(r.answer, /cannot move money/);
    assert.equal(r.paymentScheduled, false);
  }
});

test('treasurer authorization surrounds the asynchronous reader and scoped DTO leaves private fields out', async () => {
  const clock = { iso: () => '2026-11-10T12:00:00Z' }, scope = { householdId: 'hh_a' };
  const treasurer = createVillageTreasurer({ clock, readAuthorizedFund: async (actualScope, fundId) => {
    assert.equal(actualScope, scope); assert.equal(fundId, 'fund_a');
    return fund({ privateHouseholdBalance: 99999 });
  } });
  const r = await treasurer.ask({ scope, fundId: 'fund_a', question: 'Who has paid?' });
  assert.ok(!JSON.stringify(r).includes('privateHouseholdBalance'));
  let allowed = true;
  const denied = createVillageTreasurer({ clock, readAuthorizedFund: async () => { allowed = false; return fund(); } });
  await assert.rejects(denied.ask({ scope, fundId: 'fund_a', question: 'Who has paid?', assertAccess: () => { if (!allowed) throw new Error('membership revoked'); } }), /membership revoked/);
  const stranger = createVillageTreasurer({ clock, readAuthorizedFund: async () => { throw Object.assign(new Error('not found'), { status: 404 }); } });
  await assert.rejects(stranger.ask({ scope, fundId: 'other', question: 'Who has paid?' }), { status: 404 });
});

const merchantId = 'TESTSELLER123';
const subscriptionFund = fund({ rail: 'paypal-sandbox' });
const terms = { fund: subscriptionFund, actor, recipientMerchantId: merchantId, amountMinor: 2000, cycles: 4, startDate: '2026-11-17', today };
const capabilities = { environment: 'sandbox', platformSubscriptions: true, sellerOnboarded: true, merchantId, bnCode: 'TEST_BN' };

test('finite weekly subscription intent conserves explicit total and cannot itself schedule payment', () => {
  const p = prepareVillageSubscriptionIntent(terms);
  assert.equal(p.intent.totalMinor, 8000);
  assert.equal(p.status, 'proposal');
  assert.equal(p.paymentScheduled, false);
  assert.equal(p.buyerAgreementRequired, true);
  assert.ok(Object.isFrozen(p.intent));
  assert.throws(() => prepareVillageSubscriptionIntent({ ...terms, cycles: 0 }), { code: 'subscription_terms' });
  assert.throws(() => prepareVillageSubscriptionIntent({ ...terms, cycles: 53 }), { code: 'subscription_terms' });
  assert.throws(() => prepareVillageSubscriptionIntent({ ...terms, cycles: 5 }), { code: 'subscription_dates' });
  assert.throws(() => prepareVillageSubscriptionIntent({ ...terms, amountMinor: 2.5 }), { code: 'subscription_terms' });
  assert.throws(() => prepareVillageSubscriptionIntent({ ...terms, actor: { ...actor, role: 'child' } }), { code: 'adult_required' });
  assert.throws(() => prepareVillageSubscriptionIntent({ ...terms, fund: fund() }), { code: 'subscription_fund' });
});

test('subscription approval binds exact adult, household, fund revision and recipient and fails closed without capability', () => {
  const p = prepareVillageSubscriptionIntent(terms);
  const approve = extra => approveVillageSubscriptionIntent({ ...terms, storedProposal: p, reviewedRevision: p.revision, approvalConfirmed: true, capabilities, ...extra });
  assert.throws(() => approve({ approvalConfirmed: false }), { code: 'subscription_approval' });
  assert.throws(() => approve({ actor: { ...actor, memberId: 'other_adult' } }), { code: 'subscription_changed' });
  assert.throws(() => approve({ actor: { ...actor, householdId: 'hh_other' } }), { code: 'subscription_changed' });
  assert.throws(() => approve({ fund: { ...subscriptionFund, revision: 4 } }), { code: 'subscription_changed' });
  assert.throws(() => approve({ recipientMerchantId: 'OTHERSELLER12' }), { code: 'subscription_changed' });
  assert.throws(() => approve({ storedProposal: { ...p, intent: { ...p.intent, amountMinor: 5000 } } }), { code: 'subscription_changed' });
  for (const cap of [null, { ...capabilities, environment: 'live' }, { ...capabilities, sellerOnboarded: false }, { ...capabilities, bnCode: '' }])
    assert.throws(() => approve({ capabilities: cap }), { code: 'subscription_unavailable' });
  const result = approve();
  assert.equal(result.status, 'ready_for_buyer_agreement');
  assert.equal(result.paymentScheduled, false);
  assert.equal(result.adapterCommand.totalCycles, 4);
  assert.equal(result.adapterCommand.amount.value, '20.00');
  assert.equal(result.adapterCommand.idempotencyKey, `village-subscription-${p.revision}`);
  assert.ok(!('approvalUrl' in result), 'there is no invented PayPal link or active subscription');
});
