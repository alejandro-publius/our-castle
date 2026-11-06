# Historical family journey and browser review

Historical pass from earlier November 5, 2026, before source publication and the completed in-app payment. At that time the Mac connection was offline and the last inspected owner checkout was `791e8ae`; this report did not activate a local app. The source is now public, Studio's Agent Framework is implemented, and the in-app contribution/exact-order check has passed. [Release readiness](RELEASE-READINESS.md), the top of [VALIDATION.md](VALIDATION.md) and the [current judge handoff](JUDGE-HANDOFF.md) supersede the runtime/workstream statements below. Preserve this report as evidence of its recorded tests.

## What changed

- **Visit your castle** closes the journal, focuses the castle's map plaque and leaves it on screen, using the same navigation as Treasury receipts. Visiting writes no household record.
- **House setup** redraws only for mode/crest changes. A name-field blur no longer rebuilds the scrollable panel during a click; this fixes the dropped first Save click reproduced in WebKit.
- **Treasury loading** mounts one grid when several updates await the same script. A deliberately delayed script and repeated Ledger clicks produced three grids before the fix. The guard prevents duplicate records and selection controls.
- The three stale assertions now match the actual $225 remaining, the 228×132 realm, and receipts selected individually from the grid. Failed/pending attempts still count nothing; a completed contribution credits once.

No new screen, explanatory card or disclaimer was added. The nine woodland districts, original rendering, buildings, bridges, family avatars and short deeds remain.

## Family playtest

The connected test now starts at the actual House form. It opens the merchant with the keyboard, searches a fake Channel3 catalogue, confirms a $189.50 goal, reviews and accepts a built-in plan, explicitly approves a simulated $20 contribution, receives the Manor/Market deeds, selects its Treasury receipt and visits the map. Reload preserves the goal, item, accepted plan, $80 progress and earned areas. Reported starting progress remains separate from the simulated contribution.

These are isolated example-mode tests, not live payment or runtime-AI proof. Merchant, plan and Treasury stills were inspected at desktop and phone sizes. The review uses Chromium and Linux WebKit with reduced motion, at 1440×1000 and 390×844 touch sizes. It does not establish physical-device, macOS Safari, Firefox or screen-reader results.

Actual outcomes: **24 functional checks plus two normal-motion castle-navigation checks passed**; details and limits are in [VALIDATION.md](VALIDATION.md). Ignored cloud evidence/configurations: `test-results/family-finish/`; stills: `test-results/connected/`. The functional configuration extends standard Playwright with reduced motion; its WebKit variant switches engine and removes Chromium-only launch arguments. The separate normal-motion check uses the standard configuration, with a bounded 60-second settling wait for the complete route on software renderers. No animation was shortened.

## Sponsor and release position at that earlier pass

The official [Channel3](https://paypalaihackathon.devpost.com/details/channel3), [AG Grid](https://paypalaihackathon.devpost.com/details/aggrid), [APIMatic](https://paypalaihackathon.devpost.com/details/apimatic) briefs and [entry rules](https://paypalaihackathon.devpost.com/rules) were rechecked:

- Channel3 has meaningful merchant search, including the earlier recorded real call. No new credit was spent.
- At this earlier pass AG Studio supplied the themed next-area widget and its Agent Framework was absent. The subsequent implementation is documented in [TREASURY.md](TREASURY.md); no full prize-coverage claim is made here.
- Eight installed, discovery-verified APIMatic/PayPal skills support Codex directly. See [APIMATIC-CODEX.md](APIMATIC-CODEX.md).
- At this pass development was private and publication was an owner decision. Source was subsequently published; final public video and submission remain outstanding. See RELEASE-READINESS.md for current scope.

At this pass the approved 3021 rehearsal was preserved but browser access and exact-order `get_order` proof were still outstanding. No payment or paid check was run by this review. The subsequent [owner-completed contribution and actual same-order verification](IN-APP-SANDBOX-VERIFICATION.md) closed that runtime gap. Utility-provider verification remains unconnected.
