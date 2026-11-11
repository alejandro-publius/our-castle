import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEMO_GOAL_ID, DEMO_HOUSEHOLD_ID, getAchievements, progressFor } from '../../server/household.mjs';
import { MIGRATIONS, openDatabase } from '../../server/db.mjs';
import { reconcileOrder } from '../../server/steward/index.mjs';
import { contribution, requestId, setupDomain } from '../helpers/setup.mjs';
import { webhookHeaders } from '../helpers/fake-paypal.mjs';

// A held contribution: PayPal authorizes the adult-approved amount, nothing is credited, and an adult later releases an
// exact amount of it (one final capture) or returns it (a void). These run against the fake sandbox only. They are
// evidence about this server's logic, not that a real sandbox hold works.
const OWNER = { householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID };
const decision = (id, overrides = {}) => ({ contributionId: id, ...OWNER, approverId: 'm_rowan', approvalConfirmed: true, requestId: requestId(), ...overrides });
const ledger = (env) => env.db.prepare("SELECT kind, effect, amount_cents FROM ledger_entries WHERE kind IN ('contribution', 'simulated_contribution', 'refund') ORDER BY id").all().map((r) => ({ ...r }));
const holdRow = (env, id) => ({ ...env.db.prepare('SELECT * FROM payment_holds WHERE order_id = ?').get(id) });

for (const adapter of ['rest', 'sdk']) {
  /** Create a held order, approve it (as the buyer would in PayPal) and place the hold. */
  async function held(env, overrides = {}) {
    const created = await env.service.createPayPalOrder(contribution({ hold: true, ...overrides }));
    const placed = await env.service.capturePayPalOrder({ providerOrderId: created.orderId, ...OWNER });
    return { orderId: created.orderId, id: created.contribution.id, placed };
  }
  const paths = (env, suffix) => env.fake.requests.filter((r) => r.pathname.endsWith(suffix));

  test(`[${adapter}] a held contribution asks PayPal to authorize, places the hold and credits nothing`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const { orderId, id, placed } = await held(env, { amountCents: 4000 });
    const create = env.fake.requests.find((r) => r.pathname === '/v2/checkout/orders');
    assert.equal(create.body.intent, 'AUTHORIZE');
    assert.deepEqual(create.body.purchase_units[0].amount, { currency_code: 'USD', value: '40.00' });
    assert.equal(create.body.purchase_units[0].custom_id, id);
    assert.equal(paths(env, '/authorize').length, 1);
    assert.match(paths(env, '/authorize')[0].headers['paypal-request-id'], /^authorize-ctb_/);
    assert.equal(paths(env, '/capture').length, 0, 'placing a hold captures nothing');
    assert.equal(placed.outcome, 'held');
    assert.equal(placed.contribution.status, 'held');
    assert.deepEqual(placed.contribution.hold, { status: 'held', heldCents: 4000, releaseCents: null, authorizationId: env.fake.orders.get(orderId).purchase_units[0].payments.authorizations[0].id, decidedBy: null, expiresAt: '2026-12-02T12:00:00Z' });
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000, 'a hold is not progress');
    assert.deepEqual(ledger(env), []);
    assert.equal(getAchievements(env.db, DEMO_GOAL_ID).length, 0);
    // Asking again places nothing new.
    const again = await env.service.capturePayPalOrder({ providerOrderId: orderId, ...OWNER });
    assert.equal(again.outcome, 'held');
    assert.equal(paths(env, '/authorize').length, 1);
    // The ordinary checkout is unchanged: no hold row, intent CAPTURE.
    const plain = await env.service.createPayPalOrder(contribution());
    assert.equal(plain.contribution.hold, undefined);
    assert.equal(env.fake.requests.filter((r) => r.pathname === '/v2/checkout/orders').at(-1).body.intent, 'CAPTURE');
  });

  test(`[${adapter}] an adult releases the whole hold: one final capture, credited once, safe to replay`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const { id } = await held(env);
    const first = decision(id, { amountCents: 1500 });
    const released = await env.service.releaseHold(first);
    assert.equal(released.outcome, 'completed');
    assert.deepEqual(released.awarded, [1]);
    assert.equal(released.progress.progressCents, 7500);
    assert.equal(released.contribution.status, 'completed');
    assert.equal(released.contribution.hold.status, 'released');
    assert.equal(released.contribution.hold.decidedBy, 'm_rowan');
    const capture = paths(env, '/capture')[0];
    assert.match(capture.pathname, /^\/v2\/payments\/authorizations\/AUTH/);
    assert.deepEqual(capture.body, { amount: { currency_code: 'USD', value: '15.00' }, final_capture: true });
    assert.match(capture.headers['paypal-request-id'], /^release-ctb_.*-1500$/);
    // The same request again is answered from the record; a new request is refused. PayPal is not asked twice.
    assert.equal((await env.service.releaseHold(first)).outcome, 'already_completed');
    await assert.rejects(env.service.releaseHold(decision(id, { amountCents: 1500 })), { code: 'hold_decided' });
    await assert.rejects(env.service.returnHold(decision(id)), { code: 'hold_decided' });
    assert.equal(paths(env, '/capture').length, 1);
    assert.equal(paths(env, '/void').length, 0);
    assert.deepEqual(ledger(env), [{ kind: 'contribution', effect: 1, amount_cents: 1500 }]);
  });

  test(`[${adapter}] a partial release credits exactly the released amount and nothing more`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const { orderId, id } = await held(env, { amountCents: 4000 });
    const released = await env.service.releaseHold(decision(id, { amountCents: 2500 }));
    assert.equal(released.outcome, 'completed');
    assert.equal(released.progress.progressCents, 8500);
    assert.equal(released.contribution.amountCents, 4000, 'the approved hold is still on record');
    assert.deepEqual(released.contribution.captures.map((c) => [c.amountCents, c.credited]), [[2500, true]]);
    assert.equal(released.contribution.hold.releaseCents, 2500);
    assert.deepEqual(paths(env, '/capture')[0].body, { amount: { currency_code: 'USD', value: '25.00' }, final_capture: true });
    assert.deepEqual(ledger(env), [{ kind: 'contribution', effect: 1, amount_cents: 2500 }]);
    // An explicit check agrees with PayPal: the capture is compared to the released amount, not the held one.
    const checked = await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...OWNER });
    assert.equal(checked.check.verdict, 'match');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 8500, 'checking again credits nothing more');
    // The released part can be refunded like any other credited capture.
    const refunded = await env.service.refundPayPalCapture({ captureId: released.contribution.captures[0].captureId, householdId: DEMO_HOUSEHOLD_ID, approverId: 'm_rowan', approvalConfirmed: true });
    assert.equal(refunded.outcome, 'refunded');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000);
  });

  test(`[${adapter}] an adult returns the hold: a void, never credited, and nothing can be released afterwards`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const { orderId, id } = await held(env);
    const first = decision(id);
    const returned = await env.service.returnHold(first);
    assert.equal(returned.outcome, 'returned');
    assert.equal(returned.contribution.status, 'returned');
    assert.equal(returned.contribution.hold.status, 'returned');
    assert.equal(paths(env, '/void').length, 1);
    assert.match(paths(env, '/void')[0].headers['paypal-request-id'], /^return-ctb_/);
    assert.equal(paths(env, '/capture').length, 0);
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000);
    assert.deepEqual(ledger(env), []);
    assert.equal((await env.service.returnHold(first)).outcome, 'returned');
    await assert.rejects(env.service.releaseHold(decision(id, { amountCents: 1500 })), { code: 'hold_decided' });
    assert.equal(paths(env, '/void').length, 1);
    const checked = await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...OWNER });
    assert.equal(checked.outcome, 'returned');
    assert.equal(checked.check.verdict, 'match');
  });

  test(`[${adapter}] only an adult of the owning household decides, for a valid amount, after explicit confirmation`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const { id } = await held(env, { amountCents: 4000 });
    const refuse = (input, code) => assert.rejects(env.service.releaseHold(input), { code });
    await refuse(decision(id, { amountCents: 1500, approverId: 'm_wren' }), 'adult_approval_required');
    await refuse(decision(id, { amountCents: 1500, approvalConfirmed: 'yes' }), 'approval_required');
    await refuse(decision(id, { amountCents: 1500, householdId: 'hh_other' }), 'order_mismatch');
    await refuse(decision(id, { amountCents: 1500, goalId: 'goal_other' }), 'order_mismatch');
    await refuse(decision(id, { amountCents: 1500, requestId: 'x' }), 'invalid_request_id');
    await refuse(decision(id, { amountCents: 4001 }), 'invalid_amount');
    await refuse(decision(id, { amountCents: 99 }), 'invalid_amount');
    await refuse(decision(id, { amountCents: 15.5 }), 'invalid_amount');
    await refuse(decision('ctb_not_ours', { amountCents: 1500 }), 'unknown_hold');
    await assert.rejects(env.service.returnHold(decision(id, { approverId: 'm_wren' })), { code: 'adult_approval_required' });
    await assert.rejects(env.service.returnHold(decision(id, { approvalConfirmed: false })), { code: 'approval_required' });
    // An ordinary contribution is not a hold.
    const plain = await env.service.createPayPalOrder(contribution());
    await refuse(decision(plain.contribution.id, { amountCents: 1500 }), 'unknown_hold');
    assert.equal(paths(env, '/capture').length, 0, 'every refusal came before PayPal was asked');
    assert.equal(paths(env, '/void').length, 0);
    assert.equal(holdRow(env, id).status, 'held');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000);
  });

  test(`[${adapter}] a release can never take progress past the goal`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const { id } = await held(env, { amountCents: 20000 });
    // Other contributions land while the hold waits: only 5,000 cents are still needed.
    for (const amountCents of [9500, 9500]) {
      const plain = await env.service.createPayPalOrder(contribution({ amountCents }));
      await env.service.capturePayPalOrder({ providerOrderId: plain.orderId, ...OWNER });
    }
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 25000);
    await assert.rejects(env.service.releaseHold(decision(id, { amountCents: 20000 })), { code: 'over_goal' });
    assert.equal(holdRow(env, id).status, 'held', 'a refused release leaves the hold open');
    const released = await env.service.releaseHold(decision(id, { amountCents: 5000 }));
    assert.equal(released.outcome, 'completed');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 30000);
  });

  test(`[${adapter}] a capture that does not match the adult's release, or that no adult released, is never credited`, async () => {
    for (const [option, value] of [['captureAmountOverride', '40.00'], ['captureCurrencyOverride', 'EUR'], ['captureCustomIdOverride', 'ctb_someone_else']]) {
      const env = setupDomain({ adapter, mode: 'sandbox', paypalOptions: { [option]: value } });
      const { id } = await held(env, { amountCents: 4000 });
      const result = await env.service.releaseHold(decision(id, { amountCents: 2500 }));
      assert.equal(result.outcome, 'rejected_mismatch', option);
      assert.equal(result.contribution.status, 'rejected');
      assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000, `${option}: no progress`);
    }
    // A capture reported for a hold nobody released here (made in PayPal directly, say).
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const { orderId, id } = await held(env);
    const event = { id: 'WH-HOLD-STRAY', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAPTURE-STRAY', status: 'COMPLETED', amount: { currency_code: 'USD', value: '15.00' }, custom_id: id, supplementary_data: { related_ids: { order_id: orderId } } } };
    assert.equal((await env.service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify(event) })).outcome, 'rejected_mismatch');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000);
    assert.deepEqual(ledger(env), []);
  });

  test(`[${adapter}] a hold whose amount, currency or reference differs from the server record is rejected and holds nothing here`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox', paypalOptions: { authorizationAmountOverride: '400.00' } });
    const { id, placed } = await held(env, { amountCents: 4000 });
    assert.equal(placed.outcome, 'rejected_mismatch');
    assert.equal(placed.contribution.status, 'rejected');
    assert.equal(placed.contribution.hold.status, 'failed');
    await assert.rejects(env.service.releaseHold(decision(id, { amountCents: 4000 })), { code: 'hold_decided' });
    assert.equal(paths(env, '/capture').length, 0);
  });

  test(`[${adapter}] an unanswered release is never guessed: it stays recheckable, and PayPal's own record settles it once`, async () => {
    // (a) PayPal did capture, but the answer was lost.
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const { orderId, id } = await held(env, { amountCents: 4000 });
    const original = env.fake.fetch;
    let lose = true;
    const lossy = async (url, init) => { const response = await original(url, init); if (lose && new URL(url).pathname.endsWith('/capture')) { lose = false; throw new TypeError('socket hang up'); } return response; };
    if (adapter === 'rest') env.fake.fetch = lossy;
    const service = adapter === 'rest'
      ? (await import('../../server/payments/contributions.mjs')).createContributionService({ db: env.db, clock: env.clock, mode: 'sandbox', webhookId: 'WH-TEST',
        paypal: (await import('../../server/payments/paypal-client.mjs')).createPayPalClient({ clientId: 'test-client-id', clientSecret: 'test-client-secret', fetch: lossy }) })
      : env.service;
    if (adapter === 'sdk') {
      // The SDK adapter reports a lost answer as a server error: same unknown outcome.
      const capture = env.controllers.payments.captureAuthorizedPayment;
      env.controllers.payments.captureAuthorizedPayment = async (args) => { await capture(args); env.controllers.payments.captureAuthorizedPayment = capture; const error = new Error('socket hang up'); error.code = 'ECONNRESET'; throw error; };
    }
    const unknown = await service.releaseHold(decision(id, { amountCents: 2500 }));
    assert.equal(unknown.outcome, 'unknown');
    assert.equal(unknown.contribution.status, 'pending');
    assert.equal(unknown.contribution.hold.status, 'releasing');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000, 'nothing is credited on an unknown outcome');
    await assert.rejects(service.releaseHold(decision(id, { amountCents: 2500 })), { code: 'hold_in_progress' });
    await assert.rejects(service.returnHold(decision(id)), { code: 'hold_in_progress' });
    const settled = await service.refreshPayPalOrder({ providerOrderId: orderId, ...OWNER });
    assert.equal(settled.outcome, 'completed');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 8500);
    assert.equal((await service.refreshPayPalOrder({ providerOrderId: orderId, ...OWNER })).outcome, 'already_completed');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 8500, 'settled exactly once');

    // (b) PayPal did not capture: an explicit check shows the hold intact, and an adult may decide again.
    const other = setupDomain({ adapter, mode: 'sandbox', paypalOptions: { releaseError: { status: 503, issue: 'INTERNAL_SERVER_ERROR' } } });
    const second = await held(other, { amountCents: 4000 });
    assert.equal((await other.service.releaseHold(decision(second.id, { amountCents: 2500 }))).outcome, 'unknown');
    assert.equal(holdRow(other, second.id).status, 'releasing');
    other.fake.behavior.releaseError = null;
    const reopened = await other.service.refreshPayPalOrder({ providerOrderId: second.orderId, ...OWNER });
    assert.equal(reopened.outcome, 'held');
    assert.equal(reopened.contribution.hold.status, 'held');
    assert.equal(reopened.contribution.hold.releaseCents, null);
    assert.equal((await other.service.returnHold(decision(second.id))).outcome, 'returned');
    assert.equal(progressFor(other.db, DEMO_GOAL_ID).progressCents, 6000);
  });

  test(`[${adapter}] a release PayPal definitely refuses leaves the hold open; one it reports returned or expired ends it`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox', paypalOptions: { releaseError: { status: 422, issue: 'INSTRUMENT_DECLINED' } } });
    const { id } = await held(env);
    await assert.rejects(env.service.releaseHold(decision(id, { amountCents: 1500 })), { code: 'paypal_error' });
    assert.equal(holdRow(env, id).status, 'held');
    assert.equal(holdRow(env, id).release_cents, null);
    env.fake.behavior.releaseError = { status: 422, issue: 'AUTHORIZATION_EXPIRED' };
    const lapsed = await env.service.releaseHold(decision(id, { amountCents: 1500 }));
    assert.equal(lapsed.outcome, 'lapsed');
    assert.equal(lapsed.contribution.status, 'lapsed');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000);
  });

  test(`[${adapter}] verified hold webhooks record a return made elsewhere, credit nothing, and ignore orders that are not holds`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const { orderId, id } = await held(env);
    const authorization = structuredClone(env.fake.orders.get(orderId).purchase_units[0].payments.authorizations[0]);
    const deliver = (eventId, type, resource) => env.service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify({ id: eventId, event_type: type, resource }) });
    const related = { supplementary_data: { related_ids: { order_id: orderId } } };
    assert.equal((await deliver('WH-AUTH-1', 'PAYMENT.AUTHORIZATION.CREATED', { ...authorization, ...related })).outcome, 'held');
    assert.equal((await deliver('WH-AUTH-2', 'PAYMENT.AUTHORIZATION.VOIDED', { ...authorization, status: 'VOIDED', ...related })).outcome, 'returned');
    assert.equal(holdRow(env, id).status, 'returned');
    assert.equal((await deliver('WH-AUTH-2', 'PAYMENT.AUTHORIZATION.VOIDED', { ...authorization, status: 'VOIDED', ...related })).outcome, 'duplicate_event');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000);
    // An authorization event for an ordinary order, or for an order this server never made, is ignored.
    const plain = await env.service.createPayPalOrder(contribution());
    assert.equal((await deliver('WH-AUTH-3', 'PAYMENT.AUTHORIZATION.CREATED', { ...authorization, id: 'AUTH-OTHER', supplementary_data: { related_ids: { order_id: plain.orderId } } })).outcome, 'ignored_unknown_order');
    assert.equal((await deliver('WH-AUTH-4', 'PAYMENT.AUTHORIZATION.CREATED', { ...authorization, id: 'AUTH-OTHER', supplementary_data: { related_ids: { order_id: 'ORDER-NOT-OURS' } } })).outcome, 'ignored_unknown_order');
  });
}

test('example mode: a simulated hold credits nothing until an adult releases part of it; another is returned', () => {
  const env = setupDomain({ mode: 'example' });
  const placed = env.service.simulateContribution(contribution({ amountCents: 4000, hold: true }));
  assert.equal(placed.outcome, 'held');
  assert.equal(placed.contribution.simulated, true);
  assert.match(placed.contribution.statusDetail, /^Simulated: \$40\.00 is held/);
  assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000);
  return (async () => {
    await assert.rejects(env.service.releaseHold(decision(placed.contribution.id, { amountCents: 2500, approverId: 'm_wren' })), { code: 'adult_approval_required' });
    const released = await env.service.releaseHold(decision(placed.contribution.id, { amountCents: 2500 }));
    assert.equal(released.outcome, 'completed');
    assert.equal(released.progress.progressCents, 8500);
    assert.deepEqual(ledger(env), [{ kind: 'simulated_contribution', effect: 1, amount_cents: 2500 }]);
    const second = env.service.simulateContribution(contribution({ amountCents: 1500, hold: true }));
    const returned = await env.service.returnHold(decision(second.contribution.id));
    assert.equal(returned.outcome, 'returned');
    assert.match(returned.contribution.statusDetail, /^Simulated: the hold of \$15\.00 was returned/);
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 8500);
    // A simulated hold cannot be decided through the sandbox service, and the other way round.
    const sandbox = setupDomain({ mode: 'sandbox' });
    const created = await sandbox.service.createPayPalOrder(contribution({ hold: true }));
    await sandbox.service.capturePayPalOrder({ providerOrderId: created.orderId, ...OWNER });
    assert.equal(sandbox.service.mode, 'sandbox');
  })();
});

test('reconciliation reads an open, returned or partly released hold as agreement, and a stray capture as a difference', () => {
  const base = { id: 'ctb_x', providerOrderId: 'ORDER-X', amountCents: 4000, currency: 'USD', status: 'held', captures: [], hold: { status: 'held', heldCents: 4000, releaseCents: null } };
  const order = (payments) => ({ id: 'ORDER-X', status: 'COMPLETED', purchase_units: [{ reference_id: 'ctb_x', payments }] });
  assert.equal(reconcileOrder(order({ authorizations: [{ id: 'A', status: 'CREATED' }] }), base).note, 'Held in PayPal, and not counted in the ledger.');
  assert.equal(reconcileOrder(order({ authorizations: [{ id: 'A', status: 'VOIDED' }] }), { ...base, status: 'returned' }).verdict, 'match');
  const capture = { id: 'C', status: 'COMPLETED', amount: { currency_code: 'USD', value: '25.00' } };
  const released = { ...base, status: 'completed', hold: { status: 'released', heldCents: 4000, releaseCents: 2500 }, captures: [{ captureId: 'C', credited: true, refundedCents: 0 }] };
  assert.equal(reconcileOrder(order({ authorizations: [{ id: 'A', status: 'CAPTURED' }], captures: [capture] }), released).verdict, 'match');
  assert.equal(reconcileOrder(order({ authorizations: [{ id: 'A', status: 'CAPTURED' }], captures: [{ ...capture, amount: { currency_code: 'USD', value: '40.00' } }] }), released).verdict, 'differs');
});

test('a schema-17 database gains only the payment_holds table; every earlier row is unchanged', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'our-castle-payment-holds-'));
  try {
    const file = path.join(dir, 'schema-17.sqlite');
    const step = MIGRATIONS.findIndex((m) => m.id === 'payment-holds');
    assert.deepEqual([step, MIGRATIONS.length], [17, 18], 'held contributions are step 18, the last');
    const old = new DatabaseSync(file);
    old.exec('PRAGMA foreign_keys = ON');
    MIGRATIONS.slice(0, step).forEach((m, i) => { if (typeof m === 'string') old.exec(m); else m.ensure(old); old.exec(`PRAGMA user_version = ${i + 1}`); });
    old.exec(`INSERT INTO households (id, name, play_mode, crest_field, crest_charge, is_example, setup_complete, created_at) VALUES ('hh_kept', 'House Kept', 'family', 'cobalt', 'stag', 0, 1, '2026-11-01T00:00:00.000Z');
      INSERT INTO goals (id, household_id, name, target_cents, currency, target_date, weekly_budget_cents, created_at) VALUES ('goal_kept', 'hh_kept', 'Garden', 30000, 'USD', '2026-12-29', 3000, '2026-11-01T00:00:00.000Z');
      INSERT INTO payment_orders (id, provider, provider_order_id, request_id, household_id, goal_id, approved_by, amount_cents, currency, status, created_at, updated_at)
        VALUES ('ctb_kept', 'paypal-sandbox', 'ORDER-KEPT', 'request-kept', 'hh_kept', 'goal_kept', 'm_kept', 1500, 'USD', 'completed', '2026-11-05T00:00:00.000Z', '2026-11-05T00:00:00.000Z');
      INSERT INTO payment_captures (capture_id, order_id, amount_cents, currency, status, credited, created_at, updated_at) VALUES ('CAPTURE-KEPT', 'ctb_kept', 1500, 'USD', 'COMPLETED', 1, '2026-11-05T00:00:00.000Z', '2026-11-05T00:00:00.000Z');`);
    const tables = (d) => d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
    const rows = (d, names) => Object.fromEntries(names.map((t) => [t, d.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map((r) => ({ ...r }))]));
    const beforeTables = tables(old), before = rows(old, beforeTables);
    assert.equal(beforeTables.length, 43);
    old.close();
    const db = openDatabase(file);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18);
    assert.deepEqual(tables(db).filter((t) => !beforeTables.includes(t)), ['payment_holds']);
    assert.deepEqual(rows(db, beforeTables), before, 'every earlier row is unchanged');
    assert.deepEqual(rows(db, ['payment_holds']).payment_holds, [], 'an existing contribution is not turned into a hold');
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    db.close();
    const again = openDatabase(file);
    assert.equal(again.prepare('PRAGMA user_version').get().user_version, 18);
    again.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
