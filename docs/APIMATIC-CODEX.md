# APIMatic PayPal context in Codex

## Actual SDK transport contracts — November 6

`test/unit/paypal-sdk-transport.test.mjs` now exercises the pinned **2.5.0** SDK's real OAuth manager, generated controllers, request serialization, response parsing and error mapping. Following the installed [testing skill](../.agents/skills/typescript-testing/SKILL.md), only the axios transport is replaced through `unstable_httpClientOptions.adapter`. The production adapter accepts this internal injection in code; it is not exposed by HTTP input or an environment setting. Earlier controller-stub tests remain useful service tests but do not establish these wire contracts.

Six focused cases cover:

- OAuth and every operation stay on `api-m.sandbox.paypal.com`; auth receives fake credentials, and both auth and operations receive the configured timeout.
- Actual snake-case Orders v2 JSON, exact decimal amounts, local order references, `NO_SHIPPING`, `PAY_NOW`, `PayPal-Request-Id` and `Prefer` headers.
- Capture/get-order/get-capture/refund endpoint contracts; refund amount and bounded note serialization; one reused fake OAuth token.
- Raw response preservation, including `seller_receivable_breakdown` and unknown future fields, through the real SDK response parser.
- 422 issue/debug-ID mapping, 503 and timeout failures with one attempt and **no retry-policy override in the test**.
- OAuth failure stopping before an order operation, and malformed responses never becoming a successful receipt.

All provider responses are test fixtures. No PayPal account, order, capture, refund or paid AI call is created by these tests. A transport fixture verifies timeout **configuration** reaches axios; it does not prove elapsed-time behavior of a real network connection. The escape hatch is intentionally version-pinned and will need review with any SDK upgrade. No new SDK bug is claimed: this closes the previous serialization/configuration coverage gap using the APIMatic guidance.

The owner asked Codex to handle this directly. The PayPal Server SDK Context Plugin's eight TypeScript/Node skills are installed in this repository's `.agents/skills/`. Codex discovers them as enabled repository skills; no Claude session or global permission change is needed.

## Installed source

- [PayPal's hackathon Server SDK Context Plugin](https://github.com/paypaldev/server-sdk-context-plugin-preview), plugin `paypal` **0.1.0**, revision `6aa057126f0d4709a42e15002aab832a94935d92`.
- Its getting-started skill explicitly targets **`@paypal/paypal-server-sdk` 2.5.0**, matching Our Castle. This replaces the earlier generic context mismatch; no runtime SDK was replaced.
- Eight SKILL.md files and two companion references are copied verbatim. [Provenance](../.agents/apimatic-paypal/provenance.json) records every SHA-256; the original author/license manifest is retained. The declared licence is MIT.
- This is a **repository-scoped skill installation**, not a global marketplace registration. Every checkout receives it through normal Git sync. Start with [getting-started](../.agents/skills/typescript-getting-started/SKILL.md); AGENTS.md points PayPal edits to the appropriate companions.

## Verified discovery and actual use

Codex CLI **0.163.0** app-server `skills/list` was invoked for this checkout with a fresh scan: **all eight skills were enabled, scope `repo`, zero loading errors**. The probe created no thread or model turn and was stopped afterwards. [Discovery result](../.agents/apimatic-paypal/discovery.json).

Codex read the installed entry point, client initialization, authentication and resilience guidance, and checked the existing adapter against the unmodified **2.5.0 npm package source** downloaded separately as a reference:

| Contract checked | Existing Our Castle behavior |
| --- | --- |
| `Client` constructor and controller classes | One reused client, explicit OrdersController and PaymentsController |
| OAuth credentials | Server-only `clientCredentialsAuthCredentials`, with the exact `oAuthClientId` / `oAuthClientSecret` fields |
| Sandbox URL | Explicit `Environment.Sandbox`, resolving to `api-m.sandbox.paypal.com` |
| Timeout | Explicit 30,000 ms per HTTP request overrides the SDK's unbounded default of zero; OAuth plus an operation can take two request periods |
| Retries | The pinned SDK defaults to zero automatic retries; no new write retries were added |
| Logging | Default NullLogger; no request-body/header logging enabled |

These checks required no further runtime-code changes. The earlier capture-timeout/reconciliation improvements and their seven fake-provider cases remain documented in [APIMATIC-USAGE.md](APIMATIC-USAGE.md); they are not claimed as newly written by this installation.

## Specific context used in the submission

| Integration detail | Context and actual use |
| --- | --- |
| SDK initialization, OAuth and sandbox | `typescript-getting-started`, `typescript-client-initialization`, `typescript-authentication`; checked the installed 2.5.0 constructor, credential names and Sandbox origin. |
| Capture parameters and response/error shape | `typescript-calling-endpoints`, `typescript-models`, `typescript-error-handling`; confirmed controller argument fields, raw REST payloads and `ApiError` mapping against installed source. |
| Retry/timeout policy and uncertain outcomes | `typescript-configuration-resilience`, `typescript-testing`, plus the earlier published `typescript-integrate-paypal` review in [APIMATIC-USAGE.md](APIMATIC-USAGE.md); retained deterministic request IDs and zero automatic write retries, and fixed same-order recovery after uncertain captures. Existing idempotency was reviewed, not claimed as newly generated. |
| Webhook signature details | PayPal AI Toolkit's separate webhook guidance and PayPal's verification API. The bounded REST transport also applies the resilience guidance. Webhooks v1 is **not** a generated Server SDK 2.5.0 endpoint. |

The November 6 [Doctor checklist review](PAYPAL-DOCTOR-REVIEW.md) uses the separate PayPal AI Toolkit source; it is not another APIMatic plugin installation or a native `/paypal:doctor` invocation. The prepared Devpost answer remains unsubmitted.

## Boundaries and evidence

The subsequent [Toolkit maintenance review](TOOLKIT-MAINTENANCE.md) applied the resilience/testing context to the installed Toolkit's actual read transport: bounded waits, no automatic retry, exact sandbox origins and no late verification after a timeout. It preserves Server SDK 2.5.0. Forty fake-transport contract cases and five post-clean-install Toolkit cases passed; no live payment or paid AI call was repeated.

This change adds developer context and accurate setup notes. App code, dependency pins, original artwork, household data and `.env` are unchanged. No PayPal order, refund, paid AI call or public deployment was made. Existing payment/browser suites were not repeated for context-only files; the source/art guard and discovery/hash checks cover this change.

The earlier Claude automatic-review rejection remains historical and was not overridden. The owner explicitly chose Codex for this setup. Sponsor judging and general entry requirements still apply; this is evidence of actual installed context use, not a prize guarantee.
