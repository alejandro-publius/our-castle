# Validation

## November 3, 2026 — first working prototype (example mode verified; live integrations pending credentials)

Environment: macOS, Node 26.0.0 (SQLite 3.53.0), Playwright 1.64.1 with Chromium 156 (software WebGL via SwiftShader). No `.env` file and no PayPal or AI credentials were present, so every run below used example mode or test doubles.

### What ran and passed

`npm test` (exit code 0):

- **`npm run check`** — 47 copied art/runtime files match their SHA-256 manifest; the original 90-color palette is intact; both `src/art-preview.js` and the new `src/world/board-scene.js` render through the original `PixelRenderer`; all JavaScript in `src/`, `scripts/`, `server/` and `test/` parses.
- **`npm run test:unit`** — 53 Node tests, 0 failures:
  - rules: default demo arithmetic ($60 of $300 is space 4; $15 more reaches the Manor at space 5), milestone rounding, clamping, strict amount parsing, provider decimal strings;
  - ledger: example defaults, bills/gifts never count (also refused by a database CHECK constraint), persistence after closing and reopening the SQLite file, goal validation, members locked after a contribution;
  - payments (against a stateful fake PayPal sandbox API): server-owned order body and idempotency headers; completed capture credits once and awards the Manor; replay, concurrent and post-crash retries never double-credit; amount, currency or `custom_id` mismatches are rejected; a capture for another household/goal is refused before PayPal is called; pending captures credit only after a verified webhook, once; declines, cancels and provider errors leave progress unchanged; unverified or unconfigured webhooks are refused; API refunds and dashboard refunds (by webhook) subtract exactly once while the keepsake stays; adult approval, limits and over-goal checks; request-id reuse; token caching; example and sandbox modes cannot cross over; sandbox progress survives a restart;
  - planner: demo basis (eight weeks of $30 covers $240), impossible target with exact shortfall and alternative date, uneven remainders, valid AI output accepted, invalid AI output rejected for negative/fractional cents, over-budget weeks, wrong totals, wrong dates, missing weeks, false feasibility, fabricated dollar figures and missing explanation; invalid output is not stored and a labeled rules fallback is offered; provider errors are reported; household edits are re-validated; plans use current progress;
  - AI provider (real Anthropic SDK 1.4.0 against a fake transport): request uses only the explicit `AI_API_KEY` (sent by this SDK version as `Authorization: Bearer`), `claude-opus-5-5`, JSON-schema structured output, `effort: medium`, `fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta; refusals, truncation, invalid JSON, auth and rate-limit errors become typed planner errors; the schema avoids unsupported keywords; config never reads `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` and accepts only the sandbox PayPal environment;
  - HTTP server: no configured secret appears in any page or API response; `.env*`, `server/`, `data/`, `node_modules/` and `package.json` are not served; CSP per mode; cross-site writes, rebinding `Host` headers, non-JSON and oversized bodies are refused; full sandbox HTTP flow with the fake API (mismatch refused, capture credits once, replay safe, simulated endpoints and reset disabled in sandbox mode); webhook route requires PayPal signature verification; plan endpoints.
- **`npm run test:e2e`** — 19 Playwright tests passed, 1 skipped by design (the keyboard-only path runs on desktop only), on desktop 1440×1000 and phone 390×844:
  - full journey: found a family house with a custom crest → example plan with arithmetic → adult approval → simulated $15 contribution → simulated receipt → travelers move from space 4 to 5, the Manor geometry replaces the cottage (canvas pixels change), celebration shown without hiding the receipt → reload keeps $75.00, space 5 and the Manor → ledger shows the completed contribution and keepsake; no page or console errors;
  - keyboard only (Tab, Enter, Space, arrow keys) through house, plan, approval and contribution;
  - child persona cannot approve; impossible target shows the shortfall; household edits re-checked; bills and gifts grow a garden without moving the travelers; cancel/decline/pending leave progress unchanged until the simulated completion; a refund lowers progress and walks the travelers back while the Manor stays as an explained keepsake;
  - no horizontal overflow in any tab at either size; amounts at least 24 px (progress) and 16 px (inputs);
  - `/art-preview.html` still renders and switches tiers with no errors.

Visual review: screenshots of every step at both sizes were compared against `references/images/our-house-*.png`, `pixel-battlefield.png`, `color-and-heraldry.png` and `phone-reference.png`. The scene keeps the orthographic toy-scale island, dark contours, dither and palette; panels use the parchment/brass/teal tokens and the bundled Uncial Antiqua and Alegreya Sans files.

### Not yet verified (needs the owner's local `.env` credentials)

These are implemented but have **no live evidence yet**. Test doubles and example mode do not prove them.

1. **Real PayPal sandbox transaction.** With sandbox credentials, approve a $15 order with a sandbox buyer and confirm: the server capture succeeds, the receipt shows real order and capture ids, the same ids appear in the sandbox dashboard, and progress moves once. Then replay the capture request and refresh: no double credit.
2. **JS SDK v6 in the browser.** Confirm `createInstance({ clientId })` (or the client-token fallback), `findEligibleMethods`, the `<paypal-button>` element, `session.start({ presentationMode: 'auto' }, …)` with a promise of `{ orderId }`, and `onApprove`/`onCancel`. Check the console for CSP violations from PayPal's domains.
3. **Sandbox refund** through the Ledger's "Refund in sandbox" button reduces progress exactly once.
4. **Pending/declined captures in the real sandbox** (for example with PayPal's negative-testing tools) leave progress unchanged.
5. **Webhooks**: through a tunnel with `PAYPAL_WEBHOOK_ID`, confirm `verify-webhook-signature` returns `SUCCESS` for real deliveries, a pending→completed capture credits once, and a dashboard refund is applied once.
6. **Live AI plan.** With `AI_API_KEY`, confirm `claude-opus-5-5` returns a plan that passes the server's validator for the demo inputs and for an impossible target, and note latency. If real output is rejected too often (for example by the dollar-figure check), tune the prompt rather than loosening validation.
7. Real phone hardware, Safari/Firefox and screen-reader passes were not done (Chromium emulation and an automated keyboard path only).

## Earlier: starter validation (November 3, 2026)

`npm run check` verified the 47 copied files, the palette and syntax. An isolated Chromium pass loaded the original art preview, visited all four tiers, toggled pixel/raw rendering and captured the `references/images/our-house-*.png` screenshots with zero page errors and no phone overflow. That pass validated only the art starter.
