# Connected experience: merchant, Treasury, APIMatic

**Current owner Mac:** the active 3010 app uses `~/projects/our-castle-reviewed`; its ignored environment/data links preserve the originals. Keep `~/projects/our-house` at its existing source while the separate 3021 rehearsal is preserved. Source is public. Read [release readiness](RELEASE-READINESS.md#current-mac-app) before local edits; older activation/workstream notes below are historical.

The reviewed build is on canonical `main`, promoted from `feature/connected-experience` (implementation handoff `68e1c61`, based on `877764e`). The feature worktree is retained for reference. The nine-district forest, four-tab journal, art, palette, fonts, clouds, rivers, bridges, farm, tavern, avatars and unlock cards are unchanged.

## Current status of the three tools

| Tool | Working experience | Evidence limit |
| --- | --- | --- |
| Channel3 | Market merchant → up to three results → unsaved Plan draft → explicit goal save | One earlier real desktop search; complete family flow and error contracts tested with fakes. Live phone/save was not repeated. |
| AG Grid / Studio | One next-area widget, records/receipt/map visit; Studio Agent Framework manages the existing scoped steward | Actual harness/custom runner and fallback checked with fake providers; subsequent same-order live steward verification passed. No extra chat panel. |
| APIMatic | Eight enabled Codex SDK-context skills used for PayPal fixes and checks | Context use is demonstrated; it is not a runtime payment service or a prize guarantee. New read deadlines and dependency findings are in [TOOLKIT-MAINTENANCE.md](TOOLKIT-MAINTENANCE.md). |

The complete family flow has 26 passing browser checks from [the usability review](FAMILY-FLOW-REVIEW.md). The maintenance follow-up adds 40 focused sponsor/payment contract passes and five post-install compatibility passes without provider calls. The subsequent [owner-completed $15 sandbox contribution and actual same-order `get_order`](IN-APP-SANDBOX-VERIFICATION.md) passed: one credit to $75, Manor open and server reconciliation `match`. Do not repeat paid checks or create another order based on this older handoff. The current app/source/recording limits are in RELEASE-READINESS.md. No new key is needed for visual work.

| Commit | What |
| --- | --- |
| ff3f923 | Market Town merchant: Channel3 search, explicit goal draft, server-only adapter |
| 4abecac | Treasury in the Ledger: AG Studio next-area widget, records, receipts on tap |
| 20c8ae2 | Merchant follow-up (Codex review): confirmed goals use the actual item price; family-facing copy |
| 5d06e57 | APIMatic-informed PayPal review: uncertain captures settled from the same order, never "failed" |
| a4ed597 | Follow-up (Codex review): a webhook-settled order stays settled after a stale read |
| (this commit) | Combined journey check and this handoff |

## The family journey and where to find it

1. **Plan → Find an item**, or **Market Town → Merchant**. Search what the family is saving for, with an optional budget. Up to three rows show image, name, price and currency, merchant and returned availability; details and the retailer link are secondary.
2. **Plan.** **Use as goal** fills the Plan form as an unsaved draft. **Save as our goal** is the ordinary goal edit at the actual price (or a deliberately higher amount). Already-tracked progress may then open an area with its usual deed. No money moves. See [CHANNEL3-MERCHANT.md](CHANNEL3-MERCHANT.md).
3. **Contribute.** Unchanged: exact-amount adult approval, then sandbox checkout (or a labelled simulation in example mode). The server verifies the capture and credits once. See [APIMATIC-USAGE.md](APIMATIC-USAGE.md) for the uncertain-capture fix.
4. **World.** Areas open only through canonical progress against the current goal, with the existing deed.
5. **Ledger → Treasury.** One next-area milestone ("View on map"), the existing record grid (search and filters change only the list), and a receipt on tap that leads back to the area it opened. Explicit **Check with PayPal** results now persist on the receipt; earlier checks stay in closed Payment details. The existing steward stays closed at the end. Studio's Agent Framework manages explicit steward questions without adding another chat panel. See [TREASURY.md](TREASURY.md).
6. **Return.** Reload keeps the confirmed goal and item, records and earned world. It works with the keyboard and on phones.

Searching is not checkout. A contribution does not buy the Channel3 item or pay any outside bill.

## Run and configuration

Codex has eight SDK-specific APIMatic/PayPal repository skills installed and discovery-verified; see [APIMATIC-CODEX.md](APIMATIC-CODEX.md).

- **Install.** `npm ci` is needed: `ag-studio@3.0.0` is a new pinned dependency. Without it the Treasury shows its plain fallback.
- **`.env` (server-side only).**
  - `CHANNEL3_API_KEY` enables the merchant.
  - `AG_STUDIO_LICENSE_KEY` holds the AG Studio evaluation licence: one application, no production use, expiring December 2026.
  - Both are already in the owner's ignored `.env`.
- **Run.** `npm start`, then open http://localhost:3010. The start-up lines read `Merchant: Channel3 product search` and `Treasury: AG Studio evaluation licence set`. On first start, the database gains the empty, additive `goal_items` table (migration 3); nothing else changes.
- **Owner app updated (2026-11-05 08:38 UTC).** Codex installed the exact lockfile and restarted only 3010. Schema 2 → 3 adds an empty `goal_items` table. Every row in all ten prior application tables matches the consistent SQLite backup; `.env` content, mode and modification time match too. SQLite's internal sequence counter advanced during initialization and was preserved.
- **Passive checks.** HTML, main/merchant/Treasury modules and the Studio bundle match the reviewed bytes. Sandbox payments, live-AI configuration, Channel3 and the Studio licence are configured. These reads made no provider call. Ignored reports/private backups: `test-results/connected-promotion-20261105T083131Z/`.
- **Coordinator unchanged.** The 3021 rehearsal and its database stayed intact; no checkout, recording or paid check occurred during promotion.

## Evidence: live versus fake

| Check | Kind | Result |
| --- | --- | --- |
| One Channel3 search, "camping tent" ≤ $250, through the real desktop flow (2026-11-05 07:13 UTC) | **Live** (owner-authorized, one free credit, isolated in-memory app, PayPal/AI absent) | Three real USD products, CDN images rendered, documented schema matched |
| AG Studio licence in the installed 3.0.0 SDK | **Local, real SDK** (licence loaded alone, in memory) | Valid `STUDIO-PRO-AI` trial, expires 19 Dec 2026, no licence console messages |
| Merchant: 11 unit and 6 browser cases | Fake Channel3 | Pass |
| Treasury: 3 unit and 6 browser cases | Simulated example payments | Pass |
| PayPal uncertain outcomes: 7 unit cases | Fake PayPal sandbox via the official SDK adapter | Pass; changed cases fail against the earlier code or the reviewed defects |
| Combined journey: search → draft → confirmed goal → adult-approved simulated contribution → Manor and Market Town deeds → Treasury milestone, mixed sources, filtering, receipt → map → reload (desktop and phone) | Fake Channel3 and simulated payments | Pass |
| Unit suite and 47-file art/palette guard | — | 161 cases: 160 pass, 1 existing skip; guard passes |

No new PayPal order, refund or paid AI call was made, and nothing was deployed or published.

At the implementation handoff, four browser cases failed identically on unmodified `main` 877764e:
- area-cards :87, a threshold-text expectation;
- area-cards :234, Citadel focus;
- estate :67, which expects the old 164-wide region;
- journey :216, a canceled-record receipt.

The subsequent [family-flow review](FAMILY-FLOW-REVIEW.md) resolves these expectations/navigation checks and the additional WebKit setup and duplicate-grid defects it uncovered. Current outcomes are at the top of [VALIDATION.md](VALIDATION.md); the earlier results above remain historical evidence.

## Sources credited

- **Channel3:** official docs and OpenAPI (https://channel3.ai/docs/, `/docs/openapi/openapi.json`), including the caching guidance and the required commission disclosure.
- **AG Studio:** official JavaScript docs (quick start, custom widgets, licence install) and the installed type definitions.
- **APIMatic:** the earlier API-level review used published generic skills (marketplace `7cbdf85`). Codex now uses the SDK-specific PayPal Server context, installed as eight repository skills from `6aa0571`; source and discovery proof are in APIMATIC-CODEX.md.
- **Webinars:** the published descriptions and chapters of the PayPal Developer and Devpost sessions of October 6, 7, 12 and 13. Only descriptions and chapters were reviewed, not watched talks or transcripts. Their guidance was applied:
  - the grid session (async data source, filters versus the real query contract) to the Treasury;
  - the Context Plugin and unhappy-path sessions to the PayPal review.
- **Projects:** the owner's competitor review was read for awareness only. Nothing was copied, and nothing is claimed as unique.

## Remaining blockers and owner steps

- **Not exercised live:** the phone render and the draft/save with a live item. A second credit was not spent; both are covered with fakes.
- **Sponsor conditions.** Codex successfully read the official public [Channel3 brief](https://paypalaihackathon.devpost.com/details/channel3) on November 5: meaningful API/MCP use is required; the real merchant search supplies that evidence. The credit promotion was not applied. [Award notes](AWARD-STRATEGY.md) distinguish the actual Studio framework/custom-runner use from prize guarantees and formal entry requirements.
- **AG Studio.** Evaluation only. Production use needs the owner's commercial decision.
- **PayPal popup rehearsal.** The coordinated in-app popup → single credit → exact-order `get_order` rehearsal remains with its existing 3021 operator. Nothing here is live PayPal proof.
- **Submission.** The owner has requested the release work. [Release readiness](RELEASE-READINESS.md) records source publication, existing art notices and the actual remaining video/Devpost blockers. No new video or paid-provider test was made in the framework pass.

Accounts: Channel3 needs a developer key, which is in place and was used once. AG Studio's trial licence is in place and validated. APIMatic's PayPal context needs no account.
