# Family request completion review — November 6, 2026

Based on PR #20 at `3b1d02a`, after the shared-family, Merchant, SDK recovery and sponsor-art integrations. This pass closes two reproduced request-lifetime gaps without adding an endpoint, dependency, schema or interface.

## One capture, independent callers

Two valid adults can request capture of the same household order while its OAuth token is being fetched. Previously they shared the first adult's promise and permission check. Removing that adult stopped the entire attempt and returned HTTP 401 even to the other, still-authorized adult. Both the REST and actual SDK transport reproductions failed on that second response (401 instead of 200).

The in-flight entry now holds each already-admitted caller and its server-created access assertion. Before the one capture is dispatched, at least one of those actual capture requests must still be authorized for the owned order. If all have ended, no capture is sent. A child, another family, or a later owner read cannot keep it alive. No new caller, approval, order or automatic retry is created.

The shared operation still applies the provider result and records the capture once. Each waiting request then checks its own authorization before receiving a response, including error responses. A removed caller gets its own access error; an active caller gets the payment result. If everybody loses access after dispatch, settlement still records once and private answers are withheld. The shared entry and callers are released on both success and failure, so a later explicit owner recovery can use the original order.

Sixteen gated HTTP cases cover both REST and real SDK transports: first/second/both adults removed during OAuth, both active, one/both removed after dispatch, an excluded child and another family's adult. Each checks response privacy, at most one capture/credit, exact $60→$75 progression and the Manor tier, plus cleanup/recovery of that same order. The observer records when a request enters the contribution service, avoiding body-arrival timing assumptions or sleeps. OAuth/controllers/serialization remain real in the SDK case; only axios transport is fake.

## Passkey enrollment after removal

The additional-passkey route authorized the request before awaiting real WebAuthn verification, then stored the credential without checking again. Removing that adult during the verifier's asynchronous RP-ID hashing returned HTTP 401 through the existing response guard, but the database had already gained a new passkey (3 total instead of 2 in the fixture).

The route now passes the same trusted server access assertion into enrollment. The service rechecks before beginning and immediately after cryptographic verification, before the credential/audit write. No callback can be supplied through HTTP JSON. The real verifier, challenge binding, origin/RP checks, recent-auth requirements and one-use ceremony remain intact.

Five cases gate the real verifier's hash operation: removed access, idle expiry, sign-out, an actual renewed sign-in using the original key, and an active control. Ended requests store no key; the active request adds exactly one. A newer sign-in stays usable after the earlier enrollment request is refused. The crypto method is restored after every sequential case; separate test files have separate processes.

## Evidence

**124 passed, 1 pre-existing skip, 0 failed** in the focused integrated run:

```sh
node --test test/unit/shared-capture-access.test.mjs test/unit/passkey-enrollment-access.test.mjs test/unit/payment-dispatch-access.test.mjs test/unit/family-access.test.mjs test/unit/family-runtime-boundaries.test.mjs test/unit/payments.test.mjs test/unit/paypal-sdk-transport.test.mjs test/unit/paypal-unknown-outcome.test.mjs test/unit/family-live.test.mjs
```

The existing SDK controller-substitution OAuth-cache case is the only skip. Actual SDK auth/cache behavior remains covered by transport tests. `npm run check` and `git diff --check` pass; original art/palette/runtime source remains unchanged. Ignored logs: `test-results/shared-capture/{before,after,passkey-before,focused,check}.txt`.

No owner app, household record, credential, real PayPal order, paid model/search call, recording or deployment was used. These tests use isolated in-memory households, software passkeys and fake PayPal transports. No physical-device checkout or production-scale concurrency is claimed. Already-dispatched provider work cannot be recalled; provider verification and idempotency still determine settlement. The existing app does not normally initiate concurrent captures; this handles overlapping authorized HTTP callers safely.
