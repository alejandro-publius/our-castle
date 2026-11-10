import { createHash } from 'node:crypto';
import { DomainError, addDays, isIsoDate } from '../household.mjs';

const fail = (code, message, status = 400) => new DomainError(status, code, message);
const digest = intent => createHash('sha256').update(JSON.stringify(intent)).digest('hex');
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);

/** Finite recurring-payment terms only. This helper creates no PayPal plan, subscription or payment. */
export function prepareVillageSubscriptionIntent({ fund, actor, recipientMerchantId, amountMinor, cycles, startDate, today }) {
  if (actor?.role !== 'adult' || !id(actor.memberId) || !id(actor.householdId)) throw fail('adult_required', 'An adult prepares recurring-payment terms for their own family.', 403);
  if (!fund || fund.rail !== 'paypal-sandbox' || fund.currency !== 'USD' || fund.decimals !== 2 || !id(fund.id) || !Number.isSafeInteger(fund.revision))
    throw fail('subscription_fund', 'Recurring payment terms require a PayPal sandbox fund.');
  if (typeof recipientMerchantId !== 'string' || !/^[A-Z0-9]{13}$/.test(recipientMerchantId)) throw fail('subscription_recipient', 'Choose the configured organizer merchant account.');
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > 100_000_000 || !Number.isSafeInteger(cycles) || cycles < 1 || cycles > 52)
    throw fail('subscription_terms', 'Choose a positive whole-cent weekly amount and 1–52 payments.');
  if (!isIsoDate(today) || !isIsoDate(startDate) || !isIsoDate(fund.deadline) || startDate <= today || addDays(startDate, (cycles - 1) * 7) > fund.deadline)
    throw fail('subscription_dates', 'All weekly payments must start after today and finish by the fund deadline.');
  const intent = Object.freeze({ version: 1, fundId: fund.id, fundRevision: fund.revision, householdId: actor.householdId,
    memberId: actor.memberId, recipientMerchantId, rail: 'paypal-sandbox', currency: 'USD', amountMinor,
    intervalUnit: 'WEEK', intervalCount: 1, cycles, startDate, totalMinor: amountMinor * cycles });
  return { intent, revision: digest(intent), status: 'proposal', buyerAgreementRequired: true, paymentScheduled: false };
}

/**
 * Validate server-retained terms against the CURRENT actor, fund and configured seller. The result is an adapter
 * command, not an active subscription. No toolkit write tool is exposed to the AI; the browser still needs PayPal's
 * buyer agreement and server-side agreement verification before any recurring status could be recorded.
 */
export function approveVillageSubscriptionIntent({ storedProposal, reviewedRevision, approvalConfirmed, actor, fund, recipientMerchantId, capabilities, today }) {
  if (!storedProposal?.intent) throw fail('subscription_missing', 'Review recurring-payment terms first.', 409);
  const was = storedProposal.intent;
  const current = prepareVillageSubscriptionIntent({ fund, actor, recipientMerchantId, amountMinor: was.amountMinor, cycles: was.cycles, startDate: was.startDate, today });
  if (approvalConfirmed !== true) throw fail('subscription_approval', 'Approve the exact recipient, weekly amount and number of payments.');
  if (digest(was) !== storedProposal.revision || reviewedRevision !== storedProposal.revision || current.revision !== reviewedRevision)
    throw fail('subscription_changed', 'The family, fund or recurring-payment terms changed. Review them again.', 409);
  if (capabilities?.environment !== 'sandbox' || capabilities.platformSubscriptions !== true || capabilities.sellerOnboarded !== true ||
      capabilities.merchantId !== recipientMerchantId || typeof capabilities.bnCode !== 'string' || !capabilities.bnCode.trim())
    throw fail('subscription_unavailable', 'Organizer subscriptions are not configured. They require supported PayPal platform access and seller onboarding.', 409);
  return { status: 'ready_for_buyer_agreement', intent: current.intent, revision: current.revision, paymentScheduled: false,
    adapterCommand: { operation: 'create_subscription_approval', idempotencyKey: `village-subscription-${current.revision}`,
      merchantId: recipientMerchantId, amount: { currencyCode: 'USD', value: `${Math.floor(was.amountMinor / 100)}.${String(was.amountMinor % 100).padStart(2, '0')}` },
      intervalUnit: 'WEEK', intervalCount: 1, totalCycles: was.cycles, startDate: was.startDate,
      householdId: actor.householdId, memberId: actor.memberId, fundId: fund.id } };
}
