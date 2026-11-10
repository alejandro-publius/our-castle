import { randomUUID } from 'node:crypto';
import { DomainError, getMember } from '../household.mjs';
import { transaction } from '../db.mjs';
import { decimalStringToCents } from '../../src/core/rules.js';
import { PayPalError } from './paypal-client.mjs';
import { paypalRecipient, samePayPalRecipient } from './recipient.mjs';

export function ensureVillagePaymentsSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS village_payment_intents (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, fund_id TEXT NOT NULL REFERENCES village_funds(id) ON DELETE CASCADE,
    household_id TEXT NOT NULL, member_id TEXT NOT NULL, source TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK(amount_minor > 0), currency TEXT NOT NULL,
    recipient_json TEXT NOT NULL, fund_revision INTEGER NOT NULL, target_minor INTEGER NOT NULL,
    provider_order_id TEXT UNIQUE, approve_url TEXT, capture_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('creating','created','pending','completed')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS village_payment_fund ON village_payment_intents(fund_id,status);`);
}

const fail = (status, code, message) => new DomainError(status, code, message);
const requestPattern = /^[A-Za-z0-9_-]{8,128}$/;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const recipientOf = context => context.rail === 'paypal-sandbox' ? paypalRecipient(context.recipient) : null;
const externalId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function safeApprovalLink(value) {
  if (typeof value !== 'string') return null;
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'www.sandbox.paypal.com'
    && !u.username && !u.password && !u.port ? u.href : null; } catch { return null; }
}

/** Receives only authenticated application scopes and server-owned fund contexts. Never owns household money. */
export function createVillagePayments({ db, clock, paypal = null, contextFor, recordReceipt }) {
  if (typeof contextFor !== 'function' || typeof recordReceipt !== 'function') throw new TypeError('Village domain callbacks are required.');
  const flights = new Map();
  const rowFor = id => typeof id === 'string' ? db.prepare('SELECT * FROM village_payment_intents WHERE id=?').get(id) : null;
  const view = row => ({ id: row.id, fundId: row.fund_id, source: row.source, amountMinor: row.amount_minor, currency: row.currency,
    recipient: JSON.parse(row.recipient_json), revision: row.fund_revision, status: row.status,
    providerOrderId: row.provider_order_id, captureId: row.capture_id, approveUrl: row.approve_url,
    label: row.source === 'simulated' ? 'Simulated contribution' : 'PayPal sandbox contribution',
    refundAction: row.source === 'paypal-sandbox' ? 'The organizer manages refunds in PayPal; this app can check their result.' : null,
    createdAt: row.created_at });
  function scopeOf({ scope, actor }) {
    const memberId = scope?.memberId ?? actor?.memberId;
    if (typeof scope?.householdId !== 'string' || typeof memberId !== 'string') throw fail(403, 'adult_required', 'A signed-in adult must approve this contribution.');
    const member = getMember(db, scope.householdId, memberId);
    if (!member || member.role !== 'adult') throw fail(403, 'adult_required', 'A signed-in adult must approve this contribution.');
    return { ...scope, memberId, role: 'adult' };
  }
  function context(scope, fundId, allowSettled = false) {
    const c = contextFor(scope, fundId, { allowSettled });
    if (!c || (c.fundId ?? c.id) !== fundId || !['simulated','paypal-sandbox'].includes(c.rail)
      || c.currency !== 'USD' || c.decimals !== 2 || !Number.isSafeInteger(c.revision)) {
      throw fail(409, 'village_payment_rail', 'Use the fund’s configured contribution method.');
    }
    if (c.rail === 'paypal-sandbox' && !recipientOf(c)) throw fail(409, 'recipient_missing', 'The organizer has not configured a sandbox recipient.');
    return c;
  }
  function owned(input) {
    const scope = scopeOf(input), row = rowFor(input.orderId);
    if (!row || row.household_id !== scope.householdId || row.member_id !== scope.memberId) throw fail(404, 'village_order', 'Contribution not found for this adult.');
    const c = context(scope, row.fund_id, true);
    if (row.source !== c.rail || row.currency !== c.currency || row.target_minor !== c.targetMinor || !same(JSON.parse(row.recipient_json), recipientOf(c))) {
      throw fail(409, 'recipient_changed', 'The contribution’s destination changed. Do not approve this order.');
    }
    return { scope, row, context: c };
  }
  function setStatus(row, status) {
    db.prepare("UPDATE village_payment_intents SET status=?,updated_at=? WHERE id=? AND status!='completed'").run(status, clock.iso(), row.id);
  }
  async function flight(key, assertAccess, work) {
    const caller = { assertAccess }, existing = flights.get(key);
    const f = existing ?? { callers: new Set(), promise: null };
    f.callers.add(caller);
    if (!existing) {
      flights.set(key, f);
      const guard = () => {
        let error;
        for (const c of f.callers) { try { c.assertAccess(); return; } catch (e) { error = e; } }
        throw error ?? fail(403, 'access_ended', 'This approval no longer has an active session.');
      };
      f.promise = Promise.resolve().then(() => { guard(); return work(guard); }).finally(() => flights.delete(key));
    }
    try { const out = await f.promise; assertAccess(); return out; } finally { f.callers.delete(caller); }
  }
  function validateOrder(row, order, { captured = false } = {}) {
    const units = order?.purchase_units;
    const unit = Array.isArray(units) && units.length === 1 ? units[0] : null;
    const recipient = JSON.parse(row.recipient_json);
    if (!externalId(order?.id) || (row.provider_order_id && order.id !== row.provider_order_id) || !unit
      || unit.reference_id !== row.id || unit.custom_id !== row.id || !samePayPalRecipient(unit, recipient)
      || unit.amount?.currency_code !== row.currency || decimalStringToCents(unit.amount?.value) !== row.amount_minor) {
      throw fail(502, 'village_provider_mismatch', 'PayPal did not match the approved fund, recipient and amount. Nothing was credited.');
    }
    if (!captured) return unit;
    const captures = unit.payments?.captures;
    const cap = Array.isArray(captures) && captures.length === 1 ? captures[0] : null;
    if (order.status !== 'COMPLETED' || !cap || !externalId(cap.id)
      || (row.capture_id && cap.id !== row.capture_id)
      || !['COMPLETED','PARTIALLY_REFUNDED','REFUNDED'].includes(cap.status)
      || cap.amount?.currency_code !== row.currency || decimalStringToCents(cap.amount?.value) !== row.amount_minor
      || (cap.custom_id !== undefined && cap.custom_id !== row.id)) return null;
    return { unit, cap };
  }
  function reconcile(row, order) {
    const confirmed = validateOrder(row, order, { captured: true });
    if (!confirmed) { setStatus(row, 'pending'); return { contribution: view(rowFor(row.id)), changedHouseholds: [] }; }
    const { unit, cap } = confirmed, seen = new Set();
    const refunds = (unit.payments?.refunds ?? []).filter(r => r.status === 'COMPLETED').map(r => {
      const amount = decimalStringToCents(r.amount?.value), up = (r.links ?? []).find(l => l.rel === 'up')?.href;
      if (!externalId(r.id) || seen.has(r.id) || !Number.isSafeInteger(amount) || amount <= 0 || r.amount.currency_code !== row.currency
        || (up && !up.endsWith(`/captures/${cap.id}`))) throw fail(502, 'village_refund_mismatch', 'PayPal refund evidence does not match this contribution.');
      seen.add(r.id); return { id: r.id, amount };
    });
    const refunded = refunds.reduce((n, r) => n + r.amount, 0);
    if (!Number.isSafeInteger(refunded) || refunded > row.amount_minor
      || (cap.status === 'REFUNDED' && refunded !== row.amount_minor)
      || (cap.status === 'PARTIALLY_REFUNDED' && !(refunded > 0 && refunded < row.amount_minor))) {
      throw fail(502, 'village_refund_incomplete', 'Check the organizer’s complete refund record before counting this contribution.');
    }
    return transaction(db, () => {
      const base = { fundId: row.fund_id, source: row.source, recipient: JSON.parse(row.recipient_json), familyHouseholdId: row.household_id, at: clock.iso() };
      const changed = new Set();
      // Refund-first recording prevents a delayed completion briefly constructing a refunded project.
      for (const r of refunds) for (const id of recordReceipt({ ...base, eventRef: r.id, kind: 'refund', parentRef: cap.id, amountMinor: r.amount }).changedHouseholds ?? []) changed.add(id);
      const receipt = recordReceipt({ ...base, eventRef: cap.id, kind: 'capture', amountMinor: row.amount_minor });
      for (const id of receipt.changedHouseholds ?? []) changed.add(id);
      db.prepare("UPDATE village_payment_intents SET status='completed',capture_id=?,updated_at=? WHERE id=?").run(cap.id, clock.iso(), row.id);
      return { contribution: view(rowFor(row.id)), receipt: receipt.receipt, changedHouseholds: [...changed] };
    });
  }
  return {
    async create(input) {
      const scope = scopeOf(input), guard = input.assertAccess ?? (() => {});
      guard();
      if (input.approvalConfirmed !== true) throw fail(400, 'approval_required', 'Review the exact amount and confirm the contribution.');
      if (!requestPattern.test(input.requestId ?? '') || typeof input.requestId !== 'string') throw fail(400, 'request_id', 'Use a fresh contribution request reference.');
      if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 100 || input.amountMinor > 1_000_000) throw fail(400, 'amount_invalid', 'Choose a contribution from $1 to $10,000.');
      const row = transaction(db, () => {
        const prior = db.prepare('SELECT * FROM village_payment_intents WHERE request_id=?').get(input.requestId);
        const c = context(scope, input.fundId, Boolean(prior)), recipient = recipientOf(c);
        if (prior) {
          if (prior.fund_id !== input.fundId || prior.household_id !== scope.householdId || prior.member_id !== scope.memberId
            || prior.amount_minor !== input.amountMinor || prior.source !== c.rail || prior.currency !== c.currency
            || prior.fund_revision !== input.expectedRevision || prior.target_minor !== c.targetMinor || !same(JSON.parse(prior.recipient_json), recipient)) throw fail(409, 'request_conflict', 'That request reference belongs to a different approval.');
          return prior;
        }
        if (input.expectedRevision !== c.revision) throw fail(409, 'fund_changed', 'Review the current fund before contributing.');
        if (c.rail === 'paypal-sandbox' && (!paypal || paypal.environment !== 'sandbox')) throw fail(409, 'sandbox_unavailable', 'Sandbox recipient checkout is not configured.');
        const held = db.prepare("SELECT COALESCE(SUM(amount_minor),0) AS n FROM village_payment_intents WHERE fund_id=? AND status!='completed'").get(input.fundId).n;
        if (input.amountMinor > c.remainingMinor - held) throw fail(409, 'fund_remaining', 'That amount exceeds what is still available after pending contributions.');
        const id = `vpay_${randomUUID()}`, at = clock.iso();
        db.prepare(`INSERT INTO village_payment_intents(id,request_id,fund_id,household_id,member_id,source,amount_minor,currency,recipient_json,fund_revision,target_minor,status,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,'creating',?,?)`).run(id,input.requestId,input.fundId,scope.householdId,scope.memberId,c.rail,input.amountMinor,c.currency,JSON.stringify(recipient),c.revision,c.targetMinor,at,at);
        return rowFor(id);
      });
      if (row.status === 'completed' || row.provider_order_id) return { contribution: view(row), changedHouseholds: [] };
      return flight(`create:${row.id}`, guard, async assertAccess => {
        const latest = rowFor(row.id);
        if (latest.status === 'completed' || latest.provider_order_id) return { contribution: view(latest), changedHouseholds: [] };
        if (row.source === 'simulated') return transaction(db, () => {
          assertAccess();
          const receipt = recordReceipt({ fundId: row.fund_id, source: 'simulated', eventRef: row.id, kind: 'capture', amountMinor: row.amount_minor, familyHouseholdId: row.household_id, recipient: null, at: clock.iso() });
          db.prepare("UPDATE village_payment_intents SET status='completed',capture_id=?,updated_at=? WHERE id=?").run(row.id,clock.iso(),row.id);
          return { contribution: view(rowFor(row.id)), ...receipt };
        });
        let data;
        try { ({ data } = await paypal.createOrder({ localId: row.id, amountCents: row.amount_minor, currency: row.currency,
          description: 'Our Castle village fund — PayPal sandbox', requestId: `create-${row.id}`, recipient: JSON.parse(row.recipient_json), assertAccess })); }
        catch (e) { if (!(e instanceof PayPalError)) throw e; setStatus(row,'pending'); return { contribution: view(rowFor(row.id)), changedHouseholds: [], outcome: 'unknown' }; }
        validateOrder(row, data);
        if (!['CREATED','PAYER_ACTION_REQUIRED','APPROVED'].includes(data.status)) throw fail(502,'village_order_status','PayPal did not create a reviewable order.');
        const url = safeApprovalLink((data.links ?? []).find(l => ['payer-action','approve'].includes(l.rel))?.href);
        db.prepare("UPDATE village_payment_intents SET provider_order_id=?,approve_url=?,status='created',updated_at=? WHERE id=?").run(data.id,url,clock.iso(),row.id);
        return { contribution: view(rowFor(row.id)), changedHouseholds: [] };
      });
    },
    async capture(input) {
      const { row } = owned(input), guard = input.assertAccess ?? (() => {}); guard();
      if (row.status === 'completed') return { contribution: view(row), changedHouseholds: [] };
      if (row.source !== 'paypal-sandbox' || !row.provider_order_id || !paypal) throw fail(409,'village_order_pending','The contribution is not ready for capture.');
      return flight(`capture:${row.id}`, guard, async assertAccess => {
        const latest = rowFor(row.id); if (latest.status === 'completed') return { contribution: view(latest), changedHouseholds: [] };
        const options = { recipient: JSON.parse(row.recipient_json), assertAccess };
        try {
          // Re-read before charging: a changed payee/order is rejected before any capture request.
          const before = (await paypal.getOrder(row.provider_order_id, options)).data;
          validateOrder(row, before);
          if (before.status === 'COMPLETED') return reconcile(row, before);
          if (owned(input).context.status === 'closed') throw fail(409,'fund_closed','This fund is closed. Check an existing payment instead.');
          await paypal.captureOrder(row.provider_order_id, { ...options, requestId: `capture-${row.id}` });
          return reconcile(row, (await paypal.getOrder(row.provider_order_id, options)).data);
        } catch (e) {
          if (!(e instanceof PayPalError)) throw e;
          setStatus(row,'pending');
          try { return reconcile(row,(await paypal.getOrder(row.provider_order_id,options)).data); }
          catch (readError) { if (!(readError instanceof PayPalError)) throw readError; return { contribution: view(rowFor(row.id)), changedHouseholds: [], outcome:'unknown' }; }
        }
      });
    },
    async check(input) {
      const { row } = owned(input), assertAccess = input.assertAccess ?? (() => {}); assertAccess();
      if (row.source === 'simulated' || !row.provider_order_id) return { contribution: view(row), changedHouseholds: [] };
      if (!paypal) throw fail(409,'sandbox_unavailable','Sandbox checking is not configured.');
      const out = reconcile(row,(await paypal.getOrder(row.provider_order_id,{ recipient:JSON.parse(row.recipient_json),assertAccess })).data);
      assertAccess(); return out;
    },
    list(input) {
      const scope = scopeOf(input); context(scope,input.fundId,true);
      return db.prepare('SELECT * FROM village_payment_intents WHERE fund_id=? AND household_id=? AND member_id=? ORDER BY created_at DESC LIMIT 50').all(input.fundId,scope.householdId,scope.memberId).map(view);
    },
  };
}
