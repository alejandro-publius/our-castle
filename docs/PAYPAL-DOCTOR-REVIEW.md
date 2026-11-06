# PayPal Doctor checklist review

November 6, 2026, Pacific. Reviewed baseline: `9e8290d`.

## Method and provenance

Codex performed one source-guided review using PayPal's published [Doctor command](https://github.com/paypal/AI-Toolkit/blob/89ac03f4f7fe27a45163ebeae44a61899735cdd4/commands/doctor.md) and [best-practices skill](https://github.com/paypal/AI-Toolkit/blob/89ac03f4f7fe27a45163ebeae44a61899735cdd4/skills/paypal-best-practices/SKILL.md), pinned to upstream commit `89ac03f4f7fe27a45163ebeae44a61899735cdd4`. The command blob is `b56f6985a6b9588fda5ad0fd95d49db7f980d890`. Its v6, authentication, checkout, webhook and refund references were read alongside current [RulesHub v6 guidance](https://github.com/paypal/ruleshub/blob/main/upgrade-to-v6/v5-to-v6-upgrade/rules.md) (blob `89e2e3596829ec84dc5c720fadb09c0365a95bc8`). Reference copies, hashes and retrieval evidence are ignored under `test-results/paypal-doctor-review/`.

**This was not a registered `/paypal:doctor` invocation or an automated security certification.** Read-only inspection found no PayPal plugin among the local Claude installation's 18 plugin IDs. The upstream command is an AI-guided review, not a standalone scanner binary. No plugin, hook, MCP connection or credential was installed. Its optional auth/order/live probes were excluded by the existing no-new-orders scope; the owner's configured `.env` and databases were not used as test fixtures. Webinar context comes from supplied notes and published topics, not a claim to have rewatched all four talks.

## Source review report

```text
PayPal Doctor checklist review — local sandbox profile

CREDENTIALS & AUTHENTICATION
  [✓] Credentials are loaded server-side; .env and saved databases are ignored.
  [✓] The browser receives a public client ID or browser client token, not the server secret/OAuth token.
  [✓] REST OAuth uses Basic auth, client_credentials, cached expiry and bounded reads.
  [✓] Server SDK 2.5.0 initialization, Sandbox and 30-second request timeout match installed source.

ORDERS & CHECKOUT
  [✓] Orders v2, CAPTURE, USD/integer cents and server-bound household/goal/reference checks are present.
  [✓] Logical create/capture/refund operations retain their own PayPal-Request-Id across retries.
  [✓] Capture/refund identities and SQLite constraints prevent duplicate credit/reversal.
  [✓] Declines are distinct; uncertain captures read the same order instead of blindly repeating a write.
  [✓] JS SDK v6 uses one async official sandbox loader, eligibility, {orderId}, a Promise and server capture.
  [✓] Late cancel/error reporting now preserves canonical payment state (fixed below).

WEBHOOKS & RECOVERY
  [✓] Raw delivered event verification precedes processing; event/capture/refund identities are deduplicated.
  [✓] Explicit receipt checks recover missed dashboard refunds; saved status/local steward queries do not call PayPal.
  [⚠] Public webhook timing/delivery remains unverified; signature verification runs inline (see below).

ENVIRONMENT & SCOPE
  [✓] Runtime SDK/REST origins are sandbox-only; production credentials never select live traffic.
  [✓] Same-machine host/origin checks and the JSON write boundary protect the local app.
  [ℹ] Real household sign-in, public hosting and current dependency advisories remain production follow-up.
  [ℹ] Venmo/BNPL widgets, subscriptions, invoices and live MCP operations are outside this integration.

Summary: two demonstrated reporting warnings fixed; one public-webhook deployment warning remains.
Live API validation: NOT RUN — no MCP connection, new order or provider call.
```

The broad checklist was adapted to the actual v6/local-sandbox profile. A public client ID is expected in v6; it is not a client secret. Signature verification and OAuth POSTs are not money-moving retries. Sandbox-only configuration is intentional. The pinned Server SDK defaults to zero retries; this app deliberately preserves that setting, uses explicit same-order recovery, and does not add automatic POST retries merely to satisfy a generic backoff recommendation. A provider 429 remains actionable to the caller rather than being retried blindly.

## Demonstrated defects and corrections

| Trigger at baseline | Observed problem | Correction |
| --- | --- | --- |
| SDK cancel arrives after a completed/refunded/pending/declined record | The ledger and canonical status stayed correct, but the cancel endpoint always returned outcome `canceled`. | `cancelPayPalOrder` returns the settled/pending result, or `record_unchanged`, without another provider request or a financial mutation. Ownership checks still run first. |
| SDK cancel/error arrives after the server has captured | The wrapper claimed “Nothing was charged” or “No progress was recorded”, contradicting the existing $75 record. | A successful cancel response owns the UI outcome; the wrapper does not overwrite it. An SDK error, failed local response or closed window gives conservative receipt guidance. A locally canceled approval no longer proves that a provider charge is impossible. |

Code: [contribution service](../server/payments/contributions.mjs), [checkout wrapper](../src/app/paypal-checkout.js), and the existing outcome text in [main](../src/app/main.js). No create/capture/refund payload, monetary calculation, approval rule, provider origin, tool allowlist, dependency or schema changed. Existing records are not rewritten.

## Recovery placement

The existing saved-check row now follows the selected receipt's amount/status, before area-impact links. Its timestamp, note and **Check with PayPal** action stay together. **Needs a check?** already reads local records and opens the relevant receipts without a model/provider call. A refund absent from local records can only be discovered by a genuine provider read; neither the steward nor the interface invents it.

Reference: the current [Treasury](TREASURY.md), its existing `treasury-status-*-receipt-failed.png` captures and [interface direction](INTERFACE-DIRECTION.md). This is a reorder within the same receipt; no dashboard, card, setting or additional general notice. The historical $15 verification predates saved-check history and is not backfilled as a newer check.

## Verification actually performed

- Before correction, **10 of 12 new unit cases failed** across REST and Server SDK adapter paths; two foreign-scope controls passed. The first control assertion had expected the wrong error code (`not_found`); it was corrected to the existing `order_mismatch` before the recorded baseline. Three desktop browser reproductions also failed against the baseline.
- After correction, **47 focused unit cases passed, one existing intentional skip**: the 12 new cancel/status cases plus the existing payment suite. They cover completed/refunded/pending/declined records, ordinary cancellation followed by a late capture, single credit, unchanged rows/provider-call counts and foreign-scope refusal.
- **Six desktop/390 px touch-phone browser cases passed** against the actual wrapper and HTTP routes with a scripted SDK loader/stateful fake sandbox: late cancel after completed/pending capture and error after confirmed capture. These do not establish real SDK callback ordering or popup behavior.
- The existing receipt-status/local-query/recovery scenario is checked at both sizes after the reorder. Exact result and source guard are recorded in [validation](VALIDATION.md#paypal-doctor-checklist-and-callback-recovery--november-6-pst-2026).

Evidence: ignored `test-results/paypal-doctor-review/{sources.json,cancel-before-corrected.log,callback-before.log,callback-before-artifacts/,payment-after.log,callback-after.log,callback-after-artifacts/,treasury.log,treasury-artifacts/,source-check.log}`. No full suite, paid AI/search call, new real sandbox order, owner-data test or recording was run.

## Remaining public-webhook warning

The handler awaits REST signature verification before returning. REST OAuth plus verification each have a 30-second per-request bound; an uncached token can therefore exceed a provider's acknowledgement window. Deduplication makes retries safe, but does not prove timely live delivery. Before enabling a public listener, use a durable asynchronous verification/processing design or an appropriate overall acknowledgement budget, then verify real signed delivery/retries. Never acknowledge an unverified event as financially processed or credit from the simulator alone.

The present owner deployment is localhost-only and has no configured webhook subscription. This is a deployment limit, not evidence that a live webhook was tested. Existing fake-provider refund/replay evidence remains separate. [Release scope](RELEASE-READINESS.md).

## APIMatic and owner/provider follow-up

The [prepared form answer](SUBMISSION-DRAFT.md#prepared-apimatic-plugin-use-answer) cites the actual [installed skills and use map](APIMATIC-CODEX.md). It is still a draft: the authenticated Devpost form is not available through this chat's browser tools, so no field or submission has been saved. The public sponsor brief was rechecked; exact private form wording remains uninspected.

Renaming sandbox accounts can wait until a future owner-run recording. Recording remains paused. No account settings, PayPal transaction, plugin permission, public deployment or hackathon submission changed in this review.
