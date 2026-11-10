# Village drafts and the treasurer

A sentence such as **“We need $400 for the class trip by December 12, 2026”** becomes a fund proposal. The adult reviews it before creating a fund. An even split is a suggestion for the invited families; nobody acquires a debt, a payment obligation or an automatic charge because someone else created the proposal.

The default parser uses built-in rules and says so. It requires one explicit USD target and one future date including the year. An ambiguous date, multiple amounts or an invalid figure produces `needs_details` instead of a guessed plan. It proposes equal family shares in whole cents and weekly dates; small remainders are allocated consistently by stable family reference. Every share and week adds back to the exact target. These are suggested amounts, not an assessment of what a family can afford.

An optional server-injected Anthropic provider uses the already pinned SDK and Structured Outputs to phrase the title. The server independently extracts and validates the amount and date, recomputes all financial arithmetic and rejects invented fields or changed facts. No write tool is offered to the model. With no provider, the complete drafting flow works locally. The checks below use fake transports, not evidence of a live AI request.

## Integration contract

`createVillageDraft({ text, members, membershipRevision, today, provider, assertAccess })` in `server/planner/village-draft.mjs` receives an already-authorized neighborhood projection. `members` contains only `{ familyReference, alias }`; `today` is the server's ISO date. No private household ledger or member account identifier is sent to the model.

Its result contains `status`, `source`, `issues`, `requiresAdultReview: true`, `paymentScheduled: false`, and either `draft: null` or:

```js
{
  title, targetMinor, currency: 'USD', decimals: 2, deadline,
  rail: 'simulated', project: 'schoolhouse',
  shares: [{ familyReference, alias, committedMinor, proposed: true }],
  schedule: [{ date, totalMinor, families: [{ familyReference, amountMinor }] }],
  membershipRevision, createdOn, revision
}
```

The initial proposal selects the simulated rail. The AI cannot select a recipient account, wallet or financial rail. A different rail needs an explicit, independently validated fund form.

The HTTP caller retains the proposal in bounded server storage tied to its requesting session and household. `validateReviewedVillageDraft({ storedDraft, reviewedRevision, members, membershipRevision, today, actor })` takes that retained proposal, not client-echoed JSON. It rejects a different membership list, changed alias, membership revision, calendar day, proposal or reviewing role. The digest detects changed review content; it is **not** a signature or an authorization token. The returned `proposedShares` and `proposedSchedule` remain advisory. Each family accepts only its own voluntary commitment through the fund service.

`createVillageTreasurer({ readAuthorizedFund, clock }).ask({ scope, fundId, question, assertAccess })` in `server/steward/village-treasurer.mjs` reads the fund through the service's authorization boundary, checks access before and after that read, and returns:

```js
{
  answer, source: { mode: 'records', label }, asOf, paymentScheduled: false,
  facts: {
    targetMinor, netMinor, remainingMinor, currency, decimals, rail,
    deadline, revision, households, unmatched,
    pendingCommitmentsMinor, unpromisedMinor
  }
}
```

Answers use the service's net progress and per-family paid amounts, including its reversal handling. They do not sum raw capture and refund rows or infer a payer from a display name. `unmatched` is known only if the authorized projection supplies `progress.unmatchedMinor` and `progress.unmatchedCount`. An absent projection is reported as unavailable. Simulated records, saved PayPal sandbox receipts and PYUSD devnet test tokens receive distinct wording; token units are never combined with USD. A completed funding target does not prove a purchase or completed building.

The deterministic record answers are useful without an AI key. They are not presented as a live AI answer or a fresh provider verification. The existing household steward and its read-only tools remain unchanged.

## Recurring contributions: implemented boundary and remaining work

`village-subscription-intent.mjs` prepares finite weekly terms and binds review to the current adult, household, fund revision, organizer merchant ID, amount, start date and number of cycles. All dates must fall before the fund deadline. A different actor, recipient or term requires another review. Approval fails closed unless the server has configured sandbox platform access, seller onboarding and the matching merchant/BN code.

`village-subscriptions-sdk.mjs` uses the installed PayPal Server SDK **2.5.0**, with no pin change. It accepts a configured seller catalog-product ID, creates a finite weekly plan, re-reads and checks its price/cycles/no-fee terms, and requests a pending subscription. Seller authorization and BN headers are bound to every controller request; access is checked after OAuth and before dispatch. Stable, distinct request IDs cover plan and subscription retries. Unexpected amounts, plans, active states or approval URLs outside the PayPal sandbox are refused.

The adapter returns an actual provider approval link only when PayPal returned `APPROVAL_PENDING`. It offers no activate, capture, charge or refund operation. It uses `CONTINUE` for the buyer flow; an approval link is not a scheduled payment. Its `readAgreement` method checks the retained subscription ID, custom reference, start time, buyer agreement, effective billing plan and separate current plan before reporting a state. Changed prices, infinite cycles, fees, overrides or missing buyer/status evidence fail closed. It is optional server code and is not enabled merely by having ordinary checkout credentials.

`village-subscriptions.mjs` adds durable proposal and lifecycle storage. `ensureVillageSubscriptionsSchema(db)` appends one table and an immutable-intent trigger; root owns invoking it in the schema migration. Each proposal retains the exact adult, household, fund revision, recipient, finite terms and digest. Request references and identical intents are deduplicated. The service persists a dispatch claim before contacting the provider. Concurrent callers cannot launch another create while that claim is live; a restarted process can recover an expired claim using the same two PayPal request IDs. A known provider subscription is always reused. An unknown dispatch older than 71 hours stops for reconciliation before PayPal's documented 72-hour idempotency window expires.

Validated provider identifiers are persisted before checking whether the requester can still receive the response. A late sign-out therefore cannot erase a created approval. Every later read checks the current family and adult again. `ACTIVE` is recorded only after checked buyer-agreement readback; older status evidence cannot overwrite newer results. This is agreement tracking, **not recurring-payment accounting**: `chargesImported` stays false and no active-agreement status, payer summary or last-payment field creates a village receipt. Verified billing transaction/refund ingestion and lifecycle webhooks remain separate work.

The service API is:

The app now wires these through adult/CSRF routes under `/api/village/subscriptions/`. Configuration defaults to `OUR_CASTLE_SUBSCRIPTIONS=off`. Explicit `sandbox-platform` mode also requires family access, sandbox credentials, `PAYPAL_SUBSCRIPTIONS_SELLER_ONBOARDED=true`, `PAYPAL_SUBSCRIPTIONS_MERCHANT_ID`, `PAYPAL_PARTNER_ATTRIBUTION_ID` and `PAYPAL_SUBSCRIPTIONS_PRODUCT_ID`. These are operator declarations of eligibility, not evidence that PayPal granted it. Invalid or incomplete explicit setup stops startup. No UI claims automatic weekly collection.

- `propose({ scope, fundId, input, assertAccess })`, where input includes `requestId`, `amountMinor`, `cycles` and `startDate`.
- `approve({ scope, proposalId, reviewedRevision, approvalConfirmed, requestId, assertAccess })` requires the exact adult and terms. A retry uses the original approval request reference.
- `get({ scope, proposalId, assertAccess })` reads the retained record without provider traffic.
- `check({ scope, proposalId, assertAccess })` requests a fresh agreement readback when the adapter is configured.
- `revoke({ scope, proposalId, reviewedRevision, approvalConfirmed, assertAccess })` revokes local permission only. If PayPal already has the agreement, it reports `cancellation_required`, hides the approval link and tells the adult to cancel in PayPal, then check again. It never pretends local revocation stopped an active charge schedule.

`createVillageSubscriptions` receives the database, clock, synchronous authorized fund reader, optional actor reader, capabilities and explicitly injected sandbox adapter. Without capability, new proposals/approvals return `setup_needed` with no record or provider call. Existing records can still be read and locally revoked after capability is removed. No timer, scheduled charge or AI write tool is registered. Current-account eligibility, cancellation in the PayPal account and verified recurring-charge ingestion remain necessary before claiming a complete recurring collection product.

PayPal's [platform subscriptions guide](https://developer.paypal.com/platforms/subscriptions/integrate/) requires select-partner availability, seller onboarding and a BN code. Its [documented flow](https://developer.paypal.com/platforms/subscriptions/) also requires a product, a plan and buyer agreement. An organizer email alone does not establish those capabilities. No real account capability, live subscription, transfer or charge was tested here.

## Focused validation

- `test/unit/village-treasurer.test.mjs`: 15 cases, including cents conservation over uneven splits and short deadlines, ambiguous input, stale/adult review, injected AI output, revoked access, net-refund summaries, separate rails and exact recurring-term binding.
- `test/unit/village-subscriptions-sdk.test.mjs`: nine cases through the real SDK and a scripted in-process axios adapter. They cover wire payloads and seller headers, changed provider terms, rejected approval links/states, absent capability, access lost during OAuth/plan lookup, stable idempotency keys, effective-plan/buyer readback and preserving a validated approval after response-access loss.
- `test/unit/village-subscriptions.test.mjs`: ten cases cover durable reviewed terms, actual temporary-database restart, unknown dispatches, concurrent and stale process claims, exact-actor/fund binding, revoked adult access, immutable storage, disabled capability, local revocation and older provider evidence. Agreement checks leave the seeded ledger unchanged.
- All three new files pass the affected `node --test` selection on Node 24.22.1. The existing planner/steward checks also passed before this lifecycle addition, which changes neither file. There are no live provider calls; all credentials in tests are non-working literals and all data is invented.

These are source and fake-provider results. They do not establish eligibility for recurring contributions, a public service, actual family usefulness or receipt of real money.
