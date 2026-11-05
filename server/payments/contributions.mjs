import { transaction } from '../db.mjs';
import {
  DomainError, awardTierMilestones, getGoal, getHousehold, getMember, newId, progressFor,
} from '../household.mjs';
import { decimalStringToCents, formatCents } from '../../src/core/rules.js';
import { PayPalError } from './paypal-client.mjs';

export const MIN_CONTRIBUTION_CENTS = 100;
export const MAX_CONTRIBUTION_CENTS = 50_000;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const SETTLED = new Set(['completed', 'refunded', 'partially_refunded']);

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
  const captureById = (id) => db.prepare('SELECT * FROM payment_captures WHERE capture_id = ?').get(id);

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
    return {
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
    };
  }

  function result(row, outcome, extra = {}) {
    return { outcome, contribution: view(row.id), progress: progressFor(db, row.goal_id), awarded: [], ...extra };
  }

  /** Validate an adult-approved contribution request against the server's own records. */
  function validateRequest({ householdId, goalId, amountCents, approverId, approvalConfirmed, requestId }) {
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
      db.prepare("UPDATE payment_orders SET status = 'completed', status_detail = NULL, updated_at = ? WHERE id = ?").run(at, row.id);
      return { duplicate: false, awarded: awardTierMilestones(db, getGoal(db, row.goal_id), at) };
    });
    return result(row, outcome.duplicate ? 'already_completed' : 'completed', { awarded: outcome.awarded });
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
    if (amountCents !== row.amount_cents || currency !== row.currency || customId !== row.id) {
      if (!SETTLED.has(orderById(row.id).status)) {
        setStatus(row, 'rejected', `Capture ${capture.id} did not match the expected ${formatCents(row.amount_cents, row.currency)} ${row.currency} for this goal. No progress was recorded.`);
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
      case 'DECLINED':
      case 'DENIED':
      case 'FAILED':
        upsertCapture(row, capture.id, amountCents, currency, capture.status);
        if (!SETTLED.has(orderById(row.id).status)) setStatus(row, 'declined', 'PayPal declined this capture. No progress was recorded.');
        return result(row, 'declined');
      default: {
        // e.g. REFUNDED before we ever saw COMPLETED: never credit retroactively.
        upsertCapture(row, capture.id, amountCents, currency, String(capture.status));
        if (!SETTLED.has(orderById(row.id).status)) setStatus(row, 'failed', `Unexpected capture status ${capture.status}. No progress was recorded.`);
        return result(row, 'not_credited');
      }
    }
  }

  function applyOrder(row, order) {
    if (!order || order.id !== row.provider_order_id) {
      setStatus(row, 'failed', 'PayPal returned a different order than expected. No progress was recorded.');
      return result(row, 'rejected_mismatch');
    }
    const unit = (order.purchase_units ?? []).find((u) => u.reference_id === row.id);
    if (!unit) {
      setStatus(row, 'failed', 'The PayPal order did not contain this contribution. No progress was recorded.');
      return result(row, 'rejected_mismatch');
    }
    const capture = unit.payments?.captures?.[0];
    if (!capture) {
      // An unresolved capture attempt (marked pending after PayPal did not answer) stays pending and recheckable until a
      // capture bound to this order is confirmed; a read that still shows none does not hide the recovery action.
      if (orderById(row.id).status === 'pending') return result(row, 'unknown');
      if (order.status === 'APPROVED') setStatus(row, 'created', 'Approved in PayPal but not captured yet.');
      return result(row, 'not_captured');
    }
    return applyCapture(row, capture, unit.custom_id);
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
  function markUnresolved(row) {
    if (!SETTLED.has(orderById(row.id).status)) setStatus(row, 'pending', UNRESOLVED);
  }

  function paypalFailure(row, error, message) {
    if (row && !SETTLED.has(orderById(row.id)?.status)) setStatus(row, 'failed', `${message} (${error.paypalName ?? error.status ?? 'error'})`);
    return new DomainError(502, 'paypal_error', `${message} No progress was recorded.`, { debugId: error.debugId, issues: error.issues });
  }

  /** Record a provider refund once, reversing only progress that was actually credited. */
  function applyRefund({ refundId, captureId, amountCents, currency, status }) {
    return transaction(db, () => {
      const cap = captureById(captureId);
      if (!cap) return { outcome: 'ignored_unknown_capture' };
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
      db.prepare('UPDATE payment_orders SET status = ?, status_detail = ?, updated_at = ? WHERE id = ?')
        .run(full ? 'refunded' : 'partially_refunded', `${formatCents(refunded, currency)} refunded; progress reduced by the same amount.`, at, row.id);
      return { outcome: 'refunded', row };
    });
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
    const refundable = cap.amount_cents - cap.refunded_cents;
    if (refundable <= 0) throw new DomainError(409, 'already_refunded', 'This contribution was already refunded.');
    return { cap, row, refundable };
  }

  return {
    mode,

    async createPayPalOrder(input) {
      requireMode('sandbox');
      const existing = orderByRequestId(input.requestId);
      if (existing) {
        if (!sameRequest(existing, input, 'paypal-sandbox')) throw new DomainError(409, 'request_conflict', 'That request id was already used for a different contribution.');
        if (existing.provider_order_id) return { orderId: existing.provider_order_id, approveUrl: null, contribution: view(existing.id) };
        throw new DomainError(409, 'in_progress', 'This contribution is already being created.');
      }
      const { goal } = validateRequest(input);
      const id = newId('ctb');
      const row = insertOrder({ id, provider: 'paypal-sandbox', providerOrderId: null, input, goal, status: 'creating' });
      let data;
      try {
        ({ data } = await paypal.createOrder({
          localId: id, amountCents: input.amountCents, currency: goal.currency,
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
    async capturePayPalOrder({ providerOrderId, householdId, goalId }) {
      requireMode('sandbox');
      const row = ownedOrder(providerOrderId, householdId, goalId);
      if (SETTLED.has(row.status)) return result(row, 'already_completed');
      if (inflight.has(row.id)) return inflight.get(row.id);
      const work = (async () => {
        let order;
        try {
          ({ data: order } = await paypal.captureOrder(providerOrderId, { requestId: `capture-${row.id}` }));
        } catch (error) {
          if (!(error instanceof PayPalError)) throw error;
          if (error.hasIssue('ORDER_ALREADY_CAPTURED')) ({ data: order } = await paypal.getOrder(providerOrderId));
          else if (error.hasIssue('INSTRUMENT_DECLINED')) {
            setStatus(row, 'declined', 'The payment method was declined in PayPal sandbox. Try another sandbox funding source.');
            return result(row, 'declined');
          } else if (error.hasIssue('ORDER_NOT_APPROVED')) {
            setStatus(row, 'created', 'PayPal has not recorded an approval for this order yet.');
            return result(row, 'not_approved');
          } else if (outcomeUnknown(error)) {
            // The capture may have happened. Mark it unresolved, then settle from what PayPal holds for this same order;
            // never report it as failed. (2) A webhook may settle the order while we wait: canonical state is re-read.
            markUnresolved(row);
            try { ({ data: order } = await paypal.getOrder(providerOrderId)); } catch (readError) {
              if (!(readError instanceof PayPalError)) throw readError;
              return result(row, SETTLED.has(orderById(row.id).status) ? 'already_completed' : 'unknown');
            }
          } else throw paypalFailure(row, error, 'PayPal sandbox could not capture this order.');
        }
        return applyOrder(row, order);
      })();
      inflight.set(row.id, work);
      try { return await work; } finally { inflight.delete(row.id); }
    },

    /** Re-check an order (e.g. a pending capture) directly with PayPal. */
    async refreshPayPalOrder({ providerOrderId, householdId, goalId }) {
      requireMode('sandbox');
      const row = ownedOrder(providerOrderId, householdId, goalId);
      let order;
      try { ({ data: order } = await paypal.getOrder(providerOrderId)); } catch (error) {
        if (error instanceof PayPalError) throw new DomainError(502, 'paypal_error', 'Could not check this order with PayPal sandbox.', { debugId: error.debugId });
        throw error;
      }
      return applyOrder(row, order);
    },

    /** The buyer closed PayPal. Harmless to trust: it can only mark an uncaptured order canceled. */
    cancelPayPalOrder({ providerOrderId, householdId, goalId }) {
      requireMode('sandbox');
      const row = ownedOrder(providerOrderId, householdId, goalId);
      if (['creating', 'created'].includes(row.status)) setStatus(row, 'approval_canceled', 'The approver closed PayPal without paying. Nothing was charged.');
      return result(row, 'canceled');
    },

    async refundPayPalCapture(input) {
      requireMode('sandbox');
      const { cap, refundable } = refundPreconditions(input, 'paypal-sandbox');
      const count = db.prepare('SELECT COUNT(*) AS n FROM payment_refunds WHERE capture_id = ?').get(cap.capture_id).n;
      let data;
      try {
        ({ data } = await paypal.refundCapture(cap.capture_id, { amountCents: refundable, currency: cap.currency, requestId: `refund-${cap.capture_id}-${count + 1}` }));
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

    /** Verified PayPal webhooks: capture completion/denial and refunds, each processed once. */
    async handleWebhook({ headers, rawBody }) {
      requireMode('sandbox');
      if (!webhookId) throw new DomainError(503, 'webhooks_not_configured', 'Set PAYPAL_WEBHOOK_ID in .env to accept webhooks. Unverified events are never processed.');
      let event;
      try { event = JSON.parse(rawBody); } catch { throw new DomainError(400, 'invalid_json', 'Webhook body is not JSON.'); }
      let verified = false;
      try { verified = await paypal.verifyWebhookSignature({ headers, event, webhookId }); } catch (error) {
        if (error instanceof PayPalError) throw new DomainError(502, 'paypal_error', 'Could not verify the webhook with PayPal.');
        throw error;
      }
      if (!verified) throw new DomainError(400, 'invalid_signature', 'Webhook signature verification failed. The event was ignored.');
      if (typeof event?.id !== 'string' || typeof event?.event_type !== 'string') throw new DomainError(400, 'invalid_event', 'Webhook event is missing an id or type.');
      if (db.prepare('SELECT 1 FROM webhook_events WHERE event_id = ?').get(event.id)) return { outcome: 'duplicate_event' };

      const resource = event.resource ?? {};
      let outcome = 'ignored';
      if (['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.DECLINED'].includes(event.event_type)) {
        const orderId = resource.supplementary_data?.related_ids?.order_id;
        const row = (orderId && orderByProviderId(orderId)) || (resource.custom_id && orderById(resource.custom_id)) || null;
        if (!row || row.provider !== 'paypal-sandbox') outcome = 'ignored_unknown_order';
        // A verified event that names our own order id may omit custom_id; the order mapping is server-owned.
        else outcome = applyCapture(row, resource, orderId && row.provider_order_id === orderId ? row.id : null).outcome;
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
        if (error instanceof PayPalError) throw new DomainError(502, 'paypal_error', 'Could not create a PayPal sandbox client token.');
        throw error;
      }
    },

    // ---- Example mode: labeled simulations that run the same crediting pipeline. ----

    simulateContribution(input) {
      requireMode('example');
      const existing = orderByRequestId(input.requestId);
      if (existing) {
        if (!sameRequest(existing, input, 'simulated')) throw new DomainError(409, 'request_conflict', 'That request id was already used for a different contribution.');
        return result(existing, 'already_processed');
      }
      const { goal } = validateRequest(input);
      const id = newId('ctb');
      const tag = id.slice(4, 16).toUpperCase();
      const row = insertOrder({ id, provider: 'simulated', providerOrderId: `SIM-ORDER-${tag}`, input, goal, status: 'created' });
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
