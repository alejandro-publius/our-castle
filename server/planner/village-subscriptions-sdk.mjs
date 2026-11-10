import { createHash } from 'node:crypto';
import { ApplicationContextUserAction, Client, Environment, ExperienceContextShippingPreference,
  IntervalUnit, PlanRequestStatus, SubscriptionsController, TenureType } from '@paypal/paypal-server-sdk';
import { DomainError, isIsoDate } from '../household.mjs';

const fail = (code, message, status = 409) => new DomainError(status, code, message);
const digest = intent => createHash('sha256').update(JSON.stringify(intent)).digest('hex');
const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const raw = response => {
  try { return JSON.parse(response.body); } catch { throw fail('subscription_provider_response', 'PayPal returned an unreadable subscription response.', 502); }
};
const decimal = amount => `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`;

/**
 * Optional sandbox-only adapter. Capabilities and productId are server configuration from actual seller onboarding,
 * never a request or an AI response. This adapter has no activate/capture/charge method. Its only output is a genuine
 * PayPal buyer-approval link. Callers must durably retain the intent and resulting provider IDs; a link is not payment.
 */
export function createVillageSubscriptionsSdk({ clientId, clientSecret, capabilities, productId, appOrigin, httpAdapter, timeoutMs = 30_000 }) {
  if (!clientId || !clientSecret || capabilities?.environment !== 'sandbox' || capabilities.platformSubscriptions !== true ||
      capabilities.sellerOnboarded !== true || !/^[A-Z0-9]{13}$/.test(capabilities.merchantId ?? '') ||
      typeof capabilities.bnCode !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(capabilities.bnCode) || !/^PROD-[A-Z0-9]{1,48}$/.test(productId ?? ''))
    throw fail('subscription_unavailable', 'Organizer subscriptions require configured sandbox platform access, an onboarded seller, BN code and catalog product.');
  let origin;
  try { origin = new URL(appOrigin); } catch { throw fail('subscription_origin', 'Configure the app origin before creating approval links.'); }
  if (origin.origin !== appOrigin || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
      (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && origin.hostname === 'localhost')))
    throw fail('subscription_origin', 'Approval links need the exact HTTPS app origin or local localhost origin.');
  const merchantId = capabilities.merchantId, bnCode = capabilities.bnCode;
  const assertion = `${encoded({ alg: 'none' })}.${encoded({ iss: clientId, payer_id: merchantId })}.`;
  const client = new Client({ environment: Environment.Sandbox,
    clientCredentialsAuthCredentials: { oAuthClientId: clientId, oAuthClientSecret: clientSecret }, timeout: timeoutMs,
    httpClientOptions: { retryConfig: { maxNumberOfRetries: 0 } },
    ...(httpAdapter ? { unstable_httpClientOptions: { adapter: httpAdapter } } : {}),
  });
  function controller(assertAccess) {
    const factory = client.getRequestBuilderFactory();
    return new SubscriptionsController({ getRequestBuilderFactory: () => (...args) => {
      const request = factory(...args);
      request.header('PayPal-Auth-Assertion', assertion);
      request.header('PayPal-Partner-Attribution-Id', bnCode);
      // This per-call guard runs after OAuth and before each dispatch; no shared actor state lives on the client.
      request.interceptRequest(req => { assertAccess(); return req; });
      return request;
    } });
  }
  return { environment: 'sandbox', implementation: 'paypal-server-sdk-2.5.0',
    async createApproval({ prepared, assertAccess = () => {} }) {
      assertAccess();
      const intent = prepared?.intent;
      if (prepared?.status !== 'ready_for_buyer_agreement' || prepared.paymentScheduled !== false || !intent ||
          digest(intent) !== prepared.revision || intent.recipientMerchantId !== merchantId || intent.rail !== 'paypal-sandbox' || intent.currency !== 'USD' ||
          !Number.isSafeInteger(intent.amountMinor) || intent.amountMinor < 1 || intent.amountMinor > 100_000_000 ||
          !Number.isSafeInteger(intent.cycles) || intent.cycles < 1 || intent.cycles > 52 || intent.intervalUnit !== 'WEEK' || intent.intervalCount !== 1 ||
          intent.totalMinor !== intent.amountMinor * intent.cycles || !isIsoDate(intent.startDate))
        throw fail('subscription_not_reviewed', 'Review the exact recurring-payment terms before asking PayPal for approval.');
      const api = controller(assertAccess), value = decimal(intent.amountMinor), fingerprint = prepared.revision;
      const customId = `village-${fingerprint}`, startTime = `${intent.startDate}T12:00:00Z`;
      const planResponse = await api.createBillingPlan({ prefer: 'return=representation', paypalRequestId: `vpl-${fingerprint.slice(0, 32)}`,
        body: { productId, name: 'Our Castle village contribution (sandbox)', status: PlanRequestStatus.Active,
          description: 'Finite weekly contributions reviewed by an adult; PayPal buyer agreement is still required.',
          billingCycles: [{ frequency: { intervalUnit: IntervalUnit.Week, intervalCount: 1 }, tenureType: TenureType.Regular,
            sequence: 1, totalCycles: intent.cycles, pricingScheme: { fixedPrice: { currencyCode: 'USD', value } } }],
          paymentPreferences: { autoBillOutstanding: false, paymentFailureThreshold: 1 }, quantitySupported: false },
      });
      assertAccess();
      const created = raw(planResponse);
      if (!/^P-[A-Z0-9]{1,48}$/.test(created?.id ?? '')) throw fail('subscription_plan_mismatch', 'PayPal did not identify the created plan.', 502);
      const plan = raw(await api.getBillingPlan(created.id));
      assertAccess();
      const cycle = plan?.billing_cycles?.[0];
      if (plan.id !== created.id || plan.product_id !== productId || plan.status !== 'ACTIVE' || plan.billing_cycles?.length !== 1 ||
          cycle.tenure_type !== 'REGULAR' || cycle.sequence !== 1 || cycle.total_cycles !== intent.cycles || cycle.frequency?.interval_unit !== 'WEEK' ||
          cycle.frequency?.interval_count !== 1 || cycle.pricing_scheme?.fixed_price?.currency_code !== 'USD' || cycle.pricing_scheme?.fixed_price?.value !== value ||
          plan.quantity_supported === true || Number(plan.taxes?.percentage ?? 0) !== 0 || Number(plan.payment_preferences?.setup_fee?.value ?? 0) !== 0 ||
          plan.payment_preferences?.auto_bill_outstanding !== false || plan.payment_preferences?.payment_failure_threshold !== 1)
        throw fail('subscription_plan_mismatch', 'PayPal’s plan differs from the reviewed terms. No subscription was requested.', 502);
      const response = raw(await api.createSubscription({ prefer: 'return=representation', paypalRequestId: `vsub-${fingerprint.slice(0, 32)}`,
        body: { planId: plan.id, startTime, customId,
          applicationContext: { brandName: 'Our Castle (sandbox)', shippingPreference: ExperienceContextShippingPreference.NoShipping,
            userAction: ApplicationContextUserAction.Continue, returnUrl: `${appOrigin}/?villageSubscription=${fingerprint}&result=return`,
            cancelUrl: `${appOrigin}/?villageSubscription=${fingerprint}&result=cancel` } },
      }));
      assertAccess();
      const links = response?.links?.filter(link => link.rel === 'approve') ?? [];
      let approval;
      try { approval = links.length === 1 ? new URL(links[0].href) : null; } catch { approval = null; }
      if (!/^I-[A-Z0-9]{1,48}$/.test(response?.id ?? '') || response.plan_id !== plan.id || response.custom_id !== customId ||
          response.start_time !== startTime || response.status !== 'APPROVAL_PENDING' || response.plan_overridden === true ||
          (response.quantity !== undefined && response.quantity !== '1') || Number(response.shipping_amount?.value ?? 0) !== 0 ||
          !approval || approval.protocol !== 'https:' || approval.hostname !== 'www.sandbox.paypal.com' || approval.port || approval.username || approval.password)
        throw fail('subscription_approval_mismatch', 'PayPal did not return the expected sandbox approval. No subscription is treated as active.', 502);
      return { status: 'approval_pending', subscriptionId: response.id, planId: plan.id, approvalUrl: approval.href,
        revision: fingerprint, recipientMerchantId: merchantId, buyerAgreementRequired: true, paymentScheduled: false,
        startTime, amountMinor: intent.amountMinor, currency: 'USD', cycles: intent.cycles };
    },
  };
}
