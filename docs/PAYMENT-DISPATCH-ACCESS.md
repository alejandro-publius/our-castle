# Access at payment dispatch — November 6, 2026

Follow-up to PR #22, based on the shared-live integration at `264d5c2`. The earlier fix withholds private responses after access ends and records already-dispatched settlements. This fix also prevents an **unsent** capture or refund from leaving after access ends during OAuth.

After Claude integrated Merchant freshness, this branch also incorporated PR #20 at `bd0e716` by a normal conflict-free merge. The final integration check below covers those changes together.

## Reproduced gap

A family adult requests a capture or refund with an empty token cache. While the PayPal client waits for its OAuth token, the owner removes that adult. Both the REST client and the actual pinned Server SDK then sent the financial request anyway. HTTP returned 401, but only after the operation had run.

Four gated real-HTTP reproductions failed before the fix: capture and refund through each client. Each observed one forbidden operation instead of zero. The SDK tests run its real OAuth, generated controllers and serialization, replacing only axios transport with the stateful fake provider. No real account, provider call or financial transaction was involved.

## Implementation

- The two HTTP routes pass the server-created access assertion explicitly through the contribution service to the payment client. No callback is read from a JSON body.
- The REST client checks before authentication and again after awaiting the token, before calling fetch for the operation.
- The SDK adapter creates a cheap per-call controller over the existing long-lived client. Its public `getRequestBuilderFactory()` / `interceptRequest()` seam puts the call's assertion **after authentication and inside the retry pipeline**. The installed SDK 2.5.0 and `@apimatic/core` source were inspected for this ordering. No vendor code, SDK version, transport or retry defaults were changed.
- The callback belongs to one request, rather than a mutable global variable. Concurrent callers on the same SDK client cannot replace one another's authorization guard.
- Authorization errors remain authorization errors; they are not translated to a PayPal failure or uncertain financial outcome. A canceled operation leaves its order and ledger unchanged. A still-authorized owner can explicitly retry that same order/refund; cancellation does not poison the OAuth token cache.
- Once a financial request has been dispatched, its confirmed settlement is still recorded exactly once, even if access ends while its answer is returning. The existing private-response guard then withholds that answer. This patch does not attempt to cancel or roll back provider truth.

The APIMatic authentication, endpoint, resilience and testing skills guided placement below OAuth and testing with the actual generated SDK. The generated client's OAuth manager does not accept the operation's abort signal; a check only at route entry or before calling the controller would leave the reproduced window open.

## Validation

**89 passed, 1 existing skip, 0 failed** in the integrated targeted run:

```sh
node --test test/unit/payment-dispatch-access.test.mjs test/unit/family-runtime-boundaries.test.mjs test/unit/paypal-sdk-transport.test.mjs test/unit/paypal-sdk.test.mjs test/unit/payments.test.mjs test/unit/paypal-unknown-outcome.test.mjs test/unit/family-live.test.mjs
```

- Twenty dispatch cases: REST and real SDK × capture and refund × removal, idle expiry, sign-out, renewed sign-in and an active control. Ended access sends no operation and adds no financial entry; an explicit owner recovery sends one operation against the original record. Active controls settle once normally.
- One added SDK concurrency case proves a removed caller cannot dispatch while an active caller succeeds on the same client. SDK 2.5.0 makes two simultaneous cold-token requests here; the test does not claim it coalesces them.
- Existing tests retain amount/currency checks, request IDs, raw response fields, timeout/no-hidden-retry contracts, uncertain-outcome recovery, live notices and already-dispatched settlement behavior. The only skip is the pre-existing controller-substitution SDK OAuth-cache case; actual SDK token behavior is covered by the transport cases.
- `npm run check` and `git diff --check` passed. No browser suite was rerun for this server/client-only change.

After merging `bd0e716`, `node --test test/unit/payment-dispatch-access.test.mjs test/unit/merchant-freshness.test.mjs` passed **29/29**, with no skips. This confirms the OAuth-wait guards and Merchant freshness cases on the same combined tree. Log: `test-results/payment-dispatch/merchant-integration.txt`.

Ignored logs are in `test-results/payment-dispatch/{before,after,validation,final-targeted,final,check}.txt`. The early concurrency test incorrectly expected a single cold-token fetch; its assertion was corrected to the SDK's observed two requests, without changing application behavior.

## Bounds

This guards capture/refund dispatch; it does not change order creation, read-only provider calls or automatic SDK configuration. No asynchronous boundary is introduced between the final synchronous assertion and the existing transport call. Already-dispatched work cannot be recalled. Physical-device checkout in family mode is not newly verified by these fake transports. Owner apps, their data and the preserved 3021 sandbox rehearsal remain untouched.
