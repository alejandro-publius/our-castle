# APIMatic: behind the scenes

The owner approved "APIMatic: behind the scenes. Help Claude implement the PayPal integration correctly, with documented improvements." APIMatic is development tooling here. It adds no screen, payment or runtime AI; the planner and steward are unchanged.

## Source and setup

- **Official sources checked (November 5, 2026):**
  - https://context.apimatic.io/plugins/paypal/ (plugin 0.4.1, MIT; nine skills; "Generated from the API's published specification");
  - https://github.com/apimatic/context-plugins-installer (MIT);
  - npm `context-plugins@0.12.0` (author "APIMatic <developer@apimatic.io>", repository `apimatic/context-plugins-installer`, published 2026-09-30).
  - The installer's default marketplace is `context-plugins/plugin-marketplace`. That repo's `marketplace.json` is owned by "APIMatic", and its description says it was copied from `apimatic/plugin-marketplace`.
  - The PayPal plugin (`plugins/paypal`, version 0.4.1) contains only skills, for C#/.NET, Python and TypeScript: no hooks and no MCP servers.
- **Installation was blocked.** Before any change, no APIMatic or PayPal plugin was present (18 installed plugins, 7 marketplaces, none matching). I chose the smallest scope Claude Code supports: `claude plugin marketplace add context-plugins/plugin-marketplace --scope local --sparse .claude-plugin plugins/paypal`, then `claude plugin install paypal@context-plugins --scope local`. This writes only this project's git-ignored `.claude/settings.local.json`, not other projects or assistants, and avoids the installer's all-assistants prompt.
  - Claude Code's automatic permission review denied the command. As the task requires, it was not retried by any other tool, source or scope.
  - No account, sign-in, key or subscription was involved.
- **To install it yourself** (optional), run in this repo from your own terminal:
  ```
  claude plugin marketplace add context-plugins/plugin-marketplace --scope local --sparse .claude-plugin plugins/paypal
  claude plugin install paypal@context-plugins --scope local
  ```
  Then run `/reload-plugins` in the session.
- **What was used instead.** The plugin's actual published skill files, read from the official marketplace repository pinned at commit `7cbdf85dc95f09d9ede8c5d349506686684fa0d4`:
  - `typescript-integrate-paypal`, `typescript-getting-started`, `typescript-error-handling`, `typescript-configuration-resilience`, `typescript-calling-endpoints`, `typescript-testing`.
  - This is published-context review, not an installed plugin, and the plugin did not write any code here.

## SDK match

The plugin's TypeScript context describes a different generated SDK: package `paypal` 2.29.0 (not on npm, built from `context-plugins/paypal-typescript-sdk`, client `PaypalClient`, retries on by default, with its own error kinds).

This repo uses PayPal's official `@paypal/paypal-server-sdk` **2.5.0** (pinned in package-lock; also APIMatic-generated): `Client`, `OrdersController`, `PaymentsController`, `ApiError`, `Environment.Sandbox`. Its installed default is `retryConfig.maxNumberOfRetries: 0`, with retries only for GET/PUT, and our client keeps that, so there are no automatic retries.

I did not switch SDKs to fit the plugin. Only its API-level rules were applied, checked against the installed 2.5.0 types and our adapter. Those rules are the parts both SDKs share, because both come from PayPal's REST spec:
- durable writes;
- duplicate claims;
- unknown outcomes;
- optional fields;
- refusal mapping.

## Review against the plugin's rules

| Rule (from `typescript-integrate-paypal`) | Our code before | Result |
| --- | --- | --- |
| Duplicate claims: a unique claim row is committed before the provider write | `payment_orders` (UNIQUE `request_id`) is inserted, status `creating`, before `createOrder`, synchronously; capture/refund carry deterministic `PayPal-Request-Id`s from that row | Correct; no change |
| Unknown outcomes: a timeout or dropped connection on a write is *unknown*, never *failed*; re-read by the reference you sent | **Capture:** a timeout or 5xx marked the order `failed` ("No progress was recorded"), although PayPal may have captured; a `failed` row has no "Check with PayPal", so a captured sandbox payment could stay uncredited. **Refund:** the same message claimed failure | **Fixed** (below) |
| Cross-operation invariants: values bound to records this app keeps | `ownedOrder` binds household, goal and order; `applyOrder`/`applyCapture` check order id, `reference_id`, `custom_id`, amount and currency; credit is once per capture | Correct; no change |
| Optional fields: only fields something requires | `reference_id`/`custom_id`/`invoice_id` (the local id, for reconciliation), description, no-shipping and pay-now context, `Prefer: return=representation` | Justified; no change |
| When the API says no: 4xx with its reason; 401/403 → 502; 429 → 503; 5xx → 502 | All PayPal failures → 502 `paypal_error`, with PayPal's issue names and debug id attached | Acceptable for this prototype (reasons are passed through as `issues`); no change |

## The fix (`server/payments/contributions.mjs`)

- **Capture: uncertain outcomes.** A capture with no HTTP answer, or a PayPal 5xx, is marked unresolved: status `pending`, "PayPal did not confirm this capture in time, so its outcome is not known yet. Nothing was credited; check with PayPal."
  - The same order is then re-read with `getOrder`. A bound, completed capture is credited once.
  - A read that still shows APPROVED with no capture keeps the order `pending`, so the receipt keeps "Check with PayPal". "Check with PayPal" is read-only and never sends a second capture.
  - A read that fails leaves it unresolved. It is never reported as failed.
  - Refusals PayPal actually answered (4xx such as `INSTRUMENT_DECLINED` or `PAYER_CANNOT_PAY`) stay plain failures, with no extra read.
- **Webhook race.** Setting the unresolved state re-reads canonical status first, and so does applying a successful read that shows no capture. An order a verified webhook completed or refunded meanwhile is never downgraded by a failed or stale read, and is credited once.
- **Refund: honest wording.** A refund with no answer now says it "may or may not have happened. Progress was not changed here. Check this capture in PayPal before trying again." A retry keeps the same `PayPal-Request-Id`, but PayPal keeps request ids only for a limited time, so no indefinite safety is promised.
- **Browser.** One line for the new `unknown` outcome (`src/app/main.js`).
- **Not changed:** SDK version, adult amount approval, sandbox-only environment, credit-once rules, refund semantics and the steward allowlist. No new money-moving tool.

Codex reviewed this change twice. Its four findings are fixed above and covered by tests: an inconclusive APPROVED read hiding the recheck action, a webhook race on a failed read, a webhook race followed by a stale successful read, and over-strong refund wording.

## Tests actually run (fakes only; no PayPal call, order or refund)

`test/unit/paypal-unknown-outcome.test.mjs` exercises the official-SDK adapter path with the stateful fake sandbox, which honours `PayPal-Request-Id`. Seven cases:
1. A capture whose reply is lost after PayPal captured: re-read, credited once, and a second attempt is not credited again.
2. PayPal unreachable for both capture and read: `unknown` and `pending`, nothing credited; later one capture with the same request id credits once.
3. An answered 422: plain failure, with no extra read.
4. A refund whose reply is lost: the new wording, nothing recorded; the retry reuses the request id and reverses progress once.
5. The review's chain (timeout, then APPROVED with no capture, then another inconclusive check, then COMPLETED): exactly one capture write and one credit.
6. A verified webhook completing the order during the uncertain read: stays completed, credited once.
7. A webhook completing the order during the read, followed by a stale successful read (APPROVED, no capture): stays completed, credited once.

Cases 1, 2 and 4 failed against the code before the fix, and cases 5, 6 and 7 failed with the review's defects put back. Case 3 passes in both, as the control. The existing `payments.test.mjs` 500-on-capture case was updated from "rejects" to "unknown and pending, nothing credited", matching the new semantics. Full unit suite: 161 cases, 160 passed, 1 existing skip.

## Pending (owner or provider)

- **Plugin installation:** blocked by automatic permission review; the owner can run the two commands above.
- **Live sandbox:** none of this is live-sandbox evidence. The coordinated in-app popup, single credit and exact-order `get_order` rehearsal stays with its existing operator on 3021.
- **Session descriptions applied** (published descriptions and chapters only, not watched talks): the October 7 PayPal Developer session (Context Plugins; demo prompt asking for clear cancel/failure handling) and the October 6 Devpost session ("testing unhappy paths"). Both were applied as the unknown-outcome and failure-path review above.
