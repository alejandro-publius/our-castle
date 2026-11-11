import { transaction } from '../db.mjs';
import {
  DomainError, awardTierMilestones, getGoal, getHousehold, getMember, newId, progressFor,
} from '../household.mjs';
import { centsToDecimalString, decimalStringToCents, formatCents } from '../../src/core/rules.js';
import { PayPalError } from './paypal-client.mjs';
import { UNCOUNTED_CAPTURE_NOTE, reconcileOrder } from '../steward/index.mjs';

export const MIN_CONTRIBUTION_CENTS = 100;
/** Explicit checks remembered per order. Older ones are dropped. */
const CHECK_HISTORY = 10;
export const MAX_CONTRIBUTION_CENTS = 50_000;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const SETTLED = new Set(['completed', 'refunded', 'partially_refunded']);
const DAY_MS = 86_400_000;
/** PayPal guarantees an authorization's funds for three days (its honor period); an extension starts a new one. */
const HONOR_MS = 3 * DAY_MS;
/** A simulated hold lasts as long as PayPal's authorizations do: 29 days. */
const SIMULATED_HOLD_MS = 29 * DAY_MS;
/** A hold can be released in at most this many steps. The last one is always final. */
export const MAX_RELEASES = 3;
const OPEN_HOLD = new Set(['awaiting', 'held', 'releasing', 'returning']);
/** Capture statuses that mean PayPal took nothing. */
const FAILED_CAPTURE = new Set(['DECLINED', 'DENIED', 'FAILED']);
const validTime = (value) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null);
const dayText = (iso) => new Date(iso).toISOString().slice(0, 10);
/** Three days from `from`, but never past the authorization's own expiry. */
function honorEnd(from, expiresAt) {
  const end = Date.parse(from) + HONOR_MS;
  const expires = Date.parse(expiresAt ?? '');
  return new Date(Number.isFinite(expires) ? Math.min(end, expires) : end).toISOString();
}

const LEDGER = {
  'paypal-sandbox': { contribution: 'contribution', refund: 'refund', source: 'paypal-sandbox', prefix: 'paypal' },
  simulated: { contribution: 'simulated_contribution', refund: 'simulated_refund', source: 'simulated', prefix: 'simulated' },
};

/**
 * Turns adult-approved payments into goal progress. The server owns the expected amount, currency,
 * household and goal for every order; the browser can only ask the server to check with PayPal.
 * Progress is credited once per provider capture id, inside one transaction with its milestones.
 */
export function createContributionService({ db, clock, mode, paypal = null, webhookId = null }) {
  const inflight = new Map();

  const orderById = (id) => db.prepare('SELECT * FROM payment_orders WHERE id = ?').get(id);
  const orderByProviderId = (id) => db.prepare('SELECT * FROM payment_orders WHERE provider_order_id = ?').get(id);
  const orderByRequestId = (id) => db.prepare('SELECT * FROM payment_orders WHERE request_id = ?').get(id);
  // The retry lookup for a new contribution. A missing or non-text request id is refused before SQLite is asked to
  // bind it, with the same answer as the format check in validateRequest.
  const priorRequest = (requestId) => {
    if (typeof requestId !== 'string') throw new DomainError(400, 'invalid_request_id', 'Missing request id.');
    return orderByRequestId(requestId);
  };
  const captureById = (id) => db.prepare('SELECT * FROM payment_captures WHERE capture_id = ?').get(id);
  // A held contribution: PayPal authorized the adult-approved amount and nothing is credited. It ends in exactly one of
  // two adult decisions, each recorded before PayPal is asked: release an exact amount (one final capture, credited
  // like any other capture) or return it (a void, never credited).
  const holdFor = (orderId) => db.prepare('SELECT * FROM payment_holds WHERE order_id = ?').get(orderId);
  const setHold = (orderId, status) => db.prepare('UPDATE payment_holds SET status = ?, updated_at = ? WHERE order_id = ?').run(status, clock.iso(), orderId);
  // Every adult decision on a hold, in order. At most one at a time waits for PayPal ('sent').
  const stepsFor = (orderId) => db.prepare('SELECT * FROM payment_hold_steps WHERE order_id = ? ORDER BY seq').all(orderId);
  const openStep = (orderId) => db.prepare("SELECT * FROM payment_hold_steps WHERE order_id = ? AND state = 'sent'").get(orderId);
  const markStep = (step, state, providerRef = null) => db.prepare('UPDATE payment_hold_steps SET state = ?, provider_ref = COALESCE(?, provider_ref), updated_at = ? WHERE id = ?')
    .run(state, providerRef, clock.iso(), step.id);
  const failOpenStep = (orderId) => { const step = openStep(orderId); if (step) markStep(step, 'failed'); };
  /**
   * What an uncounted capture of this order must be for: on a hold, the release an adult is confirming right now (a hold
   * with no release under way expects no capture at all); otherwise the order's own amount.
   */
  const expectedCaptureCents = (row) => { const hold = holdFor(row.id); return hold ? (hold.status === 'releasing' ? hold.release_cents : null) : row.amount_cents; };

  /** The hold as the page sees it, including where it stands in PayPal's honor period and its money trail. */
  function holdView(row, hold) {
    const open = openStep(row.id);
    const pending = open?.kind ?? (hold.status === 'releasing' ? 'release' : hold.status === 'returning' ? 'return' : null);
    const now = clock.now().getTime();
    const honor = Date.parse(hold.honor_until ?? '');
    const expires = Date.parse(hold.expires_at ?? '');
    // guaranteed → ending (its last day) → unguaranteed (PayPal may still capture, but no longer promises) → expired.
    const phase = Number.isFinite(expires) && now >= expires ? 'expired'
      : !Number.isFinite(honor) ? 'unknown'
        : now < honor - DAY_MS ? 'guaranteed' : now < honor ? 'ending' : 'unguaranteed';
    const releases = stepsFor(row.id).filter((s) => s.kind === 'release' && s.state === 'done').length;
    const remainingCents = hold.held_cents - hold.released_cents;
    const decidable = hold.status === 'held' && !pending;
    return {
      status: hold.status, heldCents: hold.held_cents, releaseCents: hold.release_cents, releasedCents: hold.released_cents, remainingCents,
      authorizationId: hold.authorization_id, originalAuthorizationId: hold.original_authorization_id, decidedBy: hold.decided_by,
      expiresAt: hold.expires_at, honorUntil: hold.honor_until, extendedAt: hold.extended_at, phase, pending,
      releasesLeft: decidable ? Math.max(0, MAX_RELEASES - releases) : 0,
      canExtend: decidable && !hold.extended_at && hold.released_cents === 0 && phase === 'unguaranteed',
      trail: holdTrail(row, hold, pending),
    };
  }

  /** Held $40 → Released $25 → Returned $15, from saved records only: the hold, its counted captures and its status. */
  function holdTrail(row, hold, pending) {
    const trail = [{ step: 'held', cents: hold.held_cents }];
    if (hold.extended_at) trail.push({ step: 'extended', at: hold.extended_at });
    for (const c of db.prepare('SELECT amount_cents, created_at FROM payment_captures WHERE order_id = ? AND credited = 1 ORDER BY created_at, rowid').all(row.id)) {
      trail.push({ step: 'released', cents: c.amount_cents, at: c.created_at });
    }
    const rest = hold.held_cents - hold.released_cents;
    if (pending === 'release') trail.push({ step: 'releasing', cents: hold.release_cents });
    else if (pending === 'return') trail.push({ step: 'returning', cents: rest });
    else if (pending === 'extend') trail.push({ step: 'extending' });
    // A final release gives back whatever it did not take, as a return does.
    else if (rest > 0 && ['released', 'returned'].includes(hold.status)) trail.push({ step: 'returned', cents: rest });
    else if (rest > 0 && hold.status === 'lapsed') trail.push({ step: 'expired', cents: rest });
    else if (rest > 0 && hold.status === 'held' && hold.released_cents > 0) trail.push({ step: 'still_held', cents: rest });
    return trail;
  }

  function requireMode(expected) {
    if (mode !== expected) {
      throw new DomainError(409, 'wrong_mode', expected === 'sandbox'
        ? 'PayPal sandbox credentials are not configured; this server is in example mode.'
        : 'Simulated payments are disabled while real PayPal sandbox mode is active.');
    }
  }

  function setStatus(row, status, detail = null) {
    db.prepare('UPDATE payment_orders SET status = ?, status_detail = ?, updated_at = ? WHERE id = ?').run(status, detail, clock.iso(), row.id);
  }

  function upsertCapture(row, captureId, amountCents, currency, status) {
    const existing = captureById(captureId);
    if (existing && existing.order_id !== row.id) throw new DomainError(409, 'capture_conflict', 'That capture belongs to a different contribution.');
    const at = clock.iso();
    if (existing) db.prepare('UPDATE payment_captures SET status = ?, updated_at = ? WHERE capture_id = ? AND credited = 0').run(status, at, captureId);
    else {
      db.prepare(`INSERT INTO payment_captures (capture_id, order_id, amount_cents, currency, status, credited, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?)`).run(captureId, row.id, amountCents, currency, status, at, at);
    }
    adoptDeferredRefunds(captureId);
  }

  function view(orderId) {
    const row = orderById(orderId);
    if (!row) return null;
    const captures = db.prepare('SELECT * FROM payment_captures WHERE order_id = ? ORDER BY created_at').all(row.id).map((c) => ({
      captureId: c.capture_id,
      amountCents: c.amount_cents,
      currency: c.currency,
      status: c.status,
      credited: Boolean(c.credited),
      refundedCents: c.refunded_cents,
      refunds: db.prepare('SELECT * FROM payment_refunds WHERE capture_id = ? ORDER BY created_at').all(c.capture_id).map((r) => ({
        refundId: r.refund_id, amountCents: r.amount_cents, currency: r.currency, status: r.status, credited: Boolean(r.credited), createdAt: r.created_at,
      })),
    }));
    const checks = checksFor(row.id);
    const hold = holdFor(row.id);
    return {
      // Present only on a held contribution, so every other receipt keeps its exact shape.
      ...(hold ? { hold: holdView(row, hold) } : {}),
      id: row.id,
      provider: row.provider,
      simulated: row.provider === 'simulated',
      providerOrderId: row.provider_order_id,
      householdId: row.household_id,
      goalId: row.goal_id,
      approvedBy: row.approved_by,
      amountCents: row.amount_cents,
      currency: row.currency,
      status: row.status,
      statusDetail: row.status_detail,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      captures,
      checks,
      lastCheck: checks[0] ?? null,
    };
  }

  const checkView = (c) => ({
    checkedAt: c.checked_at, verdict: c.verdict, outcome: c.outcome, note: c.note, paypalOrderStatus: c.paypal_order_status,
    captureId: c.capture_id, captureStatus: c.capture_status, amountCents: c.amount_cents, currency: c.currency,
    refundIds: c.refund_ids ? c.refund_ids.split(',') : [],
  });
  /** Explicit "Check with PayPal" results for one order, newest first. */
  function checksFor(orderId) {
    return db.prepare('SELECT * FROM order_checks WHERE order_id = ? ORDER BY id DESC').all(orderId).map(checkView);
  }

  /**
   * Remember what an explicit check found. The verdict comes from the validated PayPal order and the server's own
   * reconciliation against the (already updated) ledger record, never from a model answer or the browser. When PayPal
   * did not answer, the check is remembered as unavailable. Only references and amounts are stored.
   */
  function recordCheck(row, { order = null, outcome, failure = null }) {
    const current = view(row.id);
    let reconciliation = order ? reconcileOrder(order, current)
      : { verdict: 'unavailable', note: failure ?? 'PayPal did not return this order.', paypalOrderStatus: null, paypalCaptureId: null, paypalCaptureStatus: null, paypalAmountCents: null };
    // That note asks for the very check that has just run. A capture still uncounted after it is one this server will
    // not count (it matches nothing an adult approved here), so checking again cannot help: it is saved as a difference.
    if (reconciliation.note === UNCOUNTED_CAPTURE_NOTE) {
      reconciliation = { ...reconciliation, verdict: 'differs', note: 'PayPal shows a completed capture that this check could not count: it does not match what an adult approved here. Nothing was changed. Review this contribution in PayPal.' };
    }
    const unit = order ? (order.purchase_units ?? []).find((u) => u.reference_id === row.id) : null;
    const capture = unit?.payments?.captures?.[0];
    const refundIds = (unit?.payments?.refunds ?? []).map((r) => r.id).filter((id) => typeof id === 'string' && !id.includes(','));
    transaction(db, () => {
      db.prepare(`INSERT INTO order_checks (order_id, checked_at, verdict, outcome, note, paypal_order_status, capture_id, capture_status, amount_cents, currency, refund_ids)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(row.id, clock.iso(), reconciliation.verdict, outcome, reconciliation.note, reconciliation.paypalOrderStatus, reconciliation.paypalCaptureId,
          reconciliation.paypalCaptureStatus, reconciliation.paypalAmountCents, capture?.amount?.currency_code ?? null, refundIds.join(','));
      db.prepare('DELETE FROM order_checks WHERE order_id = ? AND id NOT IN (SELECT id FROM order_checks WHERE order_id = ? ORDER BY id DESC LIMIT ?)')
        .run(row.id, row.id, CHECK_HISTORY);
    });
    return checksFor(row.id)[0];
  }

  function result(row, outcome, extra = {}) {
    return { outcome, contribution: view(row.id), progress: progressFor(db, row.goal_id), awarded: [], ...extra };
  }

  /** Validate an adult-approved contribution request against the server's own records. */
  function validateRequest({ householdId, goalId, amountCents, approverId, approvalConfirmed, requestId }) {
    // The server never guesses which household or goal a contribution is for. Without a session to supply them, a missing
    // or non-text id is a refusal, before any lookup could fail on it.
    if (typeof householdId !== 'string' || typeof goalId !== 'string') throw new DomainError(400, 'invalid_owner', 'Say which household and goal this contribution is for.');
    const household = getHousehold(db, householdId);
    if (!household) throw new DomainError(404, 'not_found', 'Household not found.');
    if (!household.setupComplete) throw new DomainError(409, 'setup_required', 'Set up the house before contributing.');
    const goal = getGoal(db, goalId);
    if (!goal || goal.householdId !== householdId || goal.status !== 'active') throw new DomainError(404, 'not_found', 'Goal not found for this household.');
    const approver = getMember(db, householdId, approverId);
    if (!approver) throw new DomainError(400, 'invalid_member', 'Choose who is approving this contribution.');
    if (approver.role !== 'adult') throw new DomainError(403, 'adult_approval_required', `${approver.name} is a child persona. An adult must approve payments.`);
    if (approvalConfirmed !== true) throw new DomainError(400, 'approval_required', 'Confirm the approval checkbox first.');
    if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) throw new DomainError(400, 'invalid_request_id', 'Missing request id.');
    if (!Number.isSafeInteger(amountCents) || amountCents < MIN_CONTRIBUTION_CENTS || amountCents > MAX_CONTRIBUTION_CENTS) {
      throw new DomainError(400, 'invalid_amount', `Contributions must be between ${formatCents(MIN_CONTRIBUTION_CENTS)} and ${formatCents(MAX_CONTRIBUTION_CENTS)}.`);
    }
    const remaining = goal.targetCents - progressFor(db, goal.id).progressCents;
    if (remaining <= 0) throw new DomainError(409, 'goal_complete', 'This goal is complete. Start a new goal to keep saving.');
    if (amountCents > remaining) throw new DomainError(400, 'over_goal', `That would go past the goal. The most still needed is ${formatCents(remaining)}.`);
    return { household, goal, approver };
  }

  function sameRequest(row, input, provider) {
    return row.provider === provider && row.household_id === input.householdId && row.goal_id === input.goalId
      && row.amount_cents === input.amountCents && row.approved_by === input.approverId;
  }

  function insertHold(orderId, heldCents, status, authorizationId = null, { honorUntil = null, expiresAt = null } = {}) {
    const at = clock.iso();
    db.prepare('INSERT INTO payment_holds (order_id, authorization_id, status, held_cents, honor_until, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(orderId, authorizationId, status, heldCents, honorUntil, expiresAt, at, at);
  }

  function insertOrder({ id, provider, providerOrderId, input, goal, status }) {
    const at = clock.iso();
    db.prepare(`INSERT INTO payment_orders (id, provider, provider_order_id, request_id, household_id, goal_id, approved_by, amount_cents, currency, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, provider, providerOrderId, input.requestId, input.householdId, input.goalId, input.approverId, input.amountCents, goal.currency, status, at, at);
    return orderById(id);
  }

  /** Credit a confirmed capture exactly once, with its milestones, in one transaction. */
  function credit(row, captureId, amountCents, currency) {
    const kinds = LEDGER[row.provider];
    const outcome = transaction(db, () => {
      const existing = captureById(captureId);
      if (existing && existing.order_id !== row.id) throw new DomainError(409, 'capture_conflict', 'That capture belongs to a different contribution.');
      if (existing?.credited) return { duplicate: true, awarded: [] };
      const at = clock.iso();
      if (existing) db.prepare("UPDATE payment_captures SET status = 'COMPLETED', credited = 1, updated_at = ? WHERE capture_id = ?").run(at, captureId);
      else {
        db.prepare(`INSERT INTO payment_captures (capture_id, order_id, amount_cents, currency, status, credited, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'COMPLETED', 1, ?, ?)`).run(captureId, row.id, amountCents, currency, at, at);
      }
      const approver = getMember(db, row.household_id, row.approved_by);
      db.prepare(`INSERT INTO ledger_entries (household_id, goal_id, kind, effect, amount_cents, currency, source, source_ref, member_id, label, created_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`)
        .run(row.household_id, row.goal_id, kinds.contribution, amountCents, currency, kinds.source, `${kinds.prefix}-capture:${captureId}`,
          row.approved_by, `${row.provider === 'simulated' ? 'Simulated contribution' : 'PayPal sandbox contribution'} approved by ${approver?.name ?? 'an adult'}`, at);
      // A held order: the release an adult is confirming now. A final one ends the hold; one that is not leaves the rest
      // held. A release recorded before decisions had steps was always final.
      const hold = holdFor(row.id);
      let detail = null;
      if (hold) {
        const step = openStep(row.id);
        const released = hold.released_cents + amountCents;
        const finished = !step || step.final === 1 || released >= hold.held_cents;
        db.prepare('UPDATE payment_holds SET status = ?, released_cents = ?, updated_at = ? WHERE order_id = ?').run(finished ? 'released' : 'held', released, at, row.id);
        if (step) markStep(step, 'done', captureId);
        if (!finished) detail = `Released ${formatCents(released, currency)} of ${formatCents(hold.held_cents, currency)}; ${formatCents(hold.held_cents - released, currency)} is still held.`;
      }
      db.prepare("UPDATE payment_orders SET status = 'completed', status_detail = ?, updated_at = ? WHERE id = ?").run(detail, at, row.id);
      // A verified refund can arrive while this capture is still pending locally. Keep that evidence when an older
      // completion arrives: apply the stored reversals before awarding milestones, in this same transaction.
      let refunded = adoptDeferredRefunds(captureId);
      const knownRefunds = db.prepare("SELECT * FROM payment_refunds WHERE capture_id = ? AND credited = 0 AND status = 'COMPLETED' ORDER BY created_at, refund_id").all(captureId);
      for (const refund of knownRefunds) {
        if (applyRefund({ refundId: refund.refund_id, captureId, amountCents: refund.amount_cents,
          currency: refund.currency, status: refund.status }).outcome === 'refunded') refunded = true;
      }
      return { duplicate: false, refunded, awarded: awardTierMilestones(db, getGoal(db, row.goal_id), at) };
    });
    return result(row, outcome.duplicate ? 'already_completed' : outcome.refunded ? 'refunded' : 'completed', { awarded: outcome.awarded });
  }

  /** Check one provider capture against the order the server created, then act on its status. */
  function applyCapture(row, capture, purchaseUnitCustomId) {
    const amountCents = decimalStringToCents(capture?.amount?.value);
    const currency = capture?.amount?.currency_code;
    const customId = capture?.custom_id ?? purchaseUnitCustomId;
    if (!capture?.id) {
      setStatus(row, 'failed', 'PayPal returned a capture without an id.');
      return result(row, 'rejected_mismatch');
    }
    const recorded = captureById(capture.id);
    if (recorded?.credited && recorded.order_id === row.id && holdFor(row.id)) {
      // One release of a hold, counted once already. PayPal must still report the amount that was counted.
      return result(row, amountCents === recorded.amount_cents && currency === recorded.currency ? 'already_completed' : 'rejected_mismatch');
    }
    // A capture PayPal declined is already on record here as taking nothing. Hearing of it again (a late webhook, say,
    // while another release is under way) changes nothing.
    if (recorded && !recorded.credited && recorded.order_id === row.id && FAILED_CAPTURE.has(recorded.status) && FAILED_CAPTURE.has(capture.status)) return result(row, 'declined');
    const expectedCents = expectedCaptureCents(row);
    if (expectedCents === null) {
      // A capture of a hold that no adult has released here (made in PayPal directly, say). Never credited on its own.
      if (!SETTLED.has(orderById(row.id).status)) setStatus(row, 'rejected', `Capture ${capture.id} arrived for a held contribution that no adult has released here. No progress was recorded.`);
      return result(row, 'rejected_mismatch');
    }
    if (amountCents !== expectedCents || currency !== row.currency || customId !== row.id) {
      if (!SETTLED.has(orderById(row.id).status)) {
        setStatus(row, 'rejected', `Capture ${capture.id} did not match the expected ${formatCents(expectedCents, row.currency)} ${row.currency} for this goal. No progress was recorded.`);
      }
      return result(row, 'rejected_mismatch');
    }
    switch (capture.status) {
      case 'COMPLETED':
        return credit(row, capture.id, amountCents, currency);
      case 'PENDING':
        upsertCapture(row, capture.id, amountCents, currency, 'PENDING');
        if (!SETTLED.has(orderById(row.id).status)) setStatus(row, 'pending', `PayPal is holding this capture${capture.status_details?.reason ? ` (${capture.status_details.reason})` : ''}. Progress updates only when it completes.`);
        return result(row, 'pending');
      case 'REFUNDED':
      case 'PARTIALLY_REFUNDED':
        // Refunded after we credited it: the credit stands and the refunds themselves are applied by applyOrder/webhooks.
        if (captureById(capture.id)?.credited) return result(row, 'already_completed');
        // First seen after a refund: withhold credit unless applyOrder can establish a partial remainder from refund details.
        upsertCapture(row, capture.id, amountCents, currency, capture.status);
        if (!SETTLED.has(orderById(row.id).status)) setStatus(row, 'failed', 'This capture was refunded in PayPal before any progress was recorded here. Nothing was credited.');
        return result(row, 'not_credited');
      case 'DECLINED':
      case 'DENIED':
      case 'FAILED':
        upsertCapture(row, capture.id, amountCents, currency, capture.status);
        if (!SETTLED.has(orderById(row.id).status)) setStatus(row, 'declined', 'PayPal declined this capture. No progress was recorded.');
        return result(row, 'declined');
      default: {
        // A status this server does not know: never credit on a guess.
        upsertCapture(row, capture.id, amountCents, currency, String(capture.status));
        if (!SETTLED.has(orderById(row.id).status)) setStatus(row, 'failed', `Unexpected capture status ${capture.status}. No progress was recorded.`);
        return result(row, 'not_credited');
      }
    }
  }

  function applyOrder(row, order, { explicit = false } = {}) {
    if (!order || order.id !== row.provider_order_id) {
      setStatus(row, 'failed', 'PayPal returned a different order than expected. No progress was recorded.');
      return result(row, 'rejected_mismatch');
    }
    const unit = (order.purchase_units ?? []).find((u) => u.reference_id === row.id);
    if (!unit) {
      setStatus(row, 'failed', 'The PayPal order did not contain this contribution. No progress was recorded.');
      return result(row, 'rejected_mismatch');
    }
    const captures = unit.payments?.captures ?? [];
    let applied;
    if (holdFor(row.id)) {
      applied = applyHeldOrder(row, unit, order.status, explicit);
      if (!captures.length) return applied;
    } else {
      if (!captures.length) {
        // A read can be stale: if a verified webhook settled the order while we waited, canonical state wins.
        const current = orderById(row.id).status;
        if (SETTLED.has(current)) return result(row, 'already_completed');
        // An unresolved capture attempt (marked pending after PayPal did not answer) stays pending and recheckable until a
        // capture bound to this order is confirmed; a read that still shows none does not hide the recovery action.
        if (current === 'pending') return result(row, 'unknown');
        if (order.status === 'APPROVED') setStatus(row, 'created', 'Approved in PayPal but not captured yet.');
        return result(row, 'not_captured');
      }
      applied = applyCapture(row, captures[0], unit.custom_id);
    }
    const capture = captures[0];
    // Refunds listed on the order are applied too (once per refund id), so a refund made in the PayPal dashboard is not
    // lost when its webhook was never delivered: PayPal stops retrying after 3 days, and local runs often have no tunnel.
    let refunded = false;
    let rejectedRefund = false;
    for (const refund of unit.payments?.refunds ?? []) {
      const up = (refund.links ?? []).find((l) => l.rel === 'up')?.href ?? '';
      // A refund names its capture. Only an order with a single capture lets one that does not be attributed.
      const linked = /\/captures\/([^/?#]+)/.exec(up)?.[1];
      const captureId = linked ? decodeURIComponent(linked) : captures.length === 1 ? capture.id : null;
      if (!captureId || !captures.some((c) => c.id === captureId)) { rejectedRefund = true; continue; }
      const outcome = applyRefund({
        refundId: refund.id, captureId, amountCents: decimalStringToCents(refund.amount?.value),
        currency: refund.amount?.currency_code, status: refund.status,
      }).outcome;
      if (outcome === 'refunded') refunded = true;
      if (['rejected_refund', 'ignored_unknown_capture'].includes(outcome)) rejectedRefund = true;
    }
    // PARTIALLY_REFUNDED confirms a capture, but not its remainder by itself. Only validated, completed refunds for
    // this capture can establish that amount. Credit and replay those reversals together, never the gross milestone.
    if (captures.length === 1 && capture.status === 'PARTIALLY_REFUNDED' && applied.outcome === 'not_credited' && !rejectedRefund) {
      const known = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM payment_refunds WHERE capture_id = ? AND currency = ? AND status = 'COMPLETED' AND credited = 0").get(capture.id, row.currency).cents;
      const expectedCents = expectedCaptureCents(row);
      if (known > 0 && known < expectedCents) return credit(row, capture.id, expectedCents, row.currency);
    }
    return refunded ? result(row, 'refunded') : applied;
  }

  /**
   * A held order: its captures first, then its authorization. Each capture not counted yet must be the release an adult
   * is confirming now; the authorization then says whether the rest is still held, was returned or expired.
   */
  function applyHeldOrder(row, unit, orderStatus, explicit) {
    let captured = null;
    for (const capture of unit.payments?.captures ?? []) {
      const known = captureById(capture.id);
      if (known?.credited && known.order_id === row.id) continue; // counted once already
      if (known?.order_id === row.id && FAILED_CAPTURE.has(known.status) && FAILED_CAPTURE.has(capture.status)) continue; // declined before: it took nothing, and is no news
      const applied = applyCapture(row, capture, unit.custom_id);
      if (captured?.outcome !== 'completed') captured = applied; // a credit made here is the answer, even beside a stray
    }
    const hold = holdFor(row.id);
    const authorization = currentAuthorization(unit, hold);
    // A listed capture that is neither counted here nor definitely failed may still count: nothing is reopened around it.
    const waiting = (unit.payments?.captures ?? []).some((c) => !captureById(c.id)?.credited && !FAILED_CAPTURE.has(c?.status));
    if (explicit && !waiting && authorization?.status === 'PARTIALLY_CAPTURED' && authorization.id === hold.authorization_id
      && ['releasing', 'returning'].includes(hold.status)) {
      // An adult's explicit check: every capture PayPal lists is counted here or failed, and the rest is still held, so
      // the decision under way did not take effect. The hold is open again and an adult may decide afresh.
      reopenHold(row);
      setHoldDetail(row, `PayPal still holds the other ${formatCents(hold.held_cents - hold.released_cents, row.currency)}: the earlier decision did not go through. An adult can decide again.`);
      return result(row, 'held');
    }
    const held = applyAuthorization(row, authorization, unit.custom_id, orderStatus, explicit);
    return captured ? result(row, captured.outcome, { awarded: captured.awarded }) : held;
  }

  /** The authorization that holds this contribution's money now, among those PayPal listed for its order. */
  function currentAuthorization(unit, hold) {
    const listed = unit.payments?.authorizations ?? [];
    if (!hold.authorization_id) return listed[0];
    // While an extension waits for PayPal, the newest authorization listed for this order that this server has not seen
    // before is that extension's answer. One it already refused to use never is.
    if (openStep(hold.order_id)?.kind === 'extend') {
      const seen = new Set([hold.authorization_id, hold.original_authorization_id, ...stepsFor(hold.order_id).map((s) => s.provider_ref)]);
      const fresh = listed.filter((a) => a?.id && !seen.has(a.id)).at(-1);
      if (fresh) return fresh;
    }
    // An extended hold whose new authorization is not listed has nothing here to act on.
    return listed.find((a) => a?.id === hold.authorization_id) ?? (hold.original_authorization_id ? null : listed[0]);
  }

  /** A note on a held contribution. When part of it already counts, its settled status stays and only the note changes. */
  function setHoldDetail(row, detail) {
    if (SETTLED.has(orderById(row.id).status)) db.prepare('UPDATE payment_orders SET status_detail = ?, updated_at = ? WHERE id = ?').run(detail, clock.iso(), row.id);
    else setStatus(row, 'held', detail);
  }

  /**
   * A hold that is over: returned or expired. Money released from it earlier stays counted; only the rest ends here. A
   * decision still waiting for PayPal is settled by this: a return took effect, anything else did not.
   */
  function endHold(row, ending, note) {
    transaction(db, () => {
      const step = openStep(row.id);
      if (step) markStep(step, step.kind === 'return' && ending === 'returned' ? 'done' : 'failed');
      setHold(row.id, ending);
      if (SETTLED.has(orderById(row.id).status)) db.prepare('UPDATE payment_orders SET status_detail = ?, updated_at = ? WHERE id = ?').run(note, clock.iso(), row.id);
      else setStatus(row, ending, note);
    });
  }
  /** The note for a hold that ends now, naming what was released from it earlier. */
  function endNote(row, ending, { earlier = '' } = {}) {
    const hold = holdFor(row.id);
    const rest = formatCents(hold.held_cents - hold.released_cents, row.currency);
    const sim = row.provider === 'simulated' ? 'Simulated: ' : '';
    const what = ending === 'returned' ? 'was returned' : 'expired in PayPal';
    if (hold.released_cents > 0) return `${sim}${formatCents(hold.released_cents, row.currency)} was released; the other ${rest} ${what}${earlier}. Nothing more was charged or credited.`;
    return `${sim ? 'Simulated: the' : 'The'} hold of ${rest} ${what}${earlier}. Nothing was charged or credited.`;
  }

  /** Check PayPal's answer to an extension against this hold; only an exact match takes over from the old authorization. */
  function applyExtension(row, authorization, purchaseUnitCustomId) {
    const hold = holdFor(row.id);
    const step = openStep(row.id);
    if (step?.kind !== 'extend') return result(row, 'unknown');
    const until = hold.expires_at ? ` until ${dayText(hold.expires_at)}` : '';
    const sim = row.provider === 'simulated' ? 'Simulated: ' : '';
    const amountCents = decimalStringToCents(authorization?.amount?.value);
    const customId = authorization?.custom_id ?? purchaseUnitCustomId;
    const taken = authorization?.id ? db.prepare('SELECT 1 FROM payment_holds WHERE authorization_id = ? OR original_authorization_id = ?').get(authorization.id, authorization.id) : null;
    if (!authorization?.id || taken || amountCents !== hold.held_cents || authorization.amount?.currency_code !== row.currency || (customId != null && customId !== row.id)) {
      // An authorization that is not exactly this hold is never captured from. The original one still holds the money.
      // Its id is kept on the failed step, so a later read or event about it is recognised and ignored.
      markStep(step, 'failed', typeof authorization?.id === 'string' ? authorization.id : null);
      setHoldDetail(row, `PayPal’s answer to the extension did not match this hold, so it was not used. The hold continues on its original authorization${until}.`);
      return result(row, 'rejected_mismatch');
    }
    switch (authorization.status) {
      case 'CREATED': {
        const at = clock.iso();
        const expiresAt = validTime(authorization.expiration_time) ?? hold.expires_at;
        const honorUntil = honorEnd(validTime(authorization.create_time) ?? at, expiresAt);
        transaction(db, () => {
          db.prepare(`UPDATE payment_holds SET original_authorization_id = authorization_id, authorization_id = ?, honor_until = ?, expires_at = ?,
            extended_at = ?, updated_at = ? WHERE order_id = ?`).run(authorization.id, honorUntil, expiresAt, at, at, row.id);
          markStep(step, 'done', authorization.id);
          setHoldDetail(row, `${sim}${formatCents(hold.held_cents, row.currency)} is held again under a new authorization, guaranteed until ${dayText(honorUntil)}. Nothing is credited until an adult releases or returns it.`);
        });
        return result(row, 'extended');
      }
      case 'PENDING':
        setHoldDetail(row, 'PayPal is still reviewing the extension. The hold is unchanged until it answers.');
        return result(row, 'pending');
      case 'DENIED':
        markStep(step, 'failed', authorization.id);
        setHoldDetail(row, `PayPal declined the extension. Nothing was charged; the hold continues on its original authorization${until}.`);
        return result(row, 'declined');
      default:
        return result(row, 'unknown'); // a status this server does not know: never act on a guess
    }
  }

  /** An extended hold's order details may leave its new authorization out; an explicit check then reads it on its own. */
  async function withCurrentAuthorization(row, order) {
    const hold = holdFor(row.id);
    const unit = (order?.purchase_units ?? []).find((u) => u.reference_id === row.id);
    if (!hold?.original_authorization_id || !unit || (unit.payments?.authorizations ?? []).some((a) => a?.id === hold.authorization_id)) return order;
    let authorization;
    try { ({ data: authorization } = await paypal.getAuthorization(hold.authorization_id)); } catch (error) {
      if (error instanceof PayPalError) return order; // nothing more to go on: the hold stays as recorded
      throw error;
    }
    if (authorization?.id !== hold.authorization_id) return order;
    const payments = { ...unit.payments, authorizations: [...(unit.payments?.authorizations ?? []), authorization] };
    return { ...order, purchase_units: order.purchase_units.map((u) => (u === unit ? { ...u, payments } : u)) };
  }

  /**
   * Check a provider authorization against the held order the server created, then record what it says. It never
   * credits anything: only a capture of an adult's exact release does that. A decision already under way or finished
   * here is not overwritten by a read that still shows the hold as open.
   */
  function applyAuthorization(row, authorization, purchaseUnitCustomId, orderStatus = null, explicit = false) {
    const hold = holdFor(row.id);
    if (!authorization) {
      if (SETTLED.has(orderById(row.id).status)) return result(row, 'already_completed');
      if (['held', 'releasing', 'returning', 'released', 'returned', 'lapsed'].includes(hold.status)) return result(row, hold.status === 'held' ? 'held' : 'unknown');
      if (orderStatus === 'APPROVED') setStatus(row, 'created', 'Approved in PayPal but not held yet.');
      return result(row, 'not_held');
    }
    // After an extension, the authorization it replaced no longer holds this money, and an extension answer this server
    // refused to use never did: what PayPal says about either changes nothing.
    if (hold.original_authorization_id && authorization.id === hold.original_authorization_id) return result(row, 'superseded');
    if (authorization.id && stepsFor(row.id).some((s) => s.kind === 'extend' && s.state === 'failed' && s.provider_ref === authorization.id)) return result(row, 'superseded');
    // While an extension waits for PayPal, a new authorization for this order is that extension's answer.
    if (authorization.id && hold.authorization_id && authorization.id !== hold.authorization_id && openStep(row.id)?.kind === 'extend') {
      return applyExtension(row, authorization, purchaseUnitCustomId);
    }
    const amountCents = decimalStringToCents(authorization.amount?.value);
    const customId = authorization.custom_id ?? purchaseUnitCustomId;
    const other = authorization.id ? db.prepare('SELECT order_id FROM payment_holds WHERE authorization_id = ?').get(authorization.id) : null;
    if (!authorization.id || amountCents !== row.amount_cents || authorization.amount?.currency_code !== row.currency || customId !== row.id
      || (other && other.order_id !== row.id) || (hold.authorization_id && hold.authorization_id !== authorization.id)) {
      if (!SETTLED.has(orderById(row.id).status) && !['released', 'returned', 'lapsed'].includes(hold.status)) {
        setHold(row.id, 'failed');
        setStatus(row, 'rejected', `The hold PayPal reported did not match the expected ${formatCents(row.amount_cents, row.currency)} ${row.currency} for this goal. Nothing was credited.`);
      }
      return result(row, 'rejected_mismatch');
    }
    const expiresAt = validTime(authorization.expiration_time);
    // PayPal's guarantee runs three days from its own authorization time. A hold being placed right now may use this
    // server's clock when PayPal leaves that time out; an older hold is never given a guarantee it may not have.
    const honorFrom = validTime(authorization.create_time) ?? (hold.status === 'awaiting' ? clock.iso() : null);
    db.prepare('UPDATE payment_holds SET authorization_id = ?, expires_at = COALESCE(?, expires_at), honor_until = COALESCE(honor_until, ?), updated_at = ? WHERE order_id = ?')
      .run(authorization.id, expiresAt, honorFrom ? honorEnd(honorFrom, expiresAt ?? hold.expires_at) : null, clock.iso(), row.id);
    const money = formatCents(row.amount_cents, row.currency);
    switch (authorization.status) {
      case 'CREATED':
        // PayPal showing the whole amount untouched after a release was counted here contradicts the records: act on nothing.
        if (hold.released_cents > 0) return result(row, 'unknown');
        // An adult's release or return may already be on its way to PayPal; a read made before it landed changes nothing.
        if (['releasing', 'returning'].includes(hold.status)) {
          if (!explicit) return result(row, 'unknown');
          // An adult's explicit check shows PayPal still holding the whole amount: that decision did not take effect.
          reopenHold(row);
          setStatus(row, 'held', `PayPal still holds ${money}: the earlier decision did not go through. An adult can decide again.`);
          return result(row, 'held');
        }
        if (['released', 'returned', 'lapsed'].includes(hold.status)) return result(row, hold.status === 'released' ? 'already_completed' : hold.status);
        setHold(row.id, 'held');
        setStatus(row, 'held', `PayPal is holding ${money}. Nothing is credited until an adult releases or returns it.`);
        return result(row, 'held');
      case 'PENDING':
        if (hold.status === 'awaiting') setStatus(row, 'pending', 'PayPal is still reviewing this hold. Nothing is held or credited yet.');
        return result(row, 'pending');
      case 'VOIDED':
      case 'EXPIRED': {
        // What was left of the hold is over. A part released earlier stays counted; a hold already over is not reopened.
        const ending = authorization.status === 'VOIDED' ? 'returned' : 'lapsed';
        if (['released', 'returned', 'lapsed'].includes(hold.status)) return result(row, hold.status === 'released' ? 'already_completed' : hold.status);
        // While an extension is unanswered, this may be the authorization it replaced, with the money now held under a
        // new one. Only PayPal's answer to the extension itself settles that (asking again is the same request).
        if (openStep(row.id)?.kind === 'extend') return result(row, 'unknown');
        endHold(row, ending, endNote(row, ending));
        return result(row, ending);
      }
      case 'DENIED':
        if (SETTLED.has(orderById(row.id).status)) return result(row, 'already_completed');
        setHold(row.id, 'failed');
        setStatus(row, 'declined', 'PayPal declined this hold. Nothing was held or credited.');
        return result(row, 'declined');
      case 'PARTIALLY_CAPTURED':
        if (hold.status === 'held') return result(row, 'held'); // part was released here; the rest is still held
      // falls through
      case 'CAPTURED':
        // The captures decide: applyOrder applied them first, each checked against an adult's recorded release.
        return result(row, hold.status === 'released' ? 'already_completed' : 'unknown');
      default:
        // A status this server does not know: never act on a guess.
        return result(row, 'unknown');
    }
  }

  function ownedOrder(providerOrderId, householdId, goalId, provider = 'paypal-sandbox') {
    const row = typeof providerOrderId === 'string' ? orderByProviderId(providerOrderId) : null;
    if (!row || row.provider !== provider) throw new DomainError(404, 'unknown_order', 'This server did not create that order.');
    if (row.household_id !== householdId || row.goal_id !== goalId) {
      throw new DomainError(409, 'order_mismatch', 'That order belongs to a different household or goal. Nothing was captured.');
    }
    return row;
  }

  // No HTTP answer (timeout, dropped connection) or a PayPal server error: a write may already have taken effect.
  const outcomeUnknown = (error) => !Number.isInteger(error.status) || error.status >= 500;
  const UNRESOLVED = 'PayPal did not confirm this capture in time, so its outcome is not known yet. Nothing was credited; check with PayPal.';
  /** Mark a capture attempt unresolved (pending, recheckable), unless a verified webhook already settled it meanwhile. */
  function markUnresolved(row, detail = UNRESOLVED) {
    if (!SETTLED.has(orderById(row.id).status)) setStatus(row, 'pending', detail);
  }
  const UNRESOLVED_HOLD = 'PayPal did not confirm this hold in time, so its outcome is not known yet. Nothing was credited; check with PayPal.';

  function paypalFailure(row, error, message) {
    if (row && !SETTLED.has(orderById(row.id)?.status)) setStatus(row, 'failed', `${message} (${error.paypalName ?? error.status ?? 'error'})`);
    return new DomainError(502, 'paypal_error', `${message} No progress was recorded.`, { debugId: error.debugId, issues: error.issues });
  }

  // Once capture validation establishes ownership, transfer matching evidence to the ordinary refund pipeline.
  // Joining the caller's transaction keeps the receipt, credit, reversals and milestone decision atomic.
  function adoptDeferredRefunds(captureId) {
    return transaction(db, () => {
      if (!captureById(captureId)) return false;
      let refunded = false;
      const waiting = db.prepare('SELECT * FROM deferred_refunds WHERE capture_id = ? ORDER BY received_at, refund_id').all(captureId);
      for (const row of waiting) {
        const applied = applyRefund({ refundId: row.refund_id, captureId, amountCents: row.amount_cents, currency: row.currency, status: 'COMPLETED' });
        if (['refunded', 'duplicate_refund', 'refund_not_credited'].includes(applied.outcome)) {
          db.prepare('DELETE FROM deferred_refunds WHERE refund_id = ?').run(row.refund_id);
        }
        if (applied.outcome === 'refunded') refunded = true;
      }
      return refunded;
    });
  }

  /** Record a provider refund once, reversing only progress that was actually credited. */
  function applyRefund({ refundId, captureId, amountCents, currency, status }) {
    return transaction(db, () => {
      const cap = captureById(captureId);
      if (!cap) {
        // This path is reached only from verified webhooks or validated provider order data. Hold minimal completed
        // evidence durably; a raw capture id alone never attributes it to a household or changes progress.
        if (status === 'COMPLETED' && typeof refundId === 'string' && refundId.length > 0 && refundId.length <= 128
          && typeof captureId === 'string' && captureId.length > 0 && captureId.length <= 128
          && Number.isSafeInteger(amountCents) && amountCents > 0 && typeof currency === 'string' && /^[A-Z]{3}$/.test(currency)) {
          const recorded = db.prepare('SELECT capture_id FROM payment_refunds WHERE refund_id = ?').get(refundId);
          if (recorded && recorded.capture_id !== captureId) throw new DomainError(409, 'refund_conflict', 'That refund belongs to a different capture.');
          const held = db.prepare('SELECT * FROM deferred_refunds WHERE refund_id = ?').get(refundId);
          if (held && (held.capture_id !== captureId || held.amount_cents !== amountCents || held.currency !== currency)) {
            throw new DomainError(409, 'refund_conflict', 'That refund was already recorded with different details.');
          }
          db.prepare('INSERT INTO deferred_refunds (refund_id, capture_id, amount_cents, currency, received_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(refund_id) DO NOTHING')
            .run(refundId, captureId, amountCents, currency, clock.iso());
        }
        return { outcome: 'ignored_unknown_capture' };
      }
      const row = orderById(cap.order_id);
      const kinds = LEDGER[row.provider];
      if (!refundId || !Number.isSafeInteger(amountCents) || amountCents <= 0 || currency !== cap.currency) {
        return { outcome: 'rejected_refund', row };
      }
      const existing = db.prepare('SELECT * FROM payment_refunds WHERE refund_id = ?').get(refundId);
      if (existing && existing.capture_id !== captureId) throw new DomainError(409, 'refund_conflict', 'That refund belongs to a different capture.');
      if (existing?.credited) return { outcome: 'duplicate_refund', row };
      const at = clock.iso();
      const upsert = (credited, refundStatus) => {
        if (existing) db.prepare('UPDATE payment_refunds SET status = ?, credited = ? WHERE refund_id = ?').run(refundStatus, credited, refundId);
        else {
          db.prepare('INSERT INTO payment_refunds (refund_id, capture_id, amount_cents, currency, status, credited, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(refundId, captureId, amountCents, currency, refundStatus, credited, at);
        }
      };
      if (status !== 'COMPLETED' || !cap.credited) {
        upsert(0, String(status));
        return { outcome: cap.credited ? 'refund_pending' : 'refund_not_credited', row };
      }
      if (amountCents > cap.amount_cents - cap.refunded_cents) {
        upsert(0, 'REJECTED_EXCEEDS_CREDIT');
        return { outcome: 'rejected_refund', row };
      }
      upsert(1, 'COMPLETED');
      db.prepare(`INSERT INTO ledger_entries (household_id, goal_id, kind, effect, amount_cents, currency, source, source_ref, member_id, label, created_at)
        VALUES (?, ?, ?, -1, ?, ?, ?, ?, NULL, ?, ?)`)
        .run(row.household_id, row.goal_id, kinds.refund, amountCents, currency, kinds.source, `${kinds.prefix}-refund:${refundId}`,
          row.provider === 'simulated' ? 'Simulated refund' : 'PayPal sandbox refund', at);
      const refunded = cap.refunded_cents + amountCents;
      const full = refunded >= cap.amount_cents;
      db.prepare('UPDATE payment_captures SET refunded_cents = ?, status = ?, updated_at = ? WHERE capture_id = ?')
        .run(refunded, full ? 'REFUNDED' : 'PARTIALLY_REFUNDED', at, captureId);
      // The order as a whole: a hold released in steps has one counted capture per step.
      const order = db.prepare('SELECT SUM(amount_cents) AS cents, SUM(refunded_cents) AS refunded FROM payment_captures WHERE order_id = ? AND credited = 1').get(row.id);
      db.prepare('UPDATE payment_orders SET status = ?, status_detail = ?, updated_at = ? WHERE id = ?')
        .run(order.refunded >= order.cents ? 'refunded' : 'partially_refunded', `${formatCents(order.refunded, currency)} refunded; progress reduced by the same amount.`, at, row.id);
      return { outcome: 'refunded', row };
    });
  }

  const IN_PROGRESS = 'A decision on this hold is still being confirmed. Check it with PayPal before trying again.';
  /** The goal must still be open, and need money, for a hold to be released into it or kept for it. */
  function goalStillNeeds(row) {
    const goal = getGoal(db, row.goal_id);
    if (!goal || goal.status !== 'active') throw new DomainError(409, 'goal_closed', 'This goal is no longer active. Return the hold instead.');
    const needed = goal.targetCents - progressFor(db, goal.id).progressCents;
    if (needed <= 0) throw new DomainError(409, 'goal_complete', 'This goal is complete. Return the hold instead.');
    return needed;
  }

  /**
   * PayPal's rules for extending (reauthorizing) a hold, as this server keeps them: once, only after the three-day honor
   * period, never after the authorization expires, and only while all of it is still held.
   */
  function mayExtend(row, hold) {
    if (hold.extended_at) throw new DomainError(409, 'already_extended', `This hold was already extended once, the most this app allows. Release or return it${hold.expires_at ? ` by ${dayText(hold.expires_at)}` : ''}.`);
    if (hold.released_cents > 0) throw new DomainError(409, 'partly_released', 'Part of this hold was already released, so it cannot be extended. Release or return the rest.');
    const now = clock.now().getTime();
    const honor = Date.parse(hold.honor_until ?? '');
    if (!Number.isFinite(honor)) throw new DomainError(409, 'honor_unknown', 'This server does not know when PayPal’s guarantee for this hold ends. Check it with PayPal first.');
    if (now < honor) throw new DomainError(409, 'too_soon', `PayPal guarantees this hold until ${dayText(hold.honor_until)}. It can be extended after that.`);
    const expires = Date.parse(hold.expires_at ?? '');
    if (Number.isFinite(expires) && now >= expires) throw new DomainError(409, 'hold_expired', 'This hold has reached its expiry in PayPal and cannot be extended. Check it with PayPal; nothing was charged.');
    goalStillNeeds(row);
  }

  /**
   * Validate an adult's decision on a hold (release, return or extend) against the server's own records, and write it
   * down as a step before PayPal is asked. Only one decision at a time can wait for PayPal; the same request again is
   * answered from its step. A release takes at most what is still held and never more than the goal still needs; a hold
   * can be released in at most MAX_RELEASES steps, and the last is always final.
   */
  function holdDecision({ contributionId, householdId, goalId, approverId, approvalConfirmed, requestId, amountCents, keepRest }, kind) {
    const row = typeof contributionId === 'string' ? orderById(contributionId) : null;
    const hold = row ? holdFor(row.id) : null;
    if (!row || !hold) throw new DomainError(404, 'unknown_hold', 'This server has no held contribution with that reference.');
    requireMode(row.provider === 'simulated' ? 'example' : 'sandbox');
    if (row.household_id !== householdId || row.goal_id !== goalId) throw new DomainError(409, 'order_mismatch', 'That hold belongs to a different household or goal. Nothing was changed.');
    const approver = getMember(db, householdId, approverId);
    if (!approver || approver.role !== 'adult') throw new DomainError(403, 'adult_approval_required', 'An adult must decide what happens to a held contribution.');
    if (approvalConfirmed !== true) throw new DomainError(400, 'approval_required', 'Confirm this decision first.');
    if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) throw new DomainError(400, 'invalid_request_id', 'Missing request id.');
    const prior = db.prepare("SELECT * FROM payment_hold_steps WHERE request_id = ? AND state <> 'failed'").get(requestId);
    if (prior) {
      if (prior.order_id !== row.id || prior.kind !== kind) throw new DomainError(409, 'request_conflict', 'That request id was already used for a different decision.');
      return { row, hold, step: prior, replay: true };
    }
    if (hold.decision_request_id === requestId) return { row, hold, step: null, replay: true }; // decided before decisions had steps
    if (['released', 'returned', 'lapsed', 'failed'].includes(hold.status)) throw new DomainError(409, 'hold_decided', 'This hold was already decided. Nothing was changed.');
    const open = openStep(row.id);
    // An extension whose answer was lost may be asked for again: it goes to PayPal as the very same request.
    if (kind === 'extend' && open?.kind === 'extend') return { row, hold, step: open, replay: true };
    if (open || ['releasing', 'returning'].includes(hold.status)) throw new DomainError(409, 'hold_in_progress', IN_PROGRESS);
    if (hold.status !== 'held') throw new DomainError(409, 'not_held', 'PayPal has not confirmed this hold yet.');
    const remaining = hold.held_cents - hold.released_cents;
    let amount = remaining;
    let final = kind === 'extend' ? 0 : 1;
    if (kind === 'release') {
      if (!Number.isSafeInteger(amountCents) || amountCents < MIN_CONTRIBUTION_CENTS || amountCents > remaining) {
        throw new DomainError(400, 'invalid_amount', `Release between ${formatCents(MIN_CONTRIBUTION_CENTS)} and the ${formatCents(remaining)} that is held.`);
      }
      const needed = goalStillNeeds(row);
      if (amountCents > needed) throw new DomainError(400, 'over_goal', `That would go past the goal. The most still needed is ${formatCents(needed)}.`);
      if (keepRest === true && amountCents < remaining) {
        const released = db.prepare("SELECT COUNT(*) AS n FROM payment_hold_steps WHERE order_id = ? AND kind = 'release' AND state = 'done'").get(row.id).n;
        if (released + 1 >= MAX_RELEASES) throw new DomainError(400, 'last_release', `A hold can be released in at most ${MAX_RELEASES} steps, so this one must be the last. Release it without keeping the rest, or return the rest.`);
        if (remaining - amountCents < MIN_CONTRIBUTION_CENTS) throw new DomainError(400, 'invalid_amount', `Keep at least ${formatCents(MIN_CONTRIBUTION_CENTS)} held, or release all ${formatCents(remaining)}.`);
        final = 0;
      }
      amount = amountCents;
    }
    if (kind === 'extend') mayExtend(row, hold);
    return transaction(db, () => {
      const at = clock.iso();
      if (kind !== 'extend') {
        let moved;
        try {
          moved = db.prepare("UPDATE payment_holds SET status = ?, release_cents = ?, decided_by = ?, decision_request_id = ?, updated_at = ? WHERE order_id = ? AND status = 'held'")
            .run(kind === 'release' ? 'releasing' : 'returning', kind === 'release' ? amount : hold.release_cents, approverId, requestId, at, row.id).changes;
        } catch (error) {
          // The database's own rule, under the check above: a release can never take more than is still held.
          if (/CHECK constraint failed/.test(error?.message ?? '')) throw new DomainError(409, 'over_held', `That is more than the ${formatCents(remaining)} still held. Nothing was changed.`);
          throw error;
        }
        if (!moved) throw new DomainError(409, 'hold_in_progress', IN_PROGRESS);
      }
      const seq = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM payment_hold_steps WHERE order_id = ?').get(row.id).n;
      db.prepare(`INSERT INTO payment_hold_steps (order_id, seq, kind, amount_cents, final, request_id, member_id, state, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)`).run(row.id, seq, kind, amount, final, requestId, approverId, at, at);
      return { row, hold: holdFor(row.id), step: openStep(row.id), replay: false };
    });
  }
  /** A decision that definitely did not take effect: the hold is open again and an adult may decide afresh. */
  function reopenHold(row) {
    transaction(db, () => {
      failOpenStep(row.id);
      // The last release that did take effect, if any, stays the one on record.
      db.prepare(`UPDATE payment_holds SET status = 'held', decided_by = NULL, decision_request_id = NULL, updated_at = ?,
        release_cents = (SELECT amount_cents FROM payment_hold_steps WHERE order_id = ? AND kind = 'release' AND state = 'done' ORDER BY seq DESC LIMIT 1)
        WHERE order_id = ? AND status IN ('releasing', 'returning')`).run(clock.iso(), row.id, row.id);
    });
  }
  /** The answer to a decision asked for again, from its step (or, for a decision made before steps, from the hold). */
  function replayOutcome(row, step) {
    const status = holdFor(row.id).status;
    if (!step) return { released: 'already_completed', returned: 'returned', lapsed: 'lapsed', held: 'held' }[status] ?? 'unknown';
    if (step.state === 'sent') return 'unknown';
    if (step.kind === 'release') return 'already_completed';
    if (step.kind === 'extend') return 'extended';
    return ['returned', 'lapsed'].includes(status) ? status : 'unknown';
  }

  function refundResult(applied) {
    if (!applied.row) return { outcome: applied.outcome };
    return result(applied.row, applied.outcome);
  }

  function refundPreconditions({ captureId, householdId, approverId, approvalConfirmed }, provider) {
    const cap = typeof captureId === 'string' ? captureById(captureId) : null;
    const row = cap ? orderById(cap.order_id) : null;
    if (!cap || row.provider !== provider) throw new DomainError(404, 'unknown_capture', 'This server has no record of that capture.');
    if (row.household_id !== householdId) throw new DomainError(409, 'order_mismatch', 'That capture belongs to a different household.');
    const approver = getMember(db, householdId, approverId);
    if (!approver || approver.role !== 'adult') throw new DomainError(403, 'adult_approval_required', 'An adult must approve refunds.');
    if (approvalConfirmed !== true) throw new DomainError(400, 'approval_required', 'Confirm the refund first.');
    if (!cap.credited) throw new DomainError(409, 'not_refundable', 'Only credited contributions can be refunded.');
    // A hold released in steps is refunded once it is over, so its released parts and what is still held never mix.
    if (OPEN_HOLD.has(holdFor(row.id)?.status)) throw new DomainError(409, 'hold_open', 'Part of this contribution is still held. Release or return the rest first, then refund.');
    const refundable = cap.amount_cents - cap.refunded_cents;
    if (refundable <= 0) throw new DomainError(409, 'already_refunded', 'This contribution was already refunded.');
    // A pending refund has not reduced refunded_cents yet, so a second request could ask PayPal to refund the same money.
    if (db.prepare("SELECT 1 FROM payment_refunds WHERE capture_id = ? AND credited = 0 AND status = 'PENDING'").get(cap.capture_id)) {
      throw new DomainError(409, 'refund_pending', 'A refund for this contribution is already pending in PayPal. Progress changes when it completes.');
    }
    return { cap, row, refundable };
  }

  return {
    mode,

    async createPayPalOrder(input) {
      requireMode('sandbox');
      const existing = priorRequest(input.requestId);
      if (existing) {
        if (!sameRequest(existing, input, 'paypal-sandbox') || Boolean(holdFor(existing.id)) !== (input.hold === true)) throw new DomainError(409, 'request_conflict', 'That request id was already used for a different contribution.');
        if (existing.provider_order_id) return { orderId: existing.provider_order_id, approveUrl: null, contribution: view(existing.id) };
        throw new DomainError(409, 'in_progress', 'This contribution is already being created.');
      }
      const { goal } = validateRequest(input);
      const id = newId('ctb');
      const hold = input.hold === true;
      const row = transaction(db, () => {
        const created = insertOrder({ id, provider: 'paypal-sandbox', providerOrderId: null, input, goal, status: 'creating' });
        if (hold) insertHold(id, input.amountCents, 'awaiting');
        return created;
      });
      let data;
      try {
        ({ data } = await paypal.createOrder({
          localId: id, amountCents: input.amountCents, currency: goal.currency, hold,
          description: `Our Castle sandbox contribution toward ${goal.name}`, requestId: `create-${id}`,
        }));
      } catch (error) {
        if (error instanceof PayPalError) throw paypalFailure(row, error, 'PayPal sandbox could not create the order.');
        throw error;
      }
      const unit = data?.purchase_units?.[0];
      const echoOk = !unit?.amount || (unit.amount.currency_code === goal.currency && decimalStringToCents(unit.amount.value) === input.amountCents);
      if (!data?.id || !['CREATED', 'PAYER_ACTION_REQUIRED'].includes(data.status) || !echoOk) {
        setStatus(row, 'failed', 'PayPal returned an order that does not match the request.');
        throw new DomainError(502, 'provider_mismatch', 'PayPal returned an unexpected order. Nothing was charged or recorded.');
      }
      db.prepare("UPDATE payment_orders SET provider_order_id = ?, status = 'created', updated_at = ? WHERE id = ?").run(data.id, clock.iso(), id);
      // PayPal's own approval link, for API clients (e.g. the Postman collection). Only a sandbox URL is passed on.
      const link = (data.links ?? []).find((l) => ['payer-action', 'approve'].includes(l.rel))?.href ?? null;
      const approveUrl = link && /^https:\/\/www\.sandbox\.paypal\.com\//.test(link) ? link : null;
      return { orderId: data.id, approveUrl, contribution: view(id) };
    },

    /** Called after the buyer approves in PayPal. The capture result, not the callback, decides. */
    async capturePayPalOrder({ providerOrderId, householdId, goalId, assertAccess = () => {} }) {
      requireMode('sandbox');
      const row = ownedOrder(providerOrderId, householdId, goalId);
      assertAccess();
      if (SETTLED.has(row.status)) return result(row, 'already_completed');
      // A held order places its hold here instead of capturing. One that already holds, or is over, has nothing to place.
      const holding = Boolean(holdFor(row.id));
      if (holding && ['held', 'returned', 'lapsed'].includes(row.status)) return result(row, row.status);
      const caller = { assertAccess };
      let flight = inflight.get(row.id);
      if (!flight) {
        flight = { callers: new Set([caller]), work: null };
        inflight.set(row.id, flight);
        // Every caller already requested this same owned order. A still-authorized caller may keep the single
        // capture alive during OAuth; no new request, approval or retry is invented on another person's behalf.
        const assertDispatchAccess = () => {
          let refusal;
          for (const waiting of flight.callers) {
            try { waiting.assertAccess(); return; } catch (error) { refusal = error; }
          }
          throw refusal ?? new DomainError(409, 'capture_interrupted', 'This capture no longer has an active request. Check the contribution before trying again.');
        };
        flight.work = (async () => {
          let order;
          try {
            ({ data: order } = holding
              ? await paypal.authorizeOrder(providerOrderId, { requestId: `authorize-${row.id}`, assertAccess: assertDispatchAccess })
              : await paypal.captureOrder(providerOrderId, { requestId: `capture-${row.id}`, assertAccess: assertDispatchAccess }));
          } catch (error) {
            if (!(error instanceof PayPalError)) throw error;
            if (error.hasIssue(holding ? 'ORDER_ALREADY_AUTHORIZED' : 'ORDER_ALREADY_CAPTURED')) ({ data: order } = await paypal.getOrder(providerOrderId));
            else if (['INSTRUMENT_DECLINED', 'ORDER_NOT_APPROVED'].some((issue) => error.hasIssue(issue)) && SETTLED.has(orderById(row.id).status)) {
              // Another request (on a second server, say) captured and credited this order while this refusal was on its
              // way. Canonical state wins: a late refusal does not reopen a settled order.
              return result(row, 'already_completed');
            } else if (error.hasIssue('INSTRUMENT_DECLINED')) {
              setStatus(row, 'declined', 'The payment method was declined in PayPal sandbox. Try another sandbox funding source.');
              return result(row, 'declined');
            } else if (error.hasIssue('ORDER_NOT_APPROVED')) {
              setStatus(row, 'created', 'PayPal has not recorded an approval for this order yet.');
              return result(row, 'not_approved');
            } else if (outcomeUnknown(error)) {
              // The capture may have happened. Mark it unresolved, then settle from what PayPal holds for this same order;
              // never report it as failed. (2) A webhook may settle the order while we wait: canonical state is re-read.
              markUnresolved(row, holding ? UNRESOLVED_HOLD : UNRESOLVED);
              try { ({ data: order } = await paypal.getOrder(providerOrderId)); } catch (readError) {
                if (!(readError instanceof PayPalError)) throw readError;
                return result(row, SETTLED.has(orderById(row.id).status) ? 'already_completed' : 'unknown');
              }
            } else throw paypalFailure(row, error, holding ? 'PayPal sandbox could not place this hold.' : 'PayPal sandbox could not capture this order.');
          }
          return applyOrder(row, order);
        })().finally(() => { inflight.delete(row.id); });
      } else flight.callers.add(caller);
      try {
        let value;
        try { value = await flight.work; } catch (error) { assertAccess(); throw error; }
        // Shared provider truth never shares permission: each caller must still be allowed their own response.
        assertAccess();
        return value;
      } finally { flight.callers.delete(caller); }
    },

    /** Re-check an order (e.g. a pending capture) directly with PayPal. */
    async refreshPayPalOrder({ providerOrderId, householdId, goalId }) {
      requireMode('sandbox');
      const row = ownedOrder(providerOrderId, householdId, goalId);
      let order;
      try { ({ data: order } = await paypal.getOrder(providerOrderId)); } catch (error) {
        if (error instanceof PayPalError) {
          recordCheck(row, { outcome: 'unavailable', failure: 'PayPal did not answer this check. Nothing was changed.' });
          throw new DomainError(502, 'paypal_error', 'Could not check this order with PayPal sandbox.', { debugId: error.debugId });
        }
        throw error;
      }
      order = await withCurrentAuthorization(row, order);
      const applied = applyOrder(row, order, { explicit: true });
      const check = recordCheck(row, { order, outcome: applied.outcome });
      return { ...applied, contribution: view(row.id), check };
    },

    /** A closed window cannot override capture status or establish whether PayPal charged. */
    cancelPayPalOrder({ providerOrderId, householdId, goalId }) {
      requireMode('sandbox');
      const row = ownedOrder(providerOrderId, householdId, goalId);
      // SDK window events can arrive after capture/refund or while a capture is unresolved. They say nothing about
      // money: retain the canonical record and report it without another provider request or financial mutation.
      if (SETTLED.has(row.status)) return result(row, 'already_completed');
      if (row.status === 'pending') return result(row, 'pending');
      if (!['creating', 'created', 'approval_canceled'].includes(row.status)) return result(row, 'record_unchanged');
      if (['creating', 'created'].includes(row.status)) setStatus(row, 'approval_canceled', 'The PayPal window was closed. Check this contribution’s status before trying again.');
      return result(row, 'canceled');
    },

    async refundPayPalCapture(input) {
      requireMode('sandbox');
      const { cap, refundable } = refundPreconditions(input, 'paypal-sandbox');
      input.assertAccess?.();
      const count = db.prepare('SELECT COUNT(*) AS n FROM payment_refunds WHERE capture_id = ?').get(cap.capture_id).n;
      let data;
      try {
        ({ data } = await paypal.refundCapture(cap.capture_id, { amountCents: refundable, currency: cap.currency, requestId: `refund-${cap.capture_id}-${count + 1}`, assertAccess: input.assertAccess }));
      } catch (error) {
        if (error instanceof PayPalError && outcomeUnknown(error)) {
          // The refund may have happened. Nothing is recorded here. A retry keeps the same PayPal-Request-Id, but PayPal
          // keeps request ids only for a limited time, so the adult is asked to check PayPal first rather than promised safety.
          throw new DomainError(502, 'paypal_unknown', 'PayPal did not confirm this refund, so it may or may not have happened. Progress was not changed here. Check this capture in PayPal before trying again.', { debugId: error.debugId });
        }
        if (error instanceof PayPalError) throw new DomainError(502, 'paypal_error', 'PayPal sandbox could not refund this capture. Progress was not changed.', { debugId: error.debugId, issues: error.issues });
        throw error;
      }
      return refundResult(applyRefund({
        refundId: data?.id,
        captureId: cap.capture_id,
        amountCents: decimalStringToCents(data?.amount?.value) ?? refundable,
        currency: data?.amount?.currency_code ?? cap.currency,
        status: data?.status,
      }));
    },

    /**
     * An adult releases an exact amount of a hold, checked and credited like any other capture. By default the release
     * is final and whatever it does not take goes back to the payer. With `keepRest`, the rest stays held for a later
     * release or a return; the last of at most MAX_RELEASES releases is always final. Works for a simulated hold too.
     */
    async releaseHold(input) {
      const { row, hold, step, replay } = holdDecision(input, 'release');
      if (replay) return result(row, replayOutcome(row, step));
      const amountCents = step.amount_cents;
      const final = step.final === 1;
      if (row.provider === 'simulated') return credit(row, `SIM-CAPTURE-${row.id.slice(4, 16).toUpperCase()}${step.seq > 1 ? `-${step.seq}` : ''}`, amountCents, row.currency);
      // The same release decided again (the same amount, from the same released total, final or not, on the same
      // authorization) goes to PayPal as the very same request. A new attempt after an unanswered one can therefore
      // never capture twice: PayPal answers it with what the first one did. A first final release keeps the id it always had.
      const paypalRequestId = `release-${row.id}-${amountCents}${hold.released_cents ? `-after-${hold.released_cents}` : ''}${final ? '' : '-keep'}${hold.original_authorization_id ? '-extended' : ''}`;
      let data;
      try {
        input.assertAccess?.();
        ({ data } = await paypal.captureAuthorization(hold.authorization_id, { amountCents, currency: row.currency, final, requestId: paypalRequestId, assertAccess: input.assertAccess }));
      } catch (error) {
        if (!(error instanceof PayPalError)) { reopenHold(row); throw error; } // refused here, before anything was sent
        if (outcomeUnknown(error)) {
          markUnresolved(row, 'PayPal did not confirm this release in time, so its outcome is not known yet. Nothing was credited; check with PayPal.');
          return result(row, 'unknown');
        }
        if (error.hasIssue('AUTHORIZATION_VOIDED')) {
          endHold(row, 'returned', endNote(row, 'returned', { earlier: ' already, PayPal reports' }));
          return result(row, 'returned');
        }
        if (error.hasIssue('AUTHORIZATION_EXPIRED')) {
          endHold(row, 'lapsed', endNote(row, 'lapsed', { earlier: ' before it was released' }));
          return result(row, 'lapsed');
        }
        if (error.hasIssue('AUTHORIZATION_ALREADY_CAPTURED')) {
          // Captured by an earlier attempt whose answer was lost, or outside this app: settle from PayPal's own order.
          let order;
          try { ({ data: order } = await paypal.getOrder(row.provider_order_id)); } catch (readError) {
            if (!(readError instanceof PayPalError)) throw readError;
            markUnresolved(row, 'PayPal reports this hold was already captured, but did not return the order. Nothing was credited; check with PayPal.');
            return result(row, 'unknown');
          }
          return applyOrder(row, order);
        }
        reopenHold(row);
        throw new DomainError(502, 'paypal_error', 'PayPal sandbox could not release this hold. Nothing was credited, and the hold is unchanged.', { debugId: error.debugId, issues: error.issues });
      }
      const applied = applyCapture(row, data, row.id);
      if (applied.outcome === 'declined') {
        // PayPal refused this capture outright: the release did not happen, and the hold is open again.
        reopenHold(row);
        setHoldDetail(row, 'PayPal declined this release. Nothing was credited, and the hold is unchanged.');
        return result(row, 'declined');
      }
      return applied;
    },

    /** An adult returns what is still held: a void. Nothing more is charged or credited; a part released earlier still counts. */
    async returnHold(input) {
      const { row, step, replay } = holdDecision(input, 'return');
      if (replay) return result(row, replayOutcome(row, step));
      const hold = holdFor(row.id);
      const returned = () => {
        endHold(row, 'returned', endNote(row, 'returned'));
        return result(row, 'returned');
      };
      if (row.provider === 'simulated') return returned();
      try {
        input.assertAccess?.();
        // PayPal refuses to void a reauthorization (CANNOT_BE_VOIDED: "Please void the original parent authorization"),
        // so an extended hold is returned through the authorization it was first placed under.
        await paypal.voidAuthorization(hold.original_authorization_id ?? hold.authorization_id, { requestId: `return-${row.id}`, assertAccess: input.assertAccess });
      } catch (error) {
        if (!(error instanceof PayPalError)) { reopenHold(row); throw error; }
        if (outcomeUnknown(error)) {
          markUnresolved(row, 'PayPal did not confirm this return in time, so its outcome is not known yet. Check with PayPal.');
          return result(row, 'unknown');
        }
        if (error.hasIssue('PREVIOUSLY_VOIDED')) return returned();
        if (error.hasIssue('PREVIOUSLY_CAPTURED')) {
          // Money was captured outside this decision. It is checked like any capture and never credited on its own.
          let order;
          try { ({ data: order } = await paypal.getOrder(row.provider_order_id)); } catch (readError) {
            if (!(readError instanceof PayPalError)) throw readError;
            markUnresolved(row, 'PayPal reports this hold was captured, not returned, but did not return the order. Check with PayPal.');
            return result(row, 'unknown');
          }
          return applyOrder(row, order);
        }
        reopenHold(row);
        throw new DomainError(502, 'paypal_error', 'PayPal sandbox could not return this hold. Nothing was changed.', { debugId: error.debugId, issues: error.issues });
      }
      return returned();
    },

    /**
     * An adult extends a hold once, after PayPal's three-day guarantee ends and before the authorization expires: a
     * reauthorization for exactly the amount held. PayPal answers with a new authorization, which later captures use.
     * Nothing is credited. An extension whose answer was lost can be asked for again as the very same PayPal request.
     */
    async extendHold(input) {
      const { row, hold, step, replay } = holdDecision(input, 'extend');
      if (replay && step?.state !== 'sent') return result(row, replayOutcome(row, step));
      if (row.provider === 'simulated') {
        return applyExtension(row, { id: `SIM-AUTH-${row.id.slice(4, 16).toUpperCase()}-${step.seq}`, status: 'CREATED',
          amount: { currency_code: row.currency, value: centsToDecimalString(hold.held_cents) }, custom_id: row.id }, row.id);
      }
      let data;
      try {
        input.assertAccess?.();
        ({ data } = await paypal.reauthorizeAuthorization(hold.authorization_id, { amountCents: hold.held_cents, currency: row.currency, requestId: `extend-${row.id}-${step.seq}`, assertAccess: input.assertAccess }));
      } catch (error) {
        if (!(error instanceof PayPalError)) { failOpenStep(row.id); throw error; } // refused here, before anything was sent
        if (outcomeUnknown(error)) {
          setHoldDetail(row, 'PayPal did not confirm the extension in time, so it is not known yet whether it happened. Ask to extend it again: PayPal answers the same request with what it did. Nothing was charged.');
          return result(row, 'unknown');
        }
        if (error.hasIssue('AUTHORIZATION_EXPIRED')) {
          endHold(row, 'lapsed', endNote(row, 'lapsed', { earlier: ' before it could be extended' }));
          return result(row, 'lapsed');
        }
        if (error.hasIssue('AUTHORIZATION_VOIDED')) {
          endHold(row, 'returned', endNote(row, 'returned', { earlier: ' already, PayPal reports' }));
          return result(row, 'returned');
        }
        failOpenStep(row.id);
        throw new DomainError(502, 'paypal_error', `PayPal sandbox could not extend this hold. Nothing changed: it is still held${hold.expires_at ? ` until ${dayText(hold.expires_at)}` : ''}.`, { debugId: error.debugId, issues: error.issues });
      }
      return applyExtension(row, data, row.id);
    },

    /** Verified PayPal webhooks: capture completion/denial and refunds, each processed once. */
    async handleWebhook({ headers, rawBody }) {
      requireMode('sandbox');
      if (!webhookId) throw new DomainError(503, 'webhooks_not_configured', 'Set PAYPAL_WEBHOOK_ID in .env to accept webhooks. Unverified events are never processed.');
      let event;
      try { event = JSON.parse(rawBody); } catch { throw new DomainError(400, 'invalid_json', 'Webhook body is not JSON.'); }
      let verified = false;
      try { verified = await paypal.verifyWebhookSignature({ headers, rawBody, event, webhookId }); } catch (error) {
        if (error instanceof PayPalError) throw new DomainError(502, 'paypal_error', 'Could not verify the webhook with PayPal.', { debugId: error.debugId });
        throw error;
      }
      if (!verified) throw new DomainError(400, 'invalid_signature', 'Webhook signature verification failed. The event was ignored.');
      if (typeof event?.id !== 'string' || typeof event?.event_type !== 'string') throw new DomainError(400, 'invalid_event', 'Webhook event is missing an id or type.');
      if (db.prepare('SELECT 1 FROM webhook_events WHERE event_id = ?').get(event.id)) return { outcome: 'duplicate_event' };

      const resource = event.resource ?? {};
      let outcome = 'ignored';
      if (['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.DECLINED'].includes(event.event_type)) {
        // The order mapping is server-owned. An event that names a PayPal order must name the one this server created for
        // the contribution; a capture of some other order is never credited here, even if it carries our custom_id. Only
        // an event that names no order at all falls back to our own contribution id in custom_id.
        const orderId = resource.supplementary_data?.related_ids?.order_id;
        const row = typeof orderId === 'string' ? orderByProviderId(orderId) : resource.custom_id ? orderById(resource.custom_id) : null;
        if (!row || row.provider !== 'paypal-sandbox') outcome = 'ignored_unknown_order';
        // A verified event that names our own order id may omit custom_id.
        else outcome = applyCapture(row, resource, orderId ? row.id : null).outcome;
      } else if (['PAYMENT.AUTHORIZATION.CREATED', 'PAYMENT.AUTHORIZATION.VOIDED'].includes(event.event_type)) {
        // The same server-owned mapping as captures. Only an order this server created as a hold is touched, and an
        // authorization never credits anything.
        const orderId = resource.supplementary_data?.related_ids?.order_id;
        const row = typeof orderId === 'string' ? orderByProviderId(orderId) : resource.custom_id ? orderById(resource.custom_id) : null;
        if (!row || row.provider !== 'paypal-sandbox' || !holdFor(row.id)) outcome = 'ignored_unknown_order';
        else outcome = applyAuthorization(row, resource, orderId ? row.id : null).outcome;
      } else if (['PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED'].includes(event.event_type)) {
        const up = (resource.links ?? []).find((l) => l.rel === 'up')?.href ?? '';
        const captureId = /\/captures\/([^/?#]+)/.exec(up)?.[1];
        outcome = captureId
          ? applyRefund({
            refundId: resource.id,
            captureId: decodeURIComponent(captureId),
            amountCents: decimalStringToCents(resource.amount?.value),
            currency: resource.amount?.currency_code,
            status: resource.status ?? 'COMPLETED',
          }).outcome
          : 'ignored_unknown_capture';
      }
      db.prepare('INSERT INTO webhook_events (event_id, event_type, received_at, outcome) VALUES (?, ?, ?, ?) ON CONFLICT(event_id) DO NOTHING')
        .run(event.id, event.event_type, clock.iso(), outcome);
      return { outcome };
    },

    async clientToken({ domains }) {
      requireMode('sandbox');
      try { return await paypal.generateClientToken({ domains }); } catch (error) {
        if (error instanceof PayPalError) throw new DomainError(502, 'paypal_error', 'Could not create a PayPal sandbox client token.', { debugId: error.debugId });
        throw error;
      }
    },

    // ---- Example mode: labeled simulations that run the same crediting pipeline. ----

    simulateContribution(input) {
      requireMode('example');
      const existing = priorRequest(input.requestId);
      if (existing) {
        if (!sameRequest(existing, input, 'simulated')) throw new DomainError(409, 'request_conflict', 'That request id was already used for a different contribution.');
        return result(existing, 'already_processed');
      }
      const { goal } = validateRequest(input);
      const id = newId('ctb');
      const tag = id.slice(4, 16).toUpperCase();
      const row = insertOrder({ id, provider: 'simulated', providerOrderId: `SIM-ORDER-${tag}`, input, goal, status: 'created' });
      if (input.hold === true) {
        // The same hold, labeled as simulated, with PayPal's timing: guaranteed for three days, over after 29.
        // Nothing is credited until an adult releases or returns it.
        const now = clock.now().getTime();
        insertHold(row.id, row.amount_cents, 'held', `SIM-AUTH-${tag}`, { honorUntil: new Date(now + HONOR_MS).toISOString(), expiresAt: new Date(now + SIMULATED_HOLD_MS).toISOString() });
        setStatus(row, 'held', `Simulated: ${formatCents(row.amount_cents, row.currency)} is held. Nothing is credited until an adult releases or returns it.`);
        return result(row, 'held');
      }
      const outcome = input.outcome ?? 'completed';
      if (outcome === 'completed') return credit(row, `SIM-CAPTURE-${tag}`, row.amount_cents, row.currency);
      if (outcome === 'pending') {
        upsertCapture(row, `SIM-CAPTURE-${tag}`, row.amount_cents, row.currency, 'PENDING');
        setStatus(row, 'pending', 'Simulated: the capture is pending, so no progress was recorded yet.');
        return result(row, 'pending');
      }
      if (outcome === 'canceled') {
        setStatus(row, 'approval_canceled', 'Simulated: the approver closed the payment window. Nothing was charged.');
        return result(row, 'canceled');
      }
      if (outcome === 'failed') {
        setStatus(row, 'declined', 'Simulated: the payment method was declined. No progress was recorded.');
        return result(row, 'declined');
      }
      throw new DomainError(400, 'invalid_outcome', 'Unknown simulated outcome.');
    },

    completeSimulatedPending({ contributionId, householdId }) {
      requireMode('example');
      const row = orderById(contributionId);
      if (!row || row.provider !== 'simulated' || row.household_id !== householdId) throw new DomainError(404, 'unknown_order', 'Unknown contribution.');
      if (SETTLED.has(row.status)) return result(row, 'already_completed');
      const pending = db.prepare("SELECT * FROM payment_captures WHERE order_id = ? AND status = 'PENDING'").get(row.id);
      if (!pending) throw new DomainError(409, 'not_pending', 'This contribution is not pending.');
      return credit(row, pending.capture_id, pending.amount_cents, pending.currency);
    },

    simulateRefund(input) {
      requireMode('example');
      const { cap, refundable } = refundPreconditions(input, 'simulated');
      const count = db.prepare('SELECT COUNT(*) AS n FROM payment_refunds WHERE capture_id = ?').get(cap.capture_id).n;
      return refundResult(applyRefund({
        refundId: `SIM-REFUND-${cap.capture_id.slice(12)}-${count + 1}`,
        captureId: cap.capture_id,
        amountCents: refundable,
        currency: cap.currency,
        status: 'COMPLETED',
      }));
    },

    contributions(goalId) {
      return db.prepare("SELECT id FROM payment_orders WHERE goal_id = ? AND status != 'creating' ORDER BY created_at DESC, rowid DESC").all(goalId).map((r) => view(r.id));
    },
  };
}
