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
const DAY = 86_400_000;
/** Move this test's server clock to an exact instant. */
const setNow = (env, ms) => { env.clock.now = () => new Date(ms); };
const view = (env, id) => env.service.contributions(DEMO_GOAL_ID).find((c) => c.id === id);
const pick = (object, keys) => Object.fromEntries(keys.map((k) => [k, object[k]]));
const trail = (res) => res.contribution.hold.trail.map(({ step, cents }) => [step, cents ?? null]);

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
    assert.deepEqual(pick(placed.contribution.hold, ['status', 'heldCents', 'releaseCents', 'releasedCents', 'remainingCents', 'authorizationId', 'originalAuthorizationId', 'decidedBy', 'expiresAt', 'extendedAt', 'phase', 'pending', 'releasesLeft', 'canExtend']),
      { status: 'held', heldCents: 4000, releaseCents: null, releasedCents: 0, remainingCents: 4000, authorizationId: env.fake.orders.get(orderId).purchase_units[0].payments.authorizations[0].id,
        originalAuthorizationId: null, decidedBy: null, expiresAt: '2026-12-02T12:00:00Z', extendedAt: null, phase: 'guaranteed', pending: null, releasesLeft: 3, canExtend: false });
    // PayPal left out its own authorization time, so the guarantee runs three days from when this server placed the hold.
    assert.equal(Date.parse(placed.contribution.hold.honorUntil), env.clock.now().getTime() + 3 * DAY);
    assert.deepEqual(trail(placed), [['held', 4000]]);
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
    assert.match(capture.headers['paypal-request-id'], /^release-ctb_[0-9a-f]+-1500$/);
    assert.deepEqual(trail(released), [['held', 1500], ['released', 1500]]);
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
    // The money trail an adult reads on the record: the final release gave the rest back.
    assert.deepEqual(trail(released), [['held', 4000], ['released', 2500], ['returned', 1500]]);
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

  /** A service whose first answer from PayPal to a request ending in `suffix` is lost after PayPal acted on it. */
  async function losingFirstAnswer(env, suffix, sdkMethod) {
    if (adapter === 'sdk') {
      // The SDK adapter reports a lost answer as a dropped connection: the same unknown outcome.
      const real = env.controllers.payments[sdkMethod];
      env.controllers.payments[sdkMethod] = async (args) => {
        await real(args); env.controllers.payments[sdkMethod] = real;
        const error = new Error('socket hang up'); error.code = 'ECONNRESET'; throw error;
      };
      return env.service;
    }
    const original = env.fake.fetch;
    let lose = true;
    const lossy = async (url, init) => { const response = await original(url, init); if (lose && new URL(url).pathname.endsWith(suffix)) { lose = false; throw new TypeError('socket hang up'); } return response; };
    const { createContributionService } = await import('../../server/payments/contributions.mjs');
    const { createPayPalClient } = await import('../../server/payments/paypal-client.mjs');
    return createContributionService({ db: env.db, clock: env.clock, mode: 'sandbox', webhookId: 'WH-TEST',
      paypal: createPayPalClient({ clientId: 'test-client-id', clientSecret: 'test-client-secret', fetch: lossy }) });
  }

  // ---- Extending a hold: PayPal's reauthorization, once, after its three-day guarantee ----

  test(`[${adapter}] an adult extends a hold once, only after PayPal's three-day guarantee, for the same amount; later captures use the new authorization`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const { orderId, id, placed } = await held(env, { amountCents: 4000 });
    const original = placed.contribution.hold.authorizationId;
    const honor = Date.parse(placed.contribution.hold.honorUntil);
    await assert.rejects(env.service.extendHold(decision(id)), { code: 'too_soon' });
    setNow(env, honor - DAY / 2); // the guarantee's last day
    assert.deepEqual(pick(view(env, id).hold, ['phase', 'canExtend']), { phase: 'ending', canExtend: false });
    await assert.rejects(env.service.extendHold(decision(id)), { code: 'too_soon' });
    setNow(env, honor + 60_000);
    assert.deepEqual(pick(view(env, id).hold, ['phase', 'canExtend']), { phase: 'unguaranteed', canExtend: true });
    for (const [overrides, code] of [[{ approverId: 'm_wren' }, 'adult_approval_required'], [{ householdId: 'hh_other' }, 'order_mismatch'], [{ approvalConfirmed: false }, 'approval_required'], [{ contributionId: 'ctb_not_ours' }, 'unknown_hold']]) {
      await assert.rejects(env.service.extendHold(decision(id, overrides)), { code });
    }
    assert.equal(paths(env, '/reauthorize').length, 0, 'every refusal came before PayPal was asked');

    const first = decision(id);
    const extended = await env.service.extendHold(first);
    assert.equal(extended.outcome, 'extended');
    const [request] = paths(env, '/reauthorize');
    assert.equal(request.pathname, `/v2/payments/authorizations/${original}/reauthorize`);
    assert.deepEqual(request.body, { amount: { currency_code: 'USD', value: '40.00' } }, 'exactly the amount held, never more');
    assert.match(request.headers['paypal-request-id'], /^extend-ctb_\w+-1$/);
    const hold = extended.contribution.hold;
    assert.notEqual(hold.authorizationId, original);
    assert.deepEqual(pick(hold, ['status', 'originalAuthorizationId', 'phase', 'canExtend', 'expiresAt', 'pending']),
      { status: 'held', originalAuthorizationId: original, phase: 'guaranteed', canExtend: false, expiresAt: '2026-12-02T12:00:00Z', pending: null });
    assert.equal(Date.parse(hold.honorUntil), env.clock.now().getTime() + 3 * DAY, 'a new three-day guarantee, inside the original 29 days');
    assert.deepEqual(trail(extended), [['held', 4000], ['extended', null]]);
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000, 'an extension is not progress');
    assert.deepEqual(ledger(env), []);
    // Asked again: answered from the record. A second extension is refused. PayPal was asked once.
    assert.equal((await env.service.extendHold(first)).outcome, 'extended');
    setNow(env, Date.parse(hold.honorUntil) + 60_000);
    await assert.rejects(env.service.extendHold(decision(id)), { code: 'already_extended' });
    assert.equal(paths(env, '/reauthorize').length, 1);
    // A release captures from the authorization that now holds the money.
    const released = await env.service.releaseHold(decision(id, { amountCents: 2500 }));
    assert.equal(released.outcome, 'completed');
    assert.equal(paths(env, '/capture')[0].pathname, `/v2/payments/authorizations/${hold.authorizationId}/capture`);
    assert.match(paths(env, '/capture')[0].headers['paypal-request-id'], /^release-ctb_[0-9a-f]+-2500-extended$/, 'a different authorization is a different request');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 8500);
    assert.deepEqual(trail(released), [['held', 4000], ['extended', null], ['released', 2500], ['returned', 1500]]);
    const checked = await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...OWNER });
    assert.equal(checked.outcome, 'already_completed');
    assert.equal(checked.check.verdict, 'match');
  });

  test(`[${adapter}] an extended hold is returned through its original authorization, as PayPal requires; earlier news about that one changes nothing`, async () => {
    for (const orderListsReauthorizations of [true, false]) {
      const label = `order details list the extension: ${orderListsReauthorizations}`;
      const env = setupDomain({ adapter, mode: 'sandbox', paypalOptions: { orderListsReauthorizations } });
      const { orderId, id, placed } = await held(env);
      const original = placed.contribution.hold.authorizationId;
      setNow(env, Date.parse(placed.contribution.hold.honorUntil) + 60_000);
      const { contribution: { hold } } = await env.service.extendHold(decision(id));
      const event = { id: `WH-REPLACED-${orderListsReauthorizations}`, event_type: 'PAYMENT.AUTHORIZATION.VOIDED',
        resource: { id: original, status: 'VOIDED', amount: { currency_code: 'USD', value: '15.00' }, custom_id: id, supplementary_data: { related_ids: { order_id: orderId } } } };
      assert.equal((await env.service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify(event) })).outcome, 'superseded', label);
      assert.equal(holdRow(env, id).status, 'held', label);
      // An explicit check reads the authorization that holds the money, even when the order's details leave it out.
      const checked = await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...OWNER });
      assert.equal(checked.outcome, 'held', label);
      assert.equal(checked.check.verdict, 'match', label);
      assert.equal(env.fake.requests.some((r) => r.method === 'GET' && r.pathname === `/v2/payments/authorizations/${hold.authorizationId}`), !orderListsReauthorizations, label);
      const returned = await env.service.returnHold(decision(id));
      assert.equal(returned.outcome, 'returned', label);
      // PayPal refuses to void a reauthorization (the fake answers CANNOT_BE_VOIDED): the one void names the parent.
      assert.deepEqual(paths(env, '/void').map((r) => r.pathname), [`/v2/payments/authorizations/${original}/void`], label);
      assert.equal((await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...OWNER })).outcome, 'returned', label);
      assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000, label);
      assert.deepEqual(ledger(env), [], label);
    }
  });

  test(`[${adapter}] an extension PayPal did not answer is never guessed: a check adopts PayPal's answer, or asking again sends the very same request`, async () => {
    // (a) An explicit check finds the extension PayPal made.
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const { orderId, id, placed } = await held(env);
    setNow(env, Date.parse(placed.contribution.hold.honorUntil) + 60_000);
    const service = await losingFirstAnswer(env, '/reauthorize', 'reauthorizePayment');
    const unknown = await service.extendHold(decision(id));
    assert.equal(unknown.outcome, 'unknown');
    assert.deepEqual(pick(unknown.contribution.hold, ['pending', 'authorizationId', 'extendedAt', 'canExtend']),
      { pending: 'extend', authorizationId: placed.contribution.hold.authorizationId, extendedAt: null, canExtend: false }, 'nothing is adopted on a guess');
    assert.deepEqual(trail(unknown), [['held', 1500], ['extending', null]]);
    await assert.rejects(service.releaseHold(decision(id, { amountCents: 1500 })), { code: 'hold_in_progress' });
    await assert.rejects(service.returnHold(decision(id)), { code: 'hold_in_progress' });
    const checked = await service.refreshPayPalOrder({ providerOrderId: orderId, ...OWNER });
    assert.equal(checked.outcome, 'extended');
    assert.notEqual(checked.contribution.hold.authorizationId, placed.contribution.hold.authorizationId);
    assert.equal(paths(env, '/reauthorize').length, 1);

    // (b) The order's details leave the extension out: asking again goes to PayPal as the same request, adopted once.
    const other = setupDomain({ adapter, mode: 'sandbox', paypalOptions: { orderListsReauthorizations: false } });
    const second = await held(other);
    setNow(other, Date.parse(second.placed.contribution.hold.honorUntil) + 60_000);
    const lossy = await losingFirstAnswer(other, '/reauthorize', 'reauthorizePayment');
    assert.equal((await lossy.extendHold(decision(second.id))).outcome, 'unknown');
    assert.equal((await lossy.refreshPayPalOrder({ providerOrderId: second.orderId, ...OWNER })).contribution.hold.pending, 'extend', 'still unknown: nothing to go on');
    const again = await lossy.extendHold(decision(second.id)); // a new press, with a new request id
    assert.equal(again.outcome, 'extended');
    const sent = paths(other, '/reauthorize');
    assert.equal(sent.length, 2);
    assert.equal(sent[0].headers['paypal-request-id'], sent[1].headers['paypal-request-id'], 'the same PayPal request both times');
    assert.equal(again.contribution.hold.pending, null);
    await assert.rejects(lossy.extendHold(decision(second.id)), { code: 'already_extended' });
  });

  test(`[${adapter}] an extension PayPal refuses, or answers for a different amount, leaves the original hold in place`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox', paypalOptions: { reauthorizeError: { status: 422, issue: 'REAUTHORIZATION_NOT_ALLOWED' } } });
    const { id, placed } = await held(env, { amountCents: 4000 });
    const original = placed.contribution.hold.authorizationId;
    setNow(env, Date.parse(placed.contribution.hold.honorUntil) + 60_000);
    await assert.rejects(env.service.extendHold(decision(id)), { code: 'paypal_error' });
    assert.deepEqual(pick(view(env, id).hold, ['status', 'authorizationId', 'extendedAt', 'pending', 'canExtend']), { status: 'held', authorizationId: original, extendedAt: null, pending: null, canExtend: true });
    env.fake.behavior.reauthorizeError = null;
    // An answer for more than the adult approved, in another currency, or for another contribution is never used.
    for (const [option, value] of [['reauthorizationAmountOverride', '46.00'], ['reauthorizationCurrencyOverride', 'EUR'], ['reauthorizationCustomIdOverride', 'ctb_someone_else']]) {
      env.fake.behavior[option] = value;
      const mismatch = await env.service.extendHold(decision(id));
      env.fake.behavior[option] = null;
      assert.equal(mismatch.outcome, 'rejected_mismatch', option);
      assert.deepEqual(pick(mismatch.contribution.hold, ['status', 'authorizationId', 'extendedAt', 'pending']), { status: 'held', authorizationId: original, extendedAt: null, pending: null }, option);
    }
    // The hold still works from its original authorization.
    const released = await env.service.releaseHold(decision(id, { amountCents: 4000 }));
    assert.equal(released.outcome, 'completed');
    assert.equal(paths(env, '/capture')[0].pathname, `/v2/payments/authorizations/${original}/capture`);
    // One PayPal reports expired ends instead.
    const other = setupDomain({ adapter, mode: 'sandbox', paypalOptions: { reauthorizeError: { status: 422, issue: 'AUTHORIZATION_EXPIRED' } } });
    const second = await held(other);
    setNow(other, Date.parse(second.placed.contribution.hold.honorUntil) + 60_000);
    assert.equal((await other.service.extendHold(decision(second.id))).outcome, 'lapsed');
    assert.equal(holdRow(other, second.id).status, 'lapsed');
  });

  test(`[${adapter}] an extension answer this server refused is never adopted later, and news about it never ends the hold`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox', paypalOptions: { reauthorizationAmountOverride: '46.00' } });
    const { orderId, id, placed } = await held(env, { amountCents: 4000 });
    setNow(env, Date.parse(placed.contribution.hold.honorUntil) + 60_000);
    assert.equal((await env.service.extendHold(decision(id))).outcome, 'rejected_mismatch');
    const refused = env.fake.orders.get(orderId).purchase_units[0].payments.authorizations.at(-1);
    const event = { id: 'WH-REFUSED-LATE', event_type: 'PAYMENT.AUTHORIZATION.CREATED', resource: { ...refused, supplementary_data: { related_ids: { order_id: orderId } } } };
    assert.equal((await env.service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify(event) })).outcome, 'superseded');
    assert.deepEqual(pick(view(env, id).hold, ['status', 'authorizationId']), { status: 'held', authorizationId: placed.contribution.hold.authorizationId });
    // A later extension whose answer is lost, while PayPal's order details list only the answer already refused: a check
    // does not take that one for the new answer, and asking again adopts the new one.
    env.fake.behavior.reauthorizationAmountOverride = null;
    env.fake.behavior.orderListsReauthorizations = false;
    const lossy = await losingFirstAnswer(env, '/reauthorize', 'reauthorizePayment');
    assert.equal((await lossy.extendHold(decision(id))).outcome, 'unknown');
    const still = await lossy.refreshPayPalOrder({ providerOrderId: orderId, ...OWNER });
    assert.equal(still.contribution.hold.pending, 'extend', 'the refused answer is not mistaken for the new one');
    const again = await lossy.extendHold(decision(id));
    assert.equal(again.outcome, 'extended');
    assert.notEqual(again.contribution.hold.authorizationId, refused.id);
    assert.equal(again.contribution.hold.originalAuthorizationId, placed.contribution.hold.authorizationId);
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000);
  });

  test(`[${adapter}] an extension never outlasts the hold's 29 days, is refused after them, and is refused once part was released`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const { id, placed } = await held(env);
    const expires = Date.parse(placed.contribution.hold.expiresAt);
    setNow(env, expires - DAY); // a day before the authorization expires: the new guarantee is cut short
    const late = await env.service.extendHold(decision(id));
    assert.equal(late.outcome, 'extended');
    assert.equal(Date.parse(late.contribution.hold.honorUntil), expires);
    const after = await held(env);
    setNow(env, expires + 60_000);
    assert.equal(view(env, after.id).hold.phase, 'expired');
    await assert.rejects(env.service.extendHold(decision(after.id)), { code: 'hold_expired' });

    const other = setupDomain({ adapter, mode: 'sandbox' });
    const partly = await held(other, { amountCents: 4000 });
    await other.service.releaseHold(decision(partly.id, { amountCents: 1000, keepRest: true }));
    setNow(other, Date.parse(partly.placed.contribution.hold.honorUntil) + 60_000);
    assert.equal(view(other, partly.id).hold.canExtend, false);
    await assert.rejects(other.service.extendHold(decision(partly.id)), { code: 'partly_released' });
    assert.equal(paths(other, '/reauthorize').length, 0);
  });

  // ---- Releasing a hold in steps ----

  test(`[${adapter}] a hold can be released in up to three steps: the rest stays held until a final release, and each step counts once`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const { orderId, id } = await held(env, { amountCents: 4000 });
    const first = decision(id, { amountCents: 1000, keepRest: true });
    const one = await env.service.releaseHold(first);
    assert.equal(one.outcome, 'completed');
    assert.deepEqual(paths(env, '/capture')[0].body, { amount: { currency_code: 'USD', value: '10.00' }, final_capture: false });
    assert.equal(one.progress.progressCents, 7000);
    assert.equal(one.contribution.status, 'completed', 'the released part counts');
    assert.deepEqual(pick(one.contribution.hold, ['status', 'releasedCents', 'remainingCents', 'releasesLeft']), { status: 'held', releasedCents: 1000, remainingCents: 3000, releasesLeft: 2 });
    assert.match(one.contribution.statusDetail, /Released \$10\.00 of \$40\.00; \$30\.00 is still held/);
    assert.deepEqual(trail(one), [['held', 4000], ['released', 1000], ['still_held', 3000]]);
    // A capture that no adult is releasing right now is never counted, even for the same amount as the last release.
    const stray = { id: 'WH-STEP-STRAY', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAPTURE-STEP-STRAY', status: 'COMPLETED', amount: { currency_code: 'USD', value: '10.00' }, custom_id: id, supplementary_data: { related_ids: { order_id: orderId } } } };
    assert.equal((await env.service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify(stray) })).outcome, 'rejected_mismatch');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 7000);
    // Asked again: answered from the record. A refund waits until the hold is over.
    assert.equal((await env.service.releaseHold(first)).outcome, 'already_completed');
    await assert.rejects(env.service.refundPayPalCapture({ captureId: one.contribution.captures[0].captureId, householdId: DEMO_HOUSEHOLD_ID, approverId: 'm_rowan', approvalConfirmed: true }), { code: 'hold_open' });
    await assert.rejects(env.service.releaseHold(decision(id, { amountCents: 3001 })), { code: 'invalid_amount' }, 'never more than is still held');
    await assert.rejects(env.service.releaseHold(decision(id, { amountCents: 2950, keepRest: true })), { code: 'invalid_amount' }, 'what is kept must still be releasable');
    const two = await env.service.releaseHold(decision(id, { amountCents: 1500, keepRest: true }));
    assert.equal(two.progress.progressCents, 8500);
    assert.equal(two.contribution.hold.releasesLeft, 1);
    await assert.rejects(env.service.releaseHold(decision(id, { amountCents: 1000, keepRest: true })), { code: 'last_release' });
    const last = await env.service.releaseHold(decision(id, { amountCents: 1000 }));
    assert.equal(last.outcome, 'completed');
    assert.deepEqual(paths(env, '/capture').map((r) => r.body.final_capture), [false, false, true]);
    // Each step is its own PayPal request: its amount, what was released before it, and whether it keeps the rest.
    assert.deepEqual(paths(env, '/capture').map((r) => r.headers['paypal-request-id'].replace(/^release-ctb_[0-9a-f]+/, '')), ['-1000-keep', '-1500-after-1000-keep', '-1000-after-2500']);
    assert.equal(paths(env, '/capture').length, 3, 'the refusals and the replay never reached PayPal');
    assert.equal(last.progress.progressCents, 9500);
    assert.equal(last.contribution.hold.status, 'released');
    assert.deepEqual(trail(last), [['held', 4000], ['released', 1000], ['released', 1500], ['released', 1000], ['returned', 500]]);
    assert.deepEqual(ledger(env), [1000, 1500, 1000].map((amount_cents) => ({ kind: 'contribution', effect: 1, amount_cents })));
    await assert.rejects(env.service.releaseHold(decision(id, { amountCents: 500 })), { code: 'hold_decided' });
    // An explicit check agrees on every step and counts nothing again.
    const checked = await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...OWNER });
    assert.equal(checked.outcome, 'already_completed');
    assert.equal(checked.check.verdict, 'match');
    assert.match(checked.check.note, /all 3 releases/);
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 9500);
    // Once the hold is over, each released part can be refunded on its own.
    const refunded = await env.service.refundPayPalCapture({ captureId: last.contribution.captures[1].captureId, householdId: DEMO_HOUSEHOLD_ID, approverId: 'm_rowan', approvalConfirmed: true });
    assert.equal(refunded.outcome, 'refunded');
    assert.equal(refunded.contribution.status, 'partially_refunded');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 8000);
  });

  test(`[${adapter}] what is still held can be returned after a partial release; the released part stays counted`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const { orderId, id } = await held(env, { amountCents: 4000 });
    await env.service.releaseHold(decision(id, { amountCents: 2500, keepRest: true }));
    const returned = await env.service.returnHold(decision(id));
    assert.equal(returned.outcome, 'returned');
    assert.equal(paths(env, '/void').length, 1);
    assert.equal(returned.contribution.status, 'completed', 'the released part still counts');
    assert.equal(returned.contribution.hold.status, 'returned');
    assert.match(returned.contribution.statusDetail, /\$25\.00 was released; the other \$15\.00 was returned/);
    assert.deepEqual(trail(returned), [['held', 4000], ['released', 2500], ['returned', 1500]]);
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 8500);
    const checked = await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...OWNER });
    assert.equal(checked.outcome, 'returned');
    assert.equal(checked.check.verdict, 'match');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 8500);
  });

  test(`[${adapter}] a later release PayPal did not answer is never guessed: a check counts it once, or reopens the hold`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const { orderId, id } = await held(env, { amountCents: 4000 });
    await env.service.releaseHold(decision(id, { amountCents: 1000, keepRest: true }));
    const service = await losingFirstAnswer(env, '/capture', 'captureAuthorizedPayment');
    const unknown = await service.releaseHold(decision(id, { amountCents: 1500, keepRest: true }));
    assert.equal(unknown.outcome, 'unknown');
    assert.equal(unknown.contribution.hold.pending, 'release');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 7000, 'nothing more is counted on an unknown outcome');
    await assert.rejects(service.returnHold(decision(id)), { code: 'hold_in_progress' });
    const settled = await service.refreshPayPalOrder({ providerOrderId: orderId, ...OWNER });
    assert.equal(settled.outcome, 'completed');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 8500);
    assert.deepEqual(pick(settled.contribution.hold, ['status', 'releasedCents', 'pending']), { status: 'held', releasedCents: 2500, pending: null });
    assert.equal((await service.refreshPayPalOrder({ providerOrderId: orderId, ...OWNER })).outcome, 'held');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 8500, 'counted exactly once');

    // PayPal did not capture: an explicit check finds every listed capture counted and the rest still held.
    const other = setupDomain({ adapter, mode: 'sandbox' });
    const second = await held(other, { amountCents: 4000 });
    await other.service.releaseHold(decision(second.id, { amountCents: 1000, keepRest: true }));
    other.fake.behavior.releaseError = { status: 503, issue: 'INTERNAL_SERVER_ERROR' };
    assert.equal((await other.service.releaseHold(decision(second.id, { amountCents: 1500, keepRest: true }))).outcome, 'unknown');
    other.fake.behavior.releaseError = null;
    const reopened = await other.service.refreshPayPalOrder({ providerOrderId: second.orderId, ...OWNER });
    assert.equal(reopened.outcome, 'held');
    assert.deepEqual(pick(reopened.contribution.hold, ['status', 'releaseCents', 'releasedCents', 'pending']), { status: 'held', releaseCents: 1000, releasedCents: 1000, pending: null });
    assert.equal((await other.service.returnHold(decision(second.id))).outcome, 'returned');
    assert.equal(progressFor(other.db, DEMO_GOAL_ID).progressCents, 7000);
  });

  test(`[${adapter}] a release decided again after an unanswered attempt is the same PayPal request, so it can never capture twice`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const { orderId, id } = await held(env, { amountCents: 4000 });
    await env.service.releaseHold(decision(id, { amountCents: 1000, keepRest: true }));
    // PayPal captures the second release, but its answer is lost and the next read of the order does not show it yet.
    const service = await losingFirstAnswer(env, '/capture', 'captureAuthorizedPayment');
    assert.equal((await service.releaseHold(decision(id, { amountCents: 1500, keepRest: true }))).outcome, 'unknown');
    env.fake.behavior.staleOrderReads = 1;
    const reopened = await service.refreshPayPalOrder({ providerOrderId: orderId, ...OWNER });
    assert.equal(reopened.outcome, 'held', 'the read showed nothing new, so an adult may decide again');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 7000);
    // The adult decides the same release again: a new request to this server, the very same request to PayPal.
    const again = await service.releaseHold(decision(id, { amountCents: 1500, keepRest: true }));
    assert.equal(again.outcome, 'completed');
    const sent = paths(env, '/capture').map((r) => r.headers['paypal-request-id']);
    assert.equal(sent.length, 3);
    assert.equal(sent[1], sent[2], 'the new attempt is the same PayPal request as the unanswered one');
    assert.notEqual(sent[0], sent[1]);
    assert.equal(env.fake.orders.get(orderId).purchase_units[0].payments.captures.length, 2, 'PayPal captured the second release once');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 8500, 'and it is counted once');
    assert.deepEqual(ledger(env), [1000, 1500].map((amount_cents) => ({ kind: 'contribution', effect: 1, amount_cents })));
    assert.deepEqual(pick(again.contribution.hold, ['status', 'releasedCents', 'pending']), { status: 'held', releasedCents: 2500, pending: null });
    const checked = await service.refreshPayPalOrder({ providerOrderId: orderId, ...OWNER });
    assert.equal(checked.check.verdict, 'match');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 8500);
  });

  test(`[${adapter}] a later release that PayPal declined, its answer lost, reopens the hold on a check and is never counted`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const { orderId, id } = await held(env, { amountCents: 4000 });
    await env.service.releaseHold(decision(id, { amountCents: 1000, keepRest: true }));
    const service = await losingFirstAnswer(env, '/capture', 'captureAuthorizedPayment');
    env.fake.behavior.captureStatus = 'DECLINED';
    assert.equal((await service.releaseHold(decision(id, { amountCents: 1500, keepRest: true }))).outcome, 'unknown');
    env.fake.behavior.captureStatus = 'COMPLETED';
    await assert.rejects(service.returnHold(decision(id)), { code: 'hold_in_progress' });
    const checked = await service.refreshPayPalOrder({ providerOrderId: orderId, ...OWNER });
    assert.equal(checked.outcome, 'held');
    assert.deepEqual(pick(checked.contribution.hold, ['status', 'releasedCents', 'remainingCents', 'pending']), { status: 'held', releasedCents: 1000, remainingCents: 3000, pending: null });
    assert.equal(checked.check.verdict, 'match');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 7000, 'a declined capture is never counted');
    assert.deepEqual(ledger(env), [{ kind: 'contribution', effect: 1, amount_cents: 1000 }]);
    assert.equal((await service.returnHold(decision(id))).outcome, 'returned');
  });

  test(`[${adapter}] a capture PayPal declined stays on its order without reading as a difference, or as news about a later release`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const { orderId, id } = await held(env, { amountCents: 4000 });
    env.fake.behavior.captureStatus = 'DECLINED';
    assert.equal((await env.service.releaseHold(decision(id, { amountCents: 1500, keepRest: true }))).outcome, 'declined');
    env.fake.behavior.captureStatus = 'COMPLETED';
    // PayPal took nothing and the ledger counted nothing: a check says the two agree, and the hold is simply held.
    const checked = await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...OWNER });
    assert.equal(checked.outcome, 'held');
    assert.deepEqual([checked.check.verdict, checked.check.note], ['match', 'Held in PayPal, and not counted in the ledger. A capture that PayPal declined took nothing.']);
    assert.equal(checked.contribution.status, 'held');
    // Another release waits for PayPal when a late delivery about the declined capture arrives: it changes nothing.
    env.fake.behavior.releaseError = { status: 503, issue: 'INTERNAL_SERVER_ERROR' };
    assert.equal((await env.service.releaseHold(decision(id, { amountCents: 1000, keepRest: true }))).outcome, 'unknown');
    env.fake.behavior.releaseError = null;
    const before = view(env, id);
    const declined = env.fake.orders.get(orderId).purchase_units[0].payments.captures[0];
    const event = { id: `WH-DECLINED-AGAIN-${adapter}`, event_type: 'PAYMENT.CAPTURE.DECLINED', resource: { ...declined, supplementary_data: { related_ids: { order_id: orderId } } } };
    assert.equal((await env.service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify(event) })).outcome, 'declined');
    assert.deepEqual(pick(view(env, id), ['status', 'statusDetail']), pick(before, ['status', 'statusDetail']), 'not marked as rejected');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000);
  });

  test(`[${adapter}] a capture nobody released here is saved by a check as a difference, not as a reason to check again`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox' });
    const { orderId, id } = await held(env, { amountCents: 4000 });
    await env.service.releaseHold(decision(id, { amountCents: 1000, keepRest: true }));
    env.fake.orders.get(orderId).purchase_units[0].payments.captures.push({ id: 'STRAYCAPTURE0003', status: 'COMPLETED', amount: { currency_code: 'USD', value: '7.00' }, custom_id: id });
    const checked = await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...OWNER });
    assert.equal(checked.outcome, 'rejected_mismatch');
    assert.equal(checked.check.verdict, 'differs');
    assert.match(checked.check.note, /this check could not count/);
    assert.doesNotMatch(checked.check.note, /Use “Check with PayPal”/);
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 7000);
  });

  test(`[${adapter}] while an extension is unanswered, news that the old authorization ended is not acted on; the extension's own answer settles it`, async () => {
    const env = setupDomain({ adapter, mode: 'sandbox', paypalOptions: { orderListsReauthorizations: false } });
    const { orderId, id, placed } = await held(env);
    const original = placed.contribution.hold.authorizationId;
    setNow(env, Date.parse(placed.contribution.hold.honorUntil) + 60_000);
    const service = await losingFirstAnswer(env, '/reauthorize', 'reauthorizePayment');
    assert.equal((await service.extendHold(decision(id))).outcome, 'unknown');
    // PayPal now shows the original authorization as ended, and its order details do not list the new one.
    env.fake.orders.get(orderId).purchase_units[0].payments.authorizations[0].status = 'VOIDED';
    const checked = await service.refreshPayPalOrder({ providerOrderId: orderId, ...OWNER });
    assert.equal(checked.outcome, 'unknown');
    assert.deepEqual(pick(checked.contribution.hold, ['status', 'pending', 'authorizationId']), { status: 'held', pending: 'extend', authorizationId: original }, 'the hold is not ended on a guess');
    const event = { id: `WH-OLD-ENDED-${adapter}`, event_type: 'PAYMENT.AUTHORIZATION.VOIDED',
      resource: { id: original, status: 'VOIDED', amount: { currency_code: 'USD', value: '15.00' }, custom_id: id, supplementary_data: { related_ids: { order_id: orderId } } } };
    assert.equal((await service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify(event) })).outcome, 'unknown');
    assert.equal(holdRow(env, id).status, 'held');
    // Asking again is the same request: PayPal answers with the extension it made, and the money can still be released.
    const again = await service.extendHold(decision(id));
    assert.equal(again.outcome, 'extended');
    const released = await service.releaseHold(decision(id, { amountCents: 1500 }));
    assert.equal(released.outcome, 'completed');
    assert.equal(paths(env, '/capture')[0].pathname, `/v2/payments/authorizations/${again.contribution.hold.authorizationId}/capture`);
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 7500);
  });
}

test('the database itself refuses a release larger than what is still held, and a released total larger than the hold', () => {
  const env = setupDomain({ mode: 'example' });
  const { contribution: { id } } = env.service.simulateContribution(contribution({ amountCents: 4000, hold: true }));
  env.db.prepare('UPDATE payment_holds SET released_cents = 2500 WHERE order_id = ?').run(id);
  assert.throws(() => env.db.prepare("UPDATE payment_holds SET status = 'releasing', release_cents = 1501 WHERE order_id = ?").run(id), /CHECK constraint failed/);
  assert.throws(() => env.db.prepare('UPDATE payment_holds SET released_cents = 4001 WHERE order_id = ?').run(id), /CHECK constraint failed/);
  env.db.prepare("UPDATE payment_holds SET status = 'releasing', release_cents = 1500 WHERE order_id = ?").run(id); // exactly what is left
  assert.equal(holdRow(env, id).release_cents, 1500);
});

test('example mode: a simulated hold is released in two steps; another is extended after its simulated three days', async () => {
  const env = setupDomain({ mode: 'example' });
  const placed = env.service.simulateContribution(contribution({ amountCents: 4000, hold: true }));
  const id = placed.contribution.id;
  assert.equal(Date.parse(placed.contribution.hold.honorUntil), env.clock.now().getTime() + 3 * DAY);
  assert.equal(Date.parse(placed.contribution.hold.expiresAt), env.clock.now().getTime() + 29 * DAY);
  const one = await env.service.releaseHold(decision(id, { amountCents: 1000, keepRest: true }));
  assert.equal(one.outcome, 'completed');
  assert.equal(one.contribution.hold.status, 'held');
  const rest = await env.service.releaseHold(decision(id, { amountCents: 3000 }));
  assert.equal(rest.contribution.hold.status, 'released');
  const [a, b] = rest.contribution.captures.map((c) => c.captureId);
  assert.equal(b, `${a}-2`);
  assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 10000);
  const second = env.service.simulateContribution(contribution({ amountCents: 1500, hold: true }));
  await assert.rejects(env.service.extendHold(decision(second.contribution.id)), { code: 'too_soon' });
  setNow(env, Date.parse(second.contribution.hold.honorUntil) + 60_000);
  const extended = await env.service.extendHold(decision(second.contribution.id));
  assert.equal(extended.outcome, 'extended');
  assert.match(extended.contribution.hold.authorizationId, /^SIM-AUTH-/);
  assert.match(extended.contribution.statusDetail, /^Simulated: \$15\.00 is held again/);
  assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 10000);
});

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

test('a schema-18 database keeps every row: holds gain their new columns, a released hold keeps its one release as its total', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'our-castle-hold-lifecycle-'));
  try {
    const file = path.join(dir, 'schema-18.sqlite');
    const step = MIGRATIONS.findIndex((m) => m.id === 'hold-lifecycle');
    assert.deepEqual([step, MIGRATIONS.length], [18, 19], 'extensions and stepped releases are step 19, the last');
    const old = new DatabaseSync(file);
    old.exec('PRAGMA foreign_keys = ON');
    MIGRATIONS.slice(0, step).forEach((m, i) => { if (typeof m === 'string') old.exec(m); else m.ensure(old); old.exec(`PRAGMA user_version = ${i + 1}`); });
    old.exec(`INSERT INTO households (id, name, play_mode, crest_field, crest_charge, is_example, setup_complete, created_at) VALUES ('hh_kept', 'House Kept', 'family', 'cobalt', 'stag', 0, 1, '2026-11-01T00:00:00.000Z');
      INSERT INTO goals (id, household_id, name, target_cents, currency, target_date, weekly_budget_cents, created_at) VALUES ('goal_kept', 'hh_kept', 'Garden', 30000, 'USD', '2026-12-29', 3000, '2026-11-01T00:00:00.000Z');
      INSERT INTO payment_orders (id, provider, provider_order_id, request_id, household_id, goal_id, approved_by, amount_cents, currency, status, created_at, updated_at) VALUES
        ('ctb_kept', 'paypal-sandbox', 'ORDER-KEPT', 'request-kept', 'hh_kept', 'goal_kept', 'm_kept', 1500, 'USD', 'completed', '2026-11-05T00:00:00.000Z', '2026-11-05T00:00:00.000Z'),
        ('ctb_released', 'paypal-sandbox', 'ORDER-RELEASED', 'request-released', 'hh_kept', 'goal_kept', 'm_kept', 4000, 'USD', 'completed', '2026-11-06T00:00:00.000Z', '2026-11-06T00:00:00.000Z'),
        ('ctb_held', 'paypal-sandbox', 'ORDER-HELD', 'request-held', 'hh_kept', 'goal_kept', 'm_kept', 2000, 'USD', 'held', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
      INSERT INTO payment_captures (capture_id, order_id, amount_cents, currency, status, credited, created_at, updated_at) VALUES
        ('CAPTURE-KEPT', 'ctb_kept', 1500, 'USD', 'COMPLETED', 1, '2026-11-05T00:00:00.000Z', '2026-11-05T00:00:00.000Z'),
        ('CAPTURE-RELEASED', 'ctb_released', 2500, 'USD', 'COMPLETED', 1, '2026-11-06T00:00:00.000Z', '2026-11-06T00:00:00.000Z');
      INSERT INTO payment_holds (order_id, authorization_id, status, held_cents, release_cents, decided_by, decision_request_id, expires_at, created_at, updated_at) VALUES
        ('ctb_released', 'AUTH-RELEASED', 'released', 4000, 2500, 'm_kept', 'decision-released', '2026-12-05T00:00:00Z', '2026-11-06T00:00:00.000Z', '2026-11-06T00:00:00.000Z'),
        ('ctb_held', 'AUTH-HELD', 'held', 2000, NULL, NULL, NULL, '2026-12-06T00:00:00Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');`);
    const tables = (d) => d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
    const rows = (d, names) => Object.fromEntries(names.map((t) => [t, d.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map((r) => ({ ...r }))]));
    const beforeTables = tables(old), before = rows(old, beforeTables);
    assert.equal(beforeTables.length, 44);
    old.close();
    const db = openDatabase(file);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 19);
    assert.deepEqual(tables(db).filter((t) => !beforeTables.includes(t)), ['payment_hold_steps']);
    const after = rows(db, beforeTables);
    const added = ['released_cents', 'original_authorization_id', 'honor_until', 'extended_at'];
    const withoutAdded = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !added.includes(k)));
    assert.deepEqual({ ...after, payment_holds: after.payment_holds.map(withoutAdded) }, before, 'every earlier value is unchanged');
    assert.deepEqual(after.payment_holds.map((r) => pick(r, ['order_id', ...added])), [
      { order_id: 'ctb_released', released_cents: 2500, original_authorization_id: null, honor_until: null, extended_at: null },
      { order_id: 'ctb_held', released_cents: 0, original_authorization_id: null, honor_until: null, extended_at: null },
    ], 'an old hold is never given a guarantee time it may not have');
    assert.deepEqual(rows(db, ['payment_hold_steps']).payment_hold_steps, []);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    db.close();
    const again = openDatabase(file);
    assert.equal(again.prepare('PRAGMA user_version').get().user_version, 19);
    again.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a schema-17 database gains only the two hold tables; every earlier row is unchanged', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'our-castle-payment-holds-'));
  try {
    const file = path.join(dir, 'schema-17.sqlite');
    const step = MIGRATIONS.findIndex((m) => m.id === 'payment-holds');
    assert.deepEqual([step, MIGRATIONS.length], [17, 19], 'held contributions are step 18');
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
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 19);
    assert.deepEqual(tables(db).filter((t) => !beforeTables.includes(t)), ['payment_hold_steps', 'payment_holds']);
    assert.deepEqual(rows(db, beforeTables), before, 'every earlier row is unchanged');
    assert.deepEqual(rows(db, ['payment_holds']).payment_holds, [], 'an existing contribution is not turned into a hold');
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    db.close();
    const again = openDatabase(file);
    assert.equal(again.prepare('PRAGMA user_version').get().user_version, 19);
    again.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
