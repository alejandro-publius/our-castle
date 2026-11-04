# Bill verification research — November 3, 2026

## What is established

- SDG&E offers PayPal in My Energy Center, including its mobile app and Auto Pay Plus. A payment method being available at a utility does not grant Our Castle access to that customer's utility account, invoice or paid-bill status.
- PayPal markets utility/billing solutions to utilities and billers. Its separate Business Bill Pay product is for U.S. business accounts paying U.S. vendors; that is not evidence of a consumer bill-verification API available to this app.
- The current Our Castle integration is an owned sandbox merchant REST app. Its credentials and read-only Transaction Search permission have been tested against that merchant's sandbox history. No SDG&E account or partner data connection has been authorized or implemented.
- PayPal Transaction Search uses account-scoped client credentials and a reporting/search/read scope. Its documented statuses distinguish pending, successful and reversed transactions, and reporting can lag execution by up to three hours. A successful payment record alone is not proof that a particular utility bill was paid in full and on time.

## Buildable now

1. Richer rewards for goal milestones, using the existing truthful goal ledger and source labels. Goal progress is not a bank balance.
2. PayPal sandbox-confirmed contribution rewards after server verification of the correct amount, currency, household/order binding and completed capture. Preserve replay protection, refunds and keepsake semantics.
3. Self-reported household habit rewards clearly labeled as recorded by the user. A recorded bill must never be relabeled provider-verified and must not increase savings progress.
4. Locked, labeled previews of future verified-bill rewards, with an honest connection-required status. No pretend Connect/Verify button that marks a bill paid.

## What an actual verified-bill connection must establish

A real authorized utility/biller or approved payment-data provider would need to supply a server-verifiable record tying together the household's linked account, recognized biller identity, bill/invoice and billing period, amount/currency, completed/settled payment status, and whether the bill's amount due was satisfied. An on-time reward additionally needs the bill's actual due date. A user-entered merchant name, checked box, browser redirect, screenshot or uploaded receipt is not equivalent to provider confirmation.

Verify the provider event/signature or retrieve the record through an authorized API. Deduplicate by provider event/payment and bill period; handle pending, partial, rejected and reversed states explicitly. Do not interpret missing history during reporting lag as a failure to pay. Refunded or reversed payments must update current evidence truthfully; historical cosmetic keepsakes may remain with clear wording.

No public self-report API may accept an arbitrary source=verified flag or grant provider-verified rewards. Future adapters must be explicitly configured and capabilities must describe their actual availability. Sandbox fixtures and art previews must remain labeled examples.

## Proposed visual rewards (concept, not existing bill integrations)

| Condition | Visible reward | Evidence needed |
| --- | --- | --- |
| Goal milestone | Larger home, courtyard, walls, workshop and village details | Existing goal ledger, with reported versus PayPal-confirmed progress distinguished |
| Electricity bill paid | Lit windows, hearth smoke and street lanterns | Authorized provider confirms the correct bill is paid |
| Water bill paid | Fountain, working well or irrigated garden | Authorized provider confirms the correct bill is paid |
| Consistent verified household goals | More village life, banners and architectural detail | Explicit, replay-safe achievement conditions |
| Bill recorded by the household | A labeled habit-garden keepsake | Self-report only; never a verified-payment badge |

## Primary sources

- SDG&E payment options: https://www.sdge.com/residential/pay-bill/my-bill
- SDG&E mobile app: https://www.sdge.com/mobileapp
- SDG&E Auto Pay Plus: https://www.sdge.com/auto-pay
- PayPal utility/billing solutions: https://www.paypal.com/us/enterprise/industry-solutions/utilities
- PayPal Business Bill Pay: https://www.paypal.com/us/business/make-payments/bill-pay
- PayPal Transaction Search endpoint and authorization/status/lag details: https://developer.paypal.com/api/transaction-search/v1/search-get
- PayPal's account-permission explanation: https://developer.paypal.com/community/blog/paypal-api-error-permission-denied/

No public SDG&E-to-Our-Castle verification integration was verified in this research. Provider access and product approval remain integration dependencies, not completed features.

## What this build implements (November 4, 2026)

These parts are implemented and tested, and none is a bill connector:
- Every reward reports `providerVerified: false`.
- The electricity and water rewards are always `connection_required`, with the evidence label "Needs a connected bill provider · none is connected".
- `rewards.billVerification` reports `{ connected: false, status: "not_connected", providers: [] }`.
- `POST /api/entries` stores every bill as `user-reported` and ignores client-sent `verified`, `providerVerified`, `source`, `provider` and `status` fields. No verify route exists.
- Recorded bills grow only the labeled habit garden and never change saved progress.
- Tests: `test/unit/rewards.test.mjs` and `test/unit/server.test.mjs` (the public-API boundary), plus `test/e2e/estate.spec.mjs` (no pretend verify or connect control in the Rewards view).

## Proposed provider path (not started)

1. **Choose an authorized source** that can attest to a specific household's bill: the utility's own customer-data or billing API, a biller-side partner integration, or a regulated account-data aggregator with explicit customer consent. Confirm its terms permit this use before any build.
2. **Get the household's consent server-side** (OAuth or the provider's equivalent). Store tokens with the other server secrets, never in the browser.
3. **Add a provider adapter** that returns one normalized, server-verified record:
   - provider and biller identity;
   - an account reference;
   - billing period, amount due and amount paid;
   - payment status;
   - due and paid dates;
   - the provider's event or record id.
4. **Verify the provider's webhook signatures** or fetch the record through the API.
   - Deduplicate by provider record id and bill period.
   - Handle pending, partial, rejected and reversed states explicitly.
   - Treat reporting lag as "unknown", not "unpaid".
5. **Report the connection honestly:** set `billVerification.connected` only when an adapter is configured and its last check succeeded.
6. **Evaluate reward conditions on the server** from verified records only. A reversed payment updates current evidence; a cosmetic keepsake may remain, labeled as such.
7. **Test with signed provider sandbox fixtures**, labeled as examples. Never present them as a live connection.
