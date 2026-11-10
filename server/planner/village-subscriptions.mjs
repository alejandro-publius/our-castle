import { randomUUID, createHash } from 'node:crypto';
import { transaction } from '../db.mjs';
import { DomainError, getMember } from '../household.mjs';
import { prepareVillageSubscriptionIntent, approveVillageSubscriptionIntent } from './village-subscription-intent.mjs';

const fail = (code, message, status = 409) => new DomainError(status, code, message);
const requestId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const LEASE_MS = 120_000;
// PayPal documents retention for 72 hours. Stop before that edge instead of risking a new remote subscription.
const RETRY_MS = 71 * 3_600_000;
const AGREEMENT_STATES = new Set(['approval_pending', 'approved', 'active', 'suspended', 'cancelled', 'expired']);

/** Append-only identity/intent fields, with explicit lifecycle fields. Called by the root schema migration only. */
export function ensureVillageSubscriptionsSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS village_subscriptions (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    fund_id TEXT NOT NULL,
    proposal_request_id TEXT NOT NULL,
    intent_revision TEXT NOT NULL UNIQUE,
    intent_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposal',
    approval_request_id TEXT,
    approved_at TEXT,
    first_dispatch_ms INTEGER,
    dispatch_until_ms INTEGER,
    dispatch_owner TEXT,
    plan_id TEXT,
    subscription_id TEXT UNIQUE,
    approval_url TEXT,
    provider_status TEXT,
    provider_updated_at TEXT,
    buyer_verified INTEGER NOT NULL DEFAULT 0 CHECK(buyer_verified IN (0,1)),
    checked_at TEXT,
    revoked_at TEXT,
    last_error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(household_id, member_id, proposal_request_id),
    UNIQUE(household_id, member_id, approval_request_id)
  );
  CREATE INDEX IF NOT EXISTS village_subscriptions_fund ON village_subscriptions(fund_id, household_id, member_id);
  CREATE TRIGGER IF NOT EXISTS village_subscriptions_immutable_intent
    BEFORE UPDATE OF household_id,member_id,fund_id,proposal_request_id,intent_revision,intent_json,created_at ON village_subscriptions
    BEGIN SELECT RAISE(ABORT, 'Village subscription intent is immutable'); END;`);
}

/**
 * Optional lifecycle service. All callbacks read only already-authenticated scope; readAuthorizedFund/actorForScope
 * are synchronous so they can also guard each SDK dispatch after OAuth. No timer, charge, receipt credit or AI tool.
 */
export function createVillageSubscriptions({ db, clock, readAuthorizedFund, actorForScope = scope => {
  const member = getMember(db, scope.householdId, scope.memberId);
  return member && { memberId: member.id, householdId: scope.householdId, role: member.role };
}, adapter = null, capabilities = null, recipientForFund = fund => fund.recipient?.merchantId }) {
  if (!db || !clock || typeof readAuthorizedFund !== 'function') throw new Error('Village subscriptions need a database, clock and authorized fund reader.');
  const available = () => Boolean(typeof adapter?.createApproval === 'function' && typeof adapter?.readAgreement === 'function' && adapter.environment === 'sandbox' && capabilities?.environment === 'sandbox' &&
    capabilities.platformSubscriptions === true && capabilities.sellerOnboarded === true && /^[A-Z0-9]{13}$/.test(capabilities.merchantId ?? '') && capabilities.bnCode);
  const setup = () => ({ status: 'setup_needed', available: false, message: 'Recurring contributions are not connected for this organizer.', paymentScheduled: false, chargesImported: false });
  const now = () => clock.now().getTime();
  const row = id => db.prepare('SELECT * FROM village_subscriptions WHERE id=?').get(id);
  const prepared = r => ({ status: 'ready_for_buyer_agreement', intent: JSON.parse(r.intent_json), revision: r.intent_revision, paymentScheduled: false });
  function view(r) {
    const intent = JSON.parse(r.intent_json), checking = r.status === 'dispatching';
    return { id: r.id, fundId: r.fund_id, status: checking ? 'in_progress' : r.status, revision: r.intent_revision, intent,
      planId: r.plan_id, subscriptionId: r.subscription_id, approvalUrl: r.revoked_at ? null : r.approval_url,
      recurringAgreementStatus: r.provider_status, providerUpdatedAt: r.provider_updated_at, buyerAgreementVerified: Boolean(r.buyer_verified), checkedAt: r.checked_at,
      locallyRevoked: Boolean(r.revoked_at), cancellationRequired: Boolean(r.revoked_at && r.subscription_id && !['cancelled', 'expired'].includes(r.provider_status)),
      // An active agreement can cause future PayPal charges. Nothing in this service imported/credited one.
      paymentScheduled: r.provider_status === 'active', chargesImported: false,
      accountingNote: 'Recurring charges are not imported into the village fund by this service.', lastErrorCode: r.last_error_code };
  }
  function context(scope, fundId, assertAccess, requireOpen = false) {
    assertAccess();
    const rawActor = actorForScope(scope), fund = readAuthorizedFund(scope, fundId);
    if (rawActor?.then || fund?.then) throw new Error('Subscription authorization callbacks must be synchronous.');
    const actor = rawActor && { memberId: rawActor.memberId ?? rawActor.id, householdId: rawActor.householdId ?? scope.householdId, role: rawActor.role };
    if (!actor || actor.role !== 'adult' || actor.householdId !== scope.householdId || actor.memberId !== scope.memberId)
      throw fail('adult_required', 'The signed-in adult manages their own recurring contribution.', 403);
    const recipientMerchantId = recipientForFund(fund);
    if (requireOpen && recipientMerchantId !== capabilities?.merchantId) throw fail('subscription_unavailable', 'Recurring contributions are not connected for this organizer.');
    if (requireOpen && fund.status !== 'open') throw fail('subscription_fund_closed', 'This fund is closed to new recurring contributions.');
    if (requireOpen && fund.progress?.remainingMinor === 0) throw fail('subscription_fund_complete', 'This fund has reached its target.');
    assertAccess();
    return { actor, fund, recipientMerchantId };
  }
  function own(scope, proposalId, assertAccess) {
    const r = row(proposalId);
    if (!r || r.household_id !== scope.householdId || r.member_id !== scope.memberId) throw fail('subscription_not_found', 'Recurring contribution not found.', 404);
    const current = context(scope, r.fund_id, assertAccess);
    if (digest(JSON.parse(r.intent_json)) !== r.intent_revision) throw fail('subscription_record_invalid', 'The retained recurring terms need review.');
    return { r, ...current };
  }
  const errorCode = error => /^[a-z][a-z0-9_]{1,80}$/.test(error?.code ?? '') ? error.code : 'provider_unavailable';

  return {
    status: () => available() ? { status: 'available', available: true, environment: 'sandbox', chargesImported: false } : setup(),

    propose({ scope, fundId, input, assertAccess = () => {} }) {
      if (!available()) return setup();
      if (!input || typeof input !== 'object' || Array.isArray(input) || !requestId(input.requestId)) throw fail('subscription_request', 'Use a fresh request reference for the proposal.', 400);
      const current = context(scope, fundId, assertAccess, true);
      const proposal = prepareVillageSubscriptionIntent({ ...current, amountMinor: input.amountMinor, cycles: input.cycles, startDate: input.startDate, today: clock.today() });
      return transaction(db, () => {
        const old = db.prepare('SELECT * FROM village_subscriptions WHERE household_id=? AND member_id=? AND proposal_request_id=?')
          .get(scope.householdId, scope.memberId, input.requestId);
        if (old) {
          if (old.intent_revision !== proposal.revision) throw fail('subscription_request_reused', 'That proposal reference already names different terms.');
          return view(old);
        }
        const sameIntent = db.prepare('SELECT * FROM village_subscriptions WHERE intent_revision=?').get(proposal.revision);
        if (sameIntent) return view(sameIntent); // a new browser request cannot create a second agreement for identical terms
        assertAccess();
        const id = `vsub_${randomUUID().replaceAll('-', '')}`, at = clock.iso();
        db.prepare(`INSERT INTO village_subscriptions(id,household_id,member_id,fund_id,proposal_request_id,intent_revision,intent_json,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?)`).run(id, scope.householdId, scope.memberId, fundId, input.requestId, proposal.revision, JSON.stringify(proposal.intent), at, at);
        return view(row(id));
      });
    },

    async approve({ scope, proposalId, reviewedRevision, approvalConfirmed, requestId: approvalId, assertAccess = () => {} }) {
      if (!available()) return setup();
      if (!requestId(approvalId)) throw fail('subscription_request', 'Use a fresh request reference for this approval.', 400);
      let { r, actor, fund, recipientMerchantId } = own(scope, proposalId, assertAccess);
      if (r.revoked_at) throw fail('subscription_revoked', 'This recurring proposal was revoked.');
      if (reviewedRevision !== r.intent_revision || approvalConfirmed !== true) throw fail('subscription_approval', 'Approve the exact retained recurring-payment terms.', 400);
      if (r.subscription_id) return view(r); // same known agreement; never create again, even after the 72-hour provider window
      if (r.first_dispatch_ms !== null && now() - r.first_dispatch_ms >= RETRY_MS) {
        db.prepare("UPDATE village_subscriptions SET status='needs_reconciliation',last_error_code='idempotency_window_elapsed',updated_at=? WHERE id=?").run(clock.iso(), r.id);
        return view(row(r.id));
      }
      const reviewed = approveVillageSubscriptionIntent({ storedProposal: { intent: JSON.parse(r.intent_json), revision: r.intent_revision },
        reviewedRevision, approvalConfirmed, actor, fund, recipientMerchantId, capabilities, today: clock.today() });
      if (fund.status !== 'open') throw fail('subscription_fund_closed', 'This fund is closed to new recurring contributions.');
      const claim = randomUUID();
      const acquired = transaction(db, () => {
        r = row(r.id);
        if (r.subscription_id || r.revoked_at || (r.dispatch_owner && r.dispatch_until_ms > now())) return false;
        const duplicate = db.prepare('SELECT id FROM village_subscriptions WHERE household_id=? AND member_id=? AND approval_request_id=? AND id<>?')
          .get(scope.householdId, scope.memberId, approvalId, r.id);
        if (duplicate) throw fail('subscription_request_reused', 'That approval reference already names a different proposal.');
        if (r.approval_request_id && r.approval_request_id !== approvalId) throw fail('subscription_request_reused', 'Retry this proposal using its original approval reference.');
        assertAccess();
        db.prepare(`UPDATE village_subscriptions SET status='dispatching',approval_request_id=?,approved_at=COALESCE(approved_at,?),first_dispatch_ms=COALESCE(first_dispatch_ms,?),
          dispatch_until_ms=?,dispatch_owner=?,last_error_code=NULL,updated_at=? WHERE id=?`)
          .run(approvalId, clock.iso(), now(), now() + LEASE_MS, claim, clock.iso(), r.id);
        return true;
      });
      if (!acquired) return view(row(r.id));
      const assertDispatch = () => {
        const fresh = own(scope, r.id, assertAccess);
        if (fresh.r.revoked_at || fresh.r.dispatch_owner !== claim || fresh.r.dispatch_until_ms <= now()) throw fail('subscription_dispatch_revoked', 'This approval request is no longer active.');
        approveVillageSubscriptionIntent({ storedProposal: { intent: JSON.parse(fresh.r.intent_json), revision: fresh.r.intent_revision },
          reviewedRevision, approvalConfirmed: true, actor: fresh.actor, fund: fresh.fund, recipientMerchantId: fresh.recipientMerchantId, capabilities, today: clock.today() });
        if (fresh.fund.status !== 'open') throw fail('subscription_fund_closed', 'The fund closed while approval was being prepared.');
      };
      const persistApproval = result => {
        // Persist known provider identity before response-access validation. A late sign-out must not erase it.
        if (result?.status !== 'approval_pending' || result.revision !== r.intent_revision || result.recipientMerchantId !== recipientMerchantId ||
            !/^P-[A-Z0-9]{1,48}$/.test(result.planId ?? '') || !/^I-[A-Z0-9]{1,48}$/.test(result.subscriptionId ?? '') ||
            typeof result.approvalUrl !== 'string' || !result.approvalUrl.startsWith('https://www.sandbox.paypal.com/') || result.paymentScheduled !== false)
          throw fail('subscription_approval_mismatch', 'The adapter returned an unexpected approval response.', 502);
        transaction(db, () => {
          const fresh = row(r.id);
          if (fresh.subscription_id && fresh.subscription_id !== result.subscriptionId) throw fail('subscription_provider_conflict', 'This intent returned two provider agreements. Reconciliation is required.', 502);
          if (fresh.subscription_id && fresh.checked_at) return; // a late create response cannot replace a newer provider check
          db.prepare(`UPDATE village_subscriptions SET status=CASE WHEN revoked_at IS NULL THEN 'approval_pending' ELSE 'cancellation_required' END,
            plan_id=?,subscription_id=?,approval_url=?,provider_status='approval_pending',dispatch_owner=NULL,dispatch_until_ms=NULL,last_error_code=NULL,updated_at=? WHERE id=?`)
            .run(result.planId, result.subscriptionId, result.approvalUrl, clock.iso(), r.id);
        });
      };
      try {
        const result = await adapter.createApproval({ prepared: reviewed, assertAccess: assertDispatch,
          assertResponseAccess: () => { own(scope, r.id, assertAccess); }, onApproval: persistApproval });
        persistApproval(result);
        assertAccess();
        return view(row(r.id));
      } catch (error) {
        db.prepare(`UPDATE village_subscriptions SET status=CASE WHEN revoked_at IS NULL THEN 'dispatch_unknown' ELSE 'needs_reconciliation' END,
          dispatch_owner=NULL,dispatch_until_ms=NULL,last_error_code=?,updated_at=? WHERE id=? AND dispatch_owner=?`)
          .run(errorCode(error), clock.iso(), r.id, claim);
        assertAccess();
        throw error;
      }
    },

    get({ scope, proposalId, assertAccess = () => {} }) {
      return { ...view(own(scope, proposalId, assertAccess).r), connectionStatus: available() ? 'available' : 'setup_needed' };
    },

    async check({ scope, proposalId, assertAccess = () => {} }) {
      const { r } = own(scope, proposalId, assertAccess);
      if (!available()) return { ...view(r), connectionStatus: 'setup_needed' };
      if (!r.subscription_id) return view(r);
      const guard = () => { own(scope, proposalId, assertAccess); };
      const checked = await adapter.readAgreement({ prepared: prepared(r), planId: r.plan_id, subscriptionId: r.subscription_id, assertAccess: guard });
      if (checked?.subscriptionId !== r.subscription_id || checked.planId !== r.plan_id || checked.revision !== r.intent_revision ||
          checked.recipientMerchantId !== JSON.parse(r.intent_json).recipientMerchantId || !AGREEMENT_STATES.has(checked.status) ||
          (['approved', 'active', 'suspended'].includes(checked.status) && checked.buyerAgreementVerified !== true) || checked.chargesImported !== false ||
          typeof checked.statusUpdatedAt !== 'string' || !Number.isFinite(Date.parse(checked.statusUpdatedAt)) || Date.parse(checked.statusUpdatedAt) > now() + 60_000)
        throw fail('subscription_agreement_mismatch', 'The adapter did not verify this retained agreement.', 502);
      const providerAt = new Date(checked.statusUpdatedAt).toISOString();
      transaction(db, () => {
        const fresh = row(r.id);
        if (fresh.provider_updated_at && providerAt < fresh.provider_updated_at) return; // late read cannot roll newer state backward
        if (fresh.provider_updated_at === providerAt && fresh.provider_status !== checked.status)
          throw fail('subscription_agreement_conflict', 'PayPal returned conflicting agreement states for the same update time.', 502);
        if (['cancelled', 'expired'].includes(fresh.provider_status) && checked.status !== fresh.provider_status)
          throw fail('subscription_agreement_conflict', 'A finished agreement cannot be reactivated by this check.', 502);
        db.prepare(`UPDATE village_subscriptions SET status=CASE WHEN revoked_at IS NOT NULL AND ? NOT IN ('cancelled','expired') THEN 'cancellation_required' ELSE ? END,
          provider_status=?,provider_updated_at=?,buyer_verified=?,checked_at=?,updated_at=?,last_error_code=NULL WHERE id=?`)
          .run(checked.status, checked.status, checked.status, providerAt, checked.buyerAgreementVerified ? 1 : 0, clock.iso(), clock.iso(), r.id);
      });
      assertAccess();
      return view(row(r.id));
    },

    revoke({ scope, proposalId, reviewedRevision, approvalConfirmed, assertAccess = () => {} }) {
      const { r } = own(scope, proposalId, assertAccess);
      if (reviewedRevision !== r.intent_revision || approvalConfirmed !== true) throw fail('subscription_approval', 'Confirm revoking these exact recurring-payment terms.', 400);
      assertAccess();
      db.prepare(`UPDATE village_subscriptions SET revoked_at=COALESCE(revoked_at,?),status=CASE
        WHEN subscription_id IS NOT NULL AND provider_status NOT IN ('cancelled','expired') THEN 'cancellation_required'
        WHEN first_dispatch_ms IS NOT NULL AND subscription_id IS NULL THEN 'needs_reconciliation' ELSE 'revoked' END,updated_at=? WHERE id=?`)
        .run(clock.iso(), clock.iso(), r.id);
      return { ...view(row(r.id)), message: r.subscription_id
        ? 'Local permission is revoked. This does not cancel an existing PayPal agreement; cancel it in PayPal, then check its status here.'
        : r.first_dispatch_ms !== null ? 'Local permission is revoked. A dispatched provider request needs reconciliation before another proposal.'
          : 'The local proposal is revoked. No PayPal request was made.' };
    },
  };
}
