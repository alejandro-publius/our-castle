# Validation

## November 4, 2026 — wider estate, estate additions and the Rewards view (branch `expansion/wider-estate`)

Environment: macOS, Node 26.0.0, Playwright 1.64.1 with Chromium (SwiftShader). Everything below ran in example mode or against test doubles, with isolated data directories. No new PayPal order was created, no paid AI call was repeated, and the owner's `.env` and sandbox household data were not modified.

**`npm test` (exit code 0):**
- **`npm run check`:** 47 hash-locked art and runtime files match their manifest; the 90-color palette and renderer wiring are intact; all JavaScript parses.
- **`npm run test:unit`:** 98 tests, 97 passed, 1 skipped by design. New since the last pass:
  - **Thresholds:** home tiers stay at 0/25/60/100%; estate additions sit at 10/40/80%, rounded up to whole cents, and unlock exactly at the threshold, never one cent early.
  - **Evidence labels:** simulated and reported money is never labeled "confirmed by PayPal"; sandbox-confirmed captures are labeled as such, net of refunds.
  - **Keepsakes:** additions are earned with the tier awards and survive a refund as keepsakes. The refund lowers progress by exactly its amount, and the ledger arithmetic holds.
  - **Replays:** a replayed request credits once and awards each addition once.
  - **Announcements:** only a locked → unlocked change counts as newly earned. A replay, reload, refund, or crossing again after a refund produce nothing.
  - **Bills:** a recorded bill (even one named "SDG&E") grows only the habit garden. Saved progress is unchanged, both bill-provider rewards stay `connection_required`, and no reward claims provider verification.
  - **Public API:** `POST /api/entries` ignores client-sent `verified`, `providerVerified`, `source`, `provider` and `status` fields and stores the bill as user-reported. `POST /api/rewards`, `/api/bills/verify` and `/api/rewards/bill:electricity/verify` all return 404.
  - The earlier payment, planner, steward, HTTP-security and Postman tests are unchanged and pass.
- **`npm run test:e2e`:** 33 passed and 1 skipped by design, at 1440×1000 and 390×844. New in `test/e2e/estate.spec.mjs`:
  - **Route visibility:** every route space and the travelers stay inside the canvas, clear of the heading, view controls, caption and tier track. Checked at the default view, after turning three times, after zooming out and after a reset; no horizontal overflow and no page errors.
  - **Rewards tab:** shows statuses, "Unlocks when" conditions, exact progress ("$60.00 of $75.00 · $15.00 to go") and evidence. The note says example payments are simulated and no bill provider is connected. There is no verify, connect or mark-paid control.
  - **Previews:** a preview makes no non-GET request, announces nothing and leaves server achievements, progress and reward statuses identical. "Return to my estate" restores the earned tier and estate level.
  - **Announcements:** contributing from $60 to $120 announces "The Manor rises!" together with "The village quarter". A reload announces nothing. A refund announces nothing and turns the quarter into a keepsake, while the world keeps it.

**Screenshots** (`docs/screenshots/`): real example-mode progression through the server at desktop and phone sizes:
- `1-cottage` ($60, porch earned at 10%), `2-manor` ($75), `3-village-quarter` ($120), `4-keep` ($180), `5-ramparts` ($240) and `6-castle` ($300, travelers at the gate);
- `rewards-panel`, `preview-lantern-festival` (a labeled art preview of a provider-locked reward) and `desktop-announcement-village-quarter`.

**Not verified or not built:**
- **Bill verification:** no bill provider is connected, and no SDG&E or other bill status can be confirmed. The bill rewards are labeled proposals (see [BILL-VERIFICATION-RESEARCH.md](BILL-VERIFICATION-RESEARCH.md)).
- **Sandbox household:** the owner's sandbox household was not driven through new payments in this pass.
- **Unchanged items:** the in-page PayPal v6 popup approval, specific-order `get_order` reconciliation and live webhooks remain unverified, as below.
- **Devices:** real phone hardware and assistive-technology passes are still pending.

## November 3, 2026, 11:11 PM PST — live runtime AI (`--ai-only`)

The owner supplied a personal Claude Console API key. It is stored only in the local, git-ignored, owner-readable `.env`; the server was restarted and `/api/status` reports the AI planner in live mode with `claude-opus-5-5`, alongside PayPal sandbox mode. Anthropic's model-list endpoint returned HTTP 200 and included the configured model.

`npm run verify:live -- --ai-only` completed with **6 passed, 0 failed, 1 skipped**. Full evidence: [LIVE-VERIFICATION-AI.md](LIVE-VERIFICATION-AI.md). This run created no PayPal order and needed no payment approval.

- The feasible plan passed the server's schema and arithmetic checks: $240 remaining, covered by eight weekly $30 contributions.
- The impossible-target plan correctly reported a $160 shortfall.
- The house steward answered with the live model, read the household ledger, and listed recent sandbox transactions through the read-only PayPal Agent Toolkit.
- The steward answer contained no unverified monetary figures.
- **Skipped:** reconciliation of a specific household order through `get_order`; this still needs a recorded in-app payment. The browser SDK v6 popup flow and webhooks remain unverified live.

The key-entry helper now accepts personal `sk-ant-usr-` keys as well as legacy `sk-ant-api…` keys. Synthetic regression checks cover the new format and masking without putting any real key in source. The five targeted key-setup tests passed, and `git diff --check` passed.

## November 3, 2026, 10:48–10:58 PM PST — buyer-approved sandbox payment (`npm run verify:live`)

The first full PayPal sandbox payment. The owner approved a $15.00 order with a Personal sandbox buyer account; everything else was automated. The script used a temporary database, so the app's data files were not touched. Test money only. Full output: [LIVE-VERIFICATION.md](LIVE-VERIFICATION.md). **Result: 7 passed, 0 failed, 2 skipped** (the AI checks; no `AI_API_KEY`).

| Check | Result | Evidence |
| --- | --- | --- |
| Server-created order (Server SDK) | PASS | Order `5D424601H2372591L`, $15.00 USD |
| Buyer approval in PayPal | PASS | The owner approved as a sandbox buyer; PayPal order status `APPROVED` |
| Capture verified and credited once | PASS | Capture `72476659YH700454R`. Progress went from $60.00 to $75.00 and the Manor (tier 1) was awarded |
| Replayed capture | PASS | Outcome `already_completed`; progress stayed at $75.00 |
| Mismatched household | PASS | Refused with `order_mismatch` before any PayPal call |
| PayPal's own record matches the receipt | PASS | `GET /v2/checkout/orders`: `COMPLETED`, capture `72476659YH700454R`, 15.00 USD |
| Refund reverses progress once | PASS | Outcome `refunded`; progress went from $75.00 back to $60.00 |
| AI planner (demo goal and impossible target) | PENDING | No `AI_API_KEY` in `.env` |
| House steward with the Agent Toolkit | PENDING | No `AI_API_KEY` in `.env` |

**Checked afterwards with PayPal (read-only):**
- `GET /v2/payments/captures/72476659YH700454R` returns `REFUNDED`, 15.00 USD, `final_capture: true`, with `custom_id` set to the app's contribution id.
- The order lists refund `9U925627HK881213A`: `COMPLETED`, 15.00 USD.

**Prepared afterwards for runtime AI, without a new payment:**
- `npm run set-ai-key` stores an Anthropic Console API key in `.env`, hidden as it is pasted. It was tested through a pseudo-terminal on a throwaway copy with fake values: the key never appeared on screen, PayPal lines and comments were kept, the file mode was 600, and a Claude OAuth token was refused.
- `npm run verify:live -- --ai-only` checks the planner and the steward without creating an order:
  - with no key: it reported the AI checks as pending, called nothing and wrote no report;
  - with a deliberately invalid placeholder key: both reached Anthropic and failed cleanly with `auth`, with no PayPal order created.

  Unit tests: 86 passed, 1 skipped by design.

**Not covered by this run:**
- A *repeated* refund request (the unit tests cover refund idempotency; this run refunded once).
- The browser button's popup approval. This run approved through PayPal's hosted approval link, not the in-page v6 button.
- Webhooks.
- The AI planner and the steward.

## November 3, 2026 (evening) — live PayPal sandbox checks with the owner's credentials

The owner's sandbox REST credentials were added to the local, git-ignored `.env` (`PAYPAL_ENV=sandbox`). Every call below reached the **real PayPal sandbox**. No real money moved, and no buyer approved anything at this stage, so nothing was captured or charged. No AI key is configured yet, so the AI checks are **blocked**.

- **OAuth.** The first attempt returned `401 invalid_client`. A later attempt with the same `.env` returned **200** and an access token. Nothing was changed in between, so the new sandbox app was most likely still activating.
- **Server SDK order** (temporary database, not the app's data):
  - `@paypal/paypal-server-sdk` created a real $15.00 USD order;
  - PayPal returned an approval link on `www.sandbox.paypal.com`;
  - PayPal's own `GET /v2/checkout/orders` showed `PAYER_ACTION_REQUIRED`, `15.00 USD` and the expected `custom_id`.
- **Capture before approval.** PayPal answered `ORDER_NOT_APPROVED`. The app recorded `not_approved`, credited nothing, and progress stayed at the $60.00 already set aside. This confirms against the real sandbox that a redirect or click alone cannot credit a contribution.
- **PayPal Agent Toolkit (read-only, `sandbox: true`).** `list_transactions` returned the sandbox merchant's real history (the $5,000.00 starting balance).
- **JS SDK v6 in the browser** (headless Chromium, real client ID):
  - the core, `paypal-payments`, pixel and locale scripts loaded;
  - `find-eligible-methods` passed on the client ID alone;
  - PayPal's `<paypal-button>` rendered (428×48). It stays disabled until an adult ticks the approval box;
  - zero CSP violations and no page errors.

  The button was not pressed.
- **Client-token fallback: one bug found and fixed.**
  - PayPal accepts only bare domain names (`example.com`). It rejects schemes, ports, `localhost` and IP addresses with `401 invalid_domain`, so the fallback always failed locally.
  - Local hosts now send no domain, and the app's `/api/paypal/client-token` returns a real sandbox token.
  - The fake sandbox now enforces the same rule, with a unit test.

**Still to verify live** at this point: one buyer-approved capture, replay and refund (done later that night; see the section above), and everything that needs `AI_API_KEY`.

After these checks and the rename to Our Castle, the earlier suites still pass: `npm test` (47 verified files, 82 unit tests passed and 1 skipped by design, 25 browser tests passed) and Newman folder 1 (10 requests, 21/21 assertions).

## November 3, 2026 — PayPal tooling pass (official Server SDK, Agent Toolkit steward, AG Grid, Postman)

Environment: macOS, Node 26.0.0 (SQLite 3.53.0), Playwright 1.64.1 with Chromium 156 (software WebGL via SwiftShader), Newman 6.2.1 via `npx`. No `.env` file and no PayPal or AI credentials were present, so every run below used example mode or test doubles.

### What ran and passed

`npm test` (exit code 0):

- **`npm run check`**: 47 copied art/runtime files match their SHA-256 manifest. The original 90-color palette is intact. Both scenes render through the original `PixelRenderer`, and all JavaScript parses.
- **`npm run test:unit`**: 82 Node tests, 81 passed, 0 failed, 1 skipped by design (OAuth token caching is REST-adapter-only; the SDK manages its own token).
  - **Payments:** every payment-safety scenario runs twice, once through the REST adapter and once through the **official PayPal Server SDK adapter**. The SDK runs are driven by stand-in controllers that throw the SDK's real `ApiError`. Scenarios:
    - a completed capture credits once and raises the Manor;
    - replays, concurrent and post-crash retries never double-credit;
    - amount, currency or `custom_id` mismatches are rejected;
    - other households are refused before PayPal is called;
    - pending captures credit only after a verified webhook;
    - declines, cancels and provider errors never count;
    - unverified webhooks are refused;
    - refunds subtract exactly once;
    - adult approval and limits are enforced;
    - request-id reuse is handled, and PayPal's sandbox approval link is returned;
    - progress persists through a restart.
  - **SDK adapter:** it sends PayPal's camelCase request model (`CheckoutPaymentIntent.Capture`, `NO_SHIPPING`, `PAY_NOW`) with `paypalRequestId` and `prefer: return=representation`. `ApiError` maps to PayPal issue names and the debug id. Transport failures become provider errors, while programming errors are not hidden.
  - **House steward:** tested with a scripted fake model through the real Anthropic SDK and stub PayPal tools.
    - Only `read_household_ledger`, `get_order` and `list_transactions` are offered, and `get_order` is limited to this household's order ids. No create, pay, refund, invoice or subscription tool ever appears.
    - Unknown tools and foreign order ids are refused without calling PayPal.
    - Reconciliation verdicts (match, action, differs, unavailable) are deterministic.
    - Dollar figures not present in checked data are flagged, and answers given without any check are flagged.
    - Without PayPal credentials it reads only the ledger; without an AI key it is unavailable; provider errors are reported.
    - The real `PayPalAgentToolkit` with `context.sandbox: true` exposes exactly `get_order` and `list_transactions` against a sandbox base URL. The wrapper refuses production or money-moving tools and builds every argument itself.
  - **Postman files:** v2.1 schema; every request has assertions and a variable base URL; the environment is sandbox-only and ships without credentials.
  - **Unchanged from the first pass:** rules, ledger, planner validation, AI provider request shape, HTTP security (secrets never served, CSP, Host/Origin/JSON guards, mode isolation).
- **`npm run test:e2e`**: 25 Playwright tests passed, 1 skipped by design (keyboard path on desktop only), at 1440×1000 and 390×844. Added since the first pass:
  - the world keeps living: four grazing deer and four butterflies, with the ambient frame count rising while idle. The Sound toggle turns on synthesized audio. A contribution records `scene:hop`, `scene:rise` and `contribution:result` on the event bus and plays the chime, footsteps and fanfare cues;
  - with reduced motion: no ambient loop, and the board updates instantly;
  - the AG Grid ledger renders (`data-grid="ag-grid"`), shows bills and gifts as "No — not savings", and the record filter narrows to bills while the pinned total stays;
  - without an AI key the steward explains it is off and its controls are disabled.

  The earlier journeys still pass: full journey with reload persistence, keyboard path, child persona, impossible target, plan edits, bills/gifts and garden, cancel/decline/pending, refund keepsake, no horizontal overflow, art preview preserved.

**Newman.** Folder 1 of `postman/our-castle.postman_collection.json` ran against a fresh example-mode server: 10 requests, 21 assertions, 0 failures.

**Visual review.** Screenshots of every step at both sizes were compared with the reference PNGs. The steward and ledger were also reviewed through a throwaway harness (real server and UI, fake PayPal sandbox, scripted fake AI) to check layout only. The harness found one false "unverified figure" warning, a milestone amount the steward could not see. The fix: the ledger tool now includes milestones.

### Live reachability checks (invalid placeholder credentials, no account, no money)

These calls reached the real services with deliberately invalid placeholder credentials. They show the endpoints, auth flow and error handling are wired to the real services. They are **not** evidence of a successful payment or AI answer.

- **PayPal Server SDK adapter → `api-m.sandbox.paypal.com`:** HTTP 401, mapped to `PayPalError` (status 401). The order flow would report "PayPal sandbox could not create the order. No progress was recorded."
- **PayPal Agent Toolkit (`sandbox: true`, base `https://api.sandbox.paypal.com`):** `get_order` returned `{"error":{"message":"Failed to fetch access token: Client Authentication failed"}}`, which the steward passes to the model as an error tool result.
- **Anthropic Messages API (`claude-opus-5-5`, structured output, fallbacks):** HTTP 401, mapped to planner error `auth` ("The AI provider rejected the API key in the server .env file.").
- **Browser, server in sandbox mode with a placeholder client id:**
  - PayPal's v6 core script and its `paypal-payments`, locale and pixel resources loaded from `www.sandbox.paypal.com` with **zero CSP violations**, and `window.paypal.createInstance` was available.
  - `findEligibleMethods` rejected the placeholder id ("missing clientToken or clientId auth"). The client-token fallback then ran once and the server's token request got a 401 from PayPal.
  - The Contribute tab showed both reasons and no PayPal button; no page errors; no progress changed.
  - This check led to one fix: the fallback now also covers eligibility-check failures, not only `createInstance` failures.

### PayPal documentation check

PayPal's Node integration guide (developer.paypal.com/guides/node-express, updated October 8, 2026) uses:
- `@paypal/paypal-server-sdk` with `ordersController.createOrder` / `captureOrder` (now used here);
- `createInstance({ clientId, components: ["paypal-payments"], pageType: "checkout" })` in the v6 browser SDK;
- a `createOrder` promise that resolves to `{ orderId }`, passed to `session.start({ presentationMode: "auto" }, …)`.

The browser code matches this. A client-token fallback is kept because some v6 reference pages still describe token-based initialization.

### Dependency audit

`npm audit --omit=dev` reports 11 high and 1 moderate advisories. All come from packages pinned by `@paypal/agent-toolkit` 1.11.0: LangChain core, the Vercel AI SDK, the `openai` client, mathjs, zod and jsondiffpatch.

The toolkit's OpenAI-format entry point, the only part used, loads just `@paypal/paypal-server-sdk`, axios, debug, lodash, mathjs and zod at runtime (checked by inspecting `require.cache`). The two loaded packages with advisories involve untrusted input:
- **mathjs:** unsafe property setting through expression evaluation;
- **zod:** memory use when validating oversized collections.

The steward never passes model text to the toolkit. It sends only a known order id, a server-computed ISO date range and a one-letter status. The server is local-only. Revisit this before any public deployment; a newer toolkit release or dependency overrides may clear it. `npm audit fix --force` was not run because it would change the toolkit's pinned versions.

### Not yet verified (needs the owner's local `.env` credentials)

These are implemented but have **no live evidence yet**. Test doubles, the harness and example mode do not prove them.

Items 1 and 3–5 are automated by `npm run verify:live` (items 1 and 5 passed live on Nov 3, 2026; items 3 and 4 wait for `AI_API_KEY`). The only manual step is approving one order with a sandbox buyer; the script writes `docs/LIVE-VERIFICATION.md`. It was smoke-tested here with no credentials (all sections skipped) and with invalid placeholders (each section failed cleanly, including a real PayPal sandbox debug id, with no progress recorded). Items 2, 6, 7 and 8 stay manual.

1. ~~**Real PayPal sandbox transaction through the Server SDK.**~~ **Verified on Nov 3, 2026.** A buyer approved a $15 order, which was then captured and credited once. The replay did not double-credit, and PayPal's own record matched (see the top section). Postman folder 2 can repeat it by hand.
2. **JS SDK v6 in the browser with a real client id:** eligibility and the `<paypal-button>` rendering are verified live. **Still unverified:** the in-page popup approval, and `onApprove`/`onCancel` reaching the server. The Nov 3 payment was approved through PayPal's hosted approval link, not the in-page button.
3. **Live house steward:** pending until `AI_API_KEY` is set (`npm run set-ai-key`).
   - **Without a new payment:** `npm run verify:live -- --ai-only` checks that the steward answers with live AI, reads the ledger, lists sandbox transactions through the Agent Toolkit, and that its answer triggers no false "unverified figure" warnings.
   - **With the next in-app payment:** the `get_order` reconciliation ("PayPal and the ledger agree") needs a household order. Check it after that payment with the Ledger tab's "Did PayPal confirm our last contribution?".
4. **Live AI plan:** pending until `AI_API_KEY` is set. `npm run verify:live -- --ai-only` checks that `claude-opus-5-5` returns a plan that passes validation for the demo inputs and for an impossible target, and records the latency. No payment approval is needed.
5. ~~**Sandbox refund**~~ **Verified on Nov 3, 2026** through the server's refund path: progress went from $75.00 back to $60.00, and PayPal shows refund `9U925627HK881213A` `COMPLETED`. Still untested live: the Ledger tab's "Refund in sandbox" button in the browser.
6. **Pending and declined captures in the real sandbox** (for example with PayPal's negative-testing tools).
7. **Webhooks (unverified live)** through a tunnel with `PAYPAL_WEBHOOK_ID`: `verify-webhook-signature` returns `SUCCESS` for real deliveries.
8. **Other devices and assistive tech:** real phone hardware, Safari/Firefox, and a screen-reader pass of the AG Grid ledger.

## Earlier passes (November 3, 2026)

**First working prototype:** 53 unit tests and 19 end-to-end tests passed in example mode and against a fake PayPal REST API.

**Starter:** `npm run check` verified the copied files, palette and syntax. An isolated Chromium pass of the original art preview captured the `references/images/our-house-*.png` screenshots with zero page errors.
