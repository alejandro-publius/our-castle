# Validation

## Merchant drafts after a catalog change (PR #23 merged into PR #20) — November 6, 2026

Codex's PR #23 (`review/merchant-freshness`, head `dddb951`, based on `1de17ba`) was reviewed and merged into `claude/shared-live-integration` by a normal merge (`0f7dca5`).
- The change is confined to `server/merchant/channel3.mjs` plus tests. No file it touches had changed on this branch since `1de17ba`, so the merge was clean.
- Nothing was merged into `main` or activated.
- Codex's notes are in [MERCHANT-FRESHNESS-REVIEW.md](MERCHANT-FRESHNESS-REVIEW.md), and the behaviour is in [CHANNEL3-MERCHANT.md](CHANNEL3-MERCHANT.md#freshness-and-cheaper-alternatives--november-6).

**Review, behaviour by behaviour.** All five behaviours hold, and family mode is preserved.
- **Changed price, stock or a missing item.** Each lookup records an offer's facts under its identity.
  - The identity is product, retailer, condition and selected variant. The facts are price, currency, stock, condition, variant and whether it can be used.
  - A newer answer that contradicts them deletes older drafts for that offer at once, and so does a catalog 404.
  - Unit cases cover a higher price, out of stock and a 404. In the higher-price case the stale save is refused with nothing changed, and the fresh draft then saves at $249.
- **Cached lists and late answers.** A cached search list that points at an expired draft is dropped. Each lookup is numbered when it starts, and an older answer that contradicts a newer one is refused (410) before it creates drafts or fills the cache. Unit cases cover a slow older search after a newer refresh, and a slow older refresh after a newer search.
- **What stays usable.** Equal facts keep their drafts and the cache, where only a link, title or photo changed. Other retailers, conditions and sizes keep theirs. A timeout, failure or malformed answer invalidates nothing, and identical refreshes still share one call.
- **Budget.** Unchanged, and still enforced on the server.
  - Budgets outside $1–$100,000 are refused.
  - Cheaper options keep the stricter ceiling and the local stock, currency and price filters.
  - Budget is not one of an offer's facts, so a search with another budget never expires a draft.
- **No purchase or silent goal change.** Expiry only edits in-memory maps: no provider call and no database write. The family goal changes only through **Save as our goal**. The new browser case checks that goal, ledger and contributions are unchanged after the refused save, and that edits stay.
- **Family mode, preserved.**
  - Merchant routes keep their adult rules and household checks.
  - PR #22's re-checks and the renewed-sign-in fix (`264d5c2`) are intact.
  - Search, refresh and cheaper options still announce nothing on the live stream.

**Observations, no change.**
- **Ordering.** Lookups are ordered by when they start on this server, not by when the retailer updated its data, as PR #23 notes. If Channel3's search index lagged its product details, a newer search could bring back a price that a refresh had replaced.
- **Variants.** A refresh compares the selected variant too. If real product details report a default variant that search results leave out, a refresh would expire an unchanged search draft and ask for review. The fake catalog has no variants by default and no real Channel3 response is recorded in the repository, so this is unverified. No live call was made.
- **Shared facts.** The record of offer facts is shared by all families, since it holds public offer facts only. One family's refresh can expire another family's out-of-date draft for the same offer, which then asks for a fresh search. It grants no access: household checks still decide who may use a shown result.

**Checks** (fake Channel3 and fake PayPal; no real order or paid call):
- **Unit:** `channel3-merchant` 19/19, `merchant-freshness` 9/9 (new), `family-sponsor` 1/1.
- **Browser, desktop and 390 px phone:** **27 passed, 1 deliberate one-viewport skip, 0 failed.**
  - All nine `channel3-merchant` cases, including PR #23's new one, and both `connected-journey` Merchant cases: 22 passed (6.7 min).
  - `plan-check`'s two market-draft cases: 4 passed.
  - `shared-live`'s three-member case, which saves a fake Channel3 product in family mode only after **Review latest goal**: passed on desktop, skipped by design on the phone.
- `npm run check` passed.

**Limits.** The catalog is fake throughout: no live Channel3 search, refresh or cheaper-options call. Only the Merchant browser cases listed ran; the full browser suite was not rerun.

## Shared families, live: access re-checked during waits (PR #22 merged into PR #20) — November 6, 2026

Codex's PR #22 (`review/family-revocation`, head `f91a0d3`, which already contained PR #20 through `f6535f8`) was reviewed and merged into `claude/shared-live-integration` by a normal merge (`40b65ee`). Nothing was merged into `main` or activated. Codex's notes are in [FAMILY-ACCESS-RACE-REVIEW.md](FAMILY-ACCESS-RACE-REVIEW.md), and the behaviour is in [FAMILY-ACCESS.md](FAMILY-ACCESS.md).

**Review, behaviour by behaviour.** All five behaviours hold on the merge. One page-level defect was found and fixed (below).
- **Removed or expired members.** A family write is authorized again after its body arrives and before anything runs. The planner checks again after its model wait and before validating or storing a plan; this also covers invalid and failed answers. Every private answer, success or error, is checked again when it is sent. An ended request gets the normal 401, with no receipt, plan or state.
- **Steward.** It checks before and after each model turn and before each tool. An access error passes through `mapAnthropicError` unchanged, so it is never turned into a provider answer or fed into another model turn.
- **Re-checks.** They read the session without counting as activity and never clear a cookie. The active controls keep `last_seen_at` unchanged, and after a renewed sign-in the newer cookie keeps working. Only the first check on arrival clears a dead cookie, as before.
- **Already-dispatched money.** Capture, refund and order creation go to PayPal straight after the re-check. Their results are recorded once (same request ids, the in-flight guard and settled-status checks are unchanged) before the reply is withheld. The owner recovers a capture without a second one.
- **Still working.** Sign-out is exempt from the response check because it ends its own session. The webhook stays a machine route, streams return before the response check, and live notices still go out in the handler's `finally`.
- **Observations, no change.**
  - The `goalId` comparison cannot fire in family mode, because goals are created with the household and only updated in place, so `409 scope_changed` is defensive.
  - A Merchant look-up already sent can still fill that household's own short-lived result cache, as PR #22's notes say.
  - One narrow window remains before a capture or refund is sent. When the PayPal client has no cached OAuth token, it fetches one first. If access ends during that fetch, the capture or refund still goes out, though it is then recorded once and its reply withheld. A check after the token fetch would belong in Astra's payment code, so it is left for Astra and Codex.

**Defect found and fixed: a refused answer ended the page after a renewed sign-in.**
- **Cause.** The server now refuses (401) a request that was under way when the same browser signed in again as the same member in another tab. The newer cookie survives. But the page treated every 401 as the end of its session, so it asked for the passkey even though the browser was signed in.
- **Reproduced** in a new `family-access.spec.mjs` case.
  - A plan request waits on a gated fake planner.
  - A second tab, opened while signed out, signs in with the owner's passkey (copied to that tab's virtual authenticator).
  - The planner is then released. Before the fix, the first tab showed the sign-in dialog with "Your session ended. Sign in again with your passkey." while the second tab was signed in as Rowan.
- **Fix** (`src/app/api.js`, `src/app/main.js`).
  - On such a 401 the page checks `/api/session` first.
  - If this browser is still signed in as the same member of the same household, it keeps the page with the newer CSRF token. The renewal still clears an earlier approval.
  - The request then reports "This browser signed in again while this was in progress. Check the latest records before trying again." It is not retried.
  - Anything else ends the page as before. The stream's own session endings and a state for another member also end it at once. Example mode is unchanged.
- **After the fix,** the case passes 3 of 3. The first tab stays signed in, no plan is saved from the refused answer, and the same request then succeeds with the newer session.

**Checks** (fake planner, fake model transport, fake PayPal; no real order, provider or model call):
- **Unit:** `family-access` 18/18, `family-runtime-boundaries` 9/9, `family-live` 7/7. That is 34 passed, 0 failed, both on the merge and on the final tree.
- **Browser on the merge as is** (`family-access`, `shared-live`; desktop and 390 px phone): 8 passed, 8 deliberate one-viewport skips, 0 failed (4.6 min).
- **The new case:** 1 failed before the fix (as above), then 1 passed, then 3 of 3 repeats.
- **Browser on the final tree** (`family-access`, `shared-live`; desktop and 390 px phone): **9 passed, 9 deliberate one-viewport skips, 0 failed** (4.9 min), the new case included.
- `npm run check` passed, and `git diff --check` is clean.

**Limits.**
- The renewal is a second tab in one Chromium context with a copied virtual credential, not a real device.
- The new browser case runs on desktop only, like the other viewport-independent family-access cases.
- The full browser suite was not rerun. Only `family-access` and `shared-live` ran, since this change touches only family-mode session handling.

## Shared families, live: one integrated build and dependable cross-device updates — November 6, 2026

Claude branch `claude/shared-live-integration` from `main` `86c8287` (PR #20; not merged or activated). Normal merges of #19 (with #16) and #17, then live updates for shared families. See [FAMILY-ACCESS.md](FAMILY-ACCESS.md#live-updates).

- **Integration.** One migration sequence: main's four SQL steps, then checked steps `goal-project-kind` (5), `merchant-selection` (6) and `family-access` (7). Branch-only schemas 5 and 6 are named and re-checked from step 5; a newer schema is refused. Exact pins kept: `@simplewebauthn/server` 14.0.3, `@simplewebauthn/browser` 14.0.0, `ag-grid-community` 36.3.0, `ag-studio` 3.1.0. Merchant refresh and alternatives have explicit adult rules, use the request's scope, and accept a shown result only from the household it was shown to, before any provider call.
- **Live updates.** `GET /api/events` (members only) carries only an event name and a household revision; pages re-read `/api/state`. Revisions order every state answer; streams and background reads never extend a session; streams end at once on sign-out, removed access, a renewed sign-in and expiry; connections are bounded; reconnects back off and check the session; one compact Reconnect control.
- **Work in progress.** Unsaved Plan fields, trials, Merchant drafts, avatar and invitation fields stay; an approval is cleared once if its goal or sign-in changed, and kept through unrelated updates and reconnects; the Ledger keeps filter, search, sort, selection and keyboard position; a focused map marker keeps the keyboard.
- **Keyboard fix that also affects example mode.** A deed's late `close` event no longer takes focus back from where the family has gone (see the area-cards note below).

**Upgrade check against the real branches.** Each source branch's own `openDatabase` (main, goal-projects, sponsor-depth, shared-family-access, extracted by `git cat-file`) wrote a throwaway file at its schema (4, 5, 5, 6); the integrated build opened each: all reached schema 7 with exactly a fresh database's schema, rows kept, reopening idempotent, and the explicit warning for 5 and 6. Not committed (it needs the branch sources); `test/unit/migration-integration.test.mjs` rebuilds the same schemas from the identical statements.

**Unit: 291 cases, 290 passed, 1 pre-existing skip.**
- New `family-live` (7): the changed household only, a bare revision, ordered answers; quiet reads, calculations, look-ups and access refusals; a fake Channel3 goal; one contribution, one credit, one notice per page; access removal, renewal, sign-out and idle expiry ending streams, with no session extension; bounds and release of every stream and the timer; a verified fake-PayPal webhook telling only its household; a real restart; example mode.
- New `family-sponsor` (1): a child and another family refused on every Merchant route and the steward before the fake Channel3 or fake Anthropic transport is reached; the adult's refresh, cheaper alternatives, save and steward answer stay in their household.
- New `migration-integration` (3): every earlier schema to the fresh one; a newer schema refused and untouched.
- Changed: the family HTTP helpers moved to `test/helpers/family-http.mjs`.

**Browser.** New `shared-live.spec.mjs` (4 cases, desktop 1440×1000 and emulated 390×844 touch phone), each person a separate context with a virtual passkey; requests leaving the server origin refused and recorded (none were):
- three members and a separate family through goal, Build, trials, avatar, invitation, an unrelated change that moves nothing being edited and keeps a given approval, a goal change that clears it, two contributions (one credit each; Manor Gardens deed on every family page), the keyboard kept on a visited map marker through live updates with and without a marker rebuild, Ledger and weekly Treasury, the Treasury record link, a fake Channel3 product after Review latest goal, child limits, access removal and cleanup;
- a connection cut while offline, the Reconnect control (clicked while still offline, so it never races the automatic reconnect), catching up when the network returns and by itself after a second drop, and idle expiry during the connection;
- a real restart of `scripts/family.mjs` with both pages reconnecting in the same document, and an approval given before it kept (same session) and paid once after it;
- two 390 px phones and the Reconnect control's fit.

`family-access.spec.mjs` now expects changes live (no focus nudge) and the removed-access reason.

**Focused regressions (18 related suites, desktop and phone, 42.4 min): 157 passed, 15 deliberate viewport skips, 10 failed.**
- Eight failures (`channel3-merchant` ×2, `connected-journey` and `area-cards`, each on both projects) came from an intermediate version of this branch that held a newly opened area's deed while focus was in a text field. After "Save as our goal" the page focuses the goal name, so the family's own deed waited. That deferral was removed; deeds show at once, as on main.
- The other two are `journey.spec.mjs` "cancel, decline and pending outcomes…" on both projects. It expected "Nothing was charged", text that `origin/main`'s app has not rendered since `1dd3952`, so it fails on main as well. The test is now corrected (see below).

**After removing the deferral and keeping approvals across reconnects** (`shared-live`, `family-access`, `channel3-merchant`, `connected-journey`, `area-cards`; desktop and phone, 20.6 min): 44 passed, 10 deliberate viewport skips, 2 failed on desktop. Both were diagnosed and fixed:
- `area-cards` "four journey tabs … visits the castle" was not caused by the live work.
  - It also fails on `origin/main` (2 of 2 repeats) and at `944457f` (3 of 3; one earlier pass there ran under heavy load).
  - After **Close all**, the browser returns focus at once, but the dialog's `close` event can wait behind busy software-rendered frames.
  - When that event arrived after **Visit your castle** had hidden the journal, `deedClosed()` fell back to the Journal button and took the keyboard from the castle marker. A focus log caught it: castle in, then castle out to `#journal-toggle` in the same millisecond.
  - The handler now never takes focus back from where the family went. With the fix, 3 of 3 repeats passed.
- `shared-live` "a dropped connection …" was a race in the test.
  - Its Reconnect click, made just after the device came back online, raced the page's own reconnect. When the page won, the control was correctly gone and the click waited until the test timed out.
  - The click now happens while the device is still offline and checks that a new stream attempt leaves at once. Every earlier assertion is kept.
- With the same fixes, live updates no longer rebuild the map's buttons unless an area opens or closes or the Build choice changes, and a rebuilt button keeps its place and the keyboard. The three-member journey now checks both cases.

**Final affected run** (`area-cards`, `shared-live`, plus `realm-focus`, `realm` and `goal-projects`, which exercise the map buttons; desktop and phone, 13.7 min): **37 passed, 9 deliberate viewport skips, 0 failed.** `family-access` was not rerun: no authentication code changed after its last pass in the run above. Unit: 291 cases, 290 passed, 1 pre-existing skip. `npm run check` passed.

**Journey status case corrected.** Only the `journey.spec.mjs` change from PR #24 (`a82079b`) was applied, plus one added check. PR #24's other changes (its focus fix, `area-cards` and `shared-live` checks, screenshots and notes) were not; this branch's own fixes for those failures are in `9e764fc` and `dcbe2db`, and its captures and provenance are unchanged.
- It uses the current labels: **Checkout window closed.** after a closed checkout, and **Checkout closed** in the Ledger.
- After each canceled, declined and pending attempt, the page's state still has $60.00 of progress, those three statuses and no credited capture. Completing the pending one credits exactly one capture ($75.00), and the count is still one after the failed records are selected.
- The failed-record selection checks are kept: the closed and declined rows read "No — not counted", and selecting each shows only its receipt, with no completion or refund action, and leaves the total at $75.00.
- Only this case runs with reduced motion. Normal route animation and deed timing stay covered by the other journey cases and `area-cards.spec.mjs`.
- Before, on this branch at `dcbe2db`: 2 failed (desktop and phone) at the first check, which expected "Nothing was charged" and received "Checkout window closed. Check the contribution record before trying again."
- After: **2 passed** (desktop 17.1 s, 390 px phone 14.7 s). Repeated three times on each project: **6 of 6 passed**. It ran in example mode with simulated payments and no credentials (every step, completion included, goes to `/api/example/…`); no PayPal order or provider call.

Captures: `docs/screenshots/shared-live-*.png` with [provenance](screenshots/shared-live-sources.json).

**Limits.**
- One server process and one SQLite file, as before; live state (revisions, streams) is in memory and restarts with the server. Several server processes would need a shared notifier.
- The dropped connection is Chromium offline emulation plus the server closing its connections, not real network loss; the virtual authenticator is not a real device; the browser checks ran in headless Chromium only.
- Fake Channel3, PayPal and Anthropic transports only: no provider, payment, order or model call. PayPal sandbox through the browser in family mode was not exercised.
- The full browser suite was not rerun; only the suites and the journey case listed above.
- Owner apps on 3010 and 3021, their `.env`, checkout and databases were not touched; no deployment, video or submission. Rachel's real family playtests remain open.

## Shared families: passkeys, invitations and permissions — November 6, 2026

Claude branch `claude/shared-family-access`, stacked on `claude/goal-projects`; not merged or activated. See [FAMILY-ACCESS.md](FAMILY-ACCESS.md).

- **Mode and data.** This is an opt-in family access mode (`npm run family`, or `OUR_CASTLE_ACCESS=family` plus an exact `OUR_CASTLE_ORIGIN`). It uses its own database file. Migration 6 adds new tables only.
- **Library.** WebAuthn uses `@simplewebauthn/server` 14.0.3 and `@simplewebauthn/browser` 14.0.0, pinned exactly.
- **Unchanged.** Example mode and the example household are unchanged.

**Unit: 268 cases, 267 passed, 1 pre-existing skip.**
- New: 10 family-access cases over real HTTP. A test-only software authenticator produces genuinely signed responses, so the pinned library's real verification runs. Coverage is listed in FAMILY-ACCESS.md.
- Changed: three older migration fixtures now pin version 6, and the goal-project upgrade test starts from the schema before `project_kind`.

**Browser, `family-access.spec.mjs`: 4 cases.** Chromium's virtual authenticator, one per person, in independent contexts:
- an owner, an adult, a child and a separate family, the whole journey on desktop;
- session expiry and invitation link states;
- a real restart of the runner process;
- a 390 px phone fit.

Related suites rerun together with it: `family-journey`, `plan-check`, `goal-projects`, `channel3-merchant` (fake Channel3 transport) and `paypal-callbacks` (fake PayPal sandbox transport), on desktop and phone.
- Result: **59 passed, 11 deliberate viewport skips, 0 failed** (10.7 min).
- `family-access` was then rerun on the final code: 4 passed.
- `npm run check` passed.

Captures: `docs/screenshots/family-access-*.png` with [provenance](screenshots/family-access-sources.json). Images showing invitation links were deliberately not committed.

**Limits.**
- The virtual and software authenticators are not real phones, Touch ID, Face ID or security keys.
- Rate limits are in memory.
- The family runner uses simulated payments and the built-in planner. PayPal sandbox in family mode was not exercised; only the fake-transport regression ran.
- No public hosting, security certification or real family use is claimed. Rachel's playtests remain open.

## What the family builds: campsite, garden or schoolhouse — November 6, 2026

Claude branch `claude/goal-projects` (from `e7afafc`; not merged or activated). Plan → **Build** chooses what the goal builds in the west meadow; see [FAMILY-PROJECT.md](FAMILY-PROJECT.md#what-the-family-builds). The choice is saved only with the goal's normal save, stored in the additive `goals.project_kind` (migration 5, default `campsite`) and changes only the picture.

- **Unit: 258 cases, 257 passed, 1 pre-existing skip.** New: the three listed choices and nothing else (look-alikes, free text, objects); identical stage/threshold/detail arithmetic for every choice across three targets; the same site with per-place frame heights; an upgrade from a version-4 file on a temporary path (only the new column, set to `campsite`; a goal named "Garden shed fund" stays a campsite; the database refuses other values; reopening runs nothing twice); a kind-only change leaves figures, every plan including the accepted one, achievements, ledger, goal items and orders identical; an unsupported value beside valid new figures writes nothing; a confirmed market item saves the choice with its provenance and never derives it from the item; the Plan save over HTTP keeps the plan in use and survives a restart; a fake planner provider receives byte-identical input for all three choices. Three existing migration fixtures now also drop the new column when they model older schemas, and expect version 5.
- **Model (no WebGL): 2 cases, 4 passes (desktop and phone projects).** Every place builds every stage with finite geometry and its named parts (frame → rafters → glazed glasshouse; frame with the bell on its cradle → belfry with the bell hung); only the campsite has live parts, and rebuilding another place leaves none. Separately, the campsite model emits exactly the same parts and transforms as `origin/main` at all eight stage/detail combinations (scripted comparison, not committed).
- **Browser, new `goal-projects.spec.mjs`: 5 passes, 3 deliberate phone skips** (desktop 1440 px and emulated 390 px touch phone for the Plan case; three viewport-independent cases on desktop only). Choosing writes nothing and previews nothing; Make a plan sends the choice once with the unchanged figures; progress, achievements, contributions and the plan in use are unchanged; the choice survives reload; keyboard order and 44 px target; Visit lands on the garden's marker; a schoolhouse through 20/25/40/60/100 %, a refund and a larger goal; switching places at the same progress rebuilds only the project (travelers, tier, districts, bridges, court and view unchanged; no leftover campfire smoke; identical garden meshes after a round trip); night lights the school's windows and the glasshouse door with nothing moving under reduced motion; an untouched Build never reverts another member's newer choice; a tampered unlisted value is refused with the goal, plans and picture unchanged.
- **Related existing suites, rerun unchanged: 38 passed** (19 cases on desktop and phone): `family-project` (campsite stages, night, Visit campsite), `plan-check` and `channel3-merchant` (fake Channel3 transport). `npm run check`: the 47 copied files, the 90-colour palette, renderer wiring and syntax verified.

Captures and provenance: `docs/screenshots/goal-projects-*.png`, [goal-projects-sources.json](screenshots/goal-projects-sources.json). Isolated example servers only (3171 for review captures, 3111 for the browser suites), empty keys, temporary data; no provider, model, merchant or payment call, no 3010/3021 use, no recording. Not checked: physical phones, non-Chromium browsers, GPU rendering or performance, and real family use — Rachel's playtests remain open.

## Complete mountain slopes and wider terrain — November 6, 2026

The board adds another 32 world units on every side, from 292×196 to **356×260**, keeping its centre and the original property coordinates. Existing mountain footprints are broader and fully contained, so slopes descend before the board edge. All six river channels continue through the new row to the rim. Homes, nine district/bridge access rules, the PayPal sign and original renderer/palette retain their existing roles. [Reference lock and geography](MOUNTAIN-BORDER.md#extra-mountain-room--november-6).

The realm and terrain unit files passed, including complete mountain-foot containment, level edges, river outlets, dry existing plots, flat frontier clearings and unchanged routes/access. **Six distinct Chromium checks passed** across desktop (1440×1000) and emulated touch-phone (390×844): the new overview/rotation/home/night-rain case, locked exploration without writes, and the simulated Manor unlock retaining the village. The scenery case checks unchanged application state, no external requests, no writes/page errors and no horizontal overflow. The original 47-file/90-colour/renderer/syntax guard passed. No full suite, live provider, payment, paid AI or video was run. Initial unit expectations were updated from the previous board dimensions; the final unit run passed.

Ignored evidence: `test-results/mountain-room/{unit.log,browser.log,check.log}` and browser artifacts. Actual captures and the local activation result are recorded with the mountain follow-up; historical images remain intact.

## Treasury column review and amount sorting — November 6, 2026

Reviewing the current column configuration against AG Grid's column/state/type references exposed an Amount sort error: an uncredited $15 or $40 attempt displayed its actual amount but sorted as zero. The new browser case reproduced that error before correction. The column now uses a numeric value getter for the displayed amount; signed refunds, each row's counted status and canonical goal progress retain their existing values. [Capability inventory and remaining gaps](TREASURY.md#column-and-capability-review--november-6).

**Four focused Chromium cases passed:** the new sorting case and the existing stable-update case on desktop (1440×1000) and emulated touch phone (390×844). Isolated example fixtures include a $5 contribution and refund, pending $15, declined $40 and $60 reported starting progress. Both sort directions are correct, pending/declined receipts remain uncounted, progress remains $60/$300, and filtering/selection/sorting survive ordinary updates. Sorting and receipt selection make no writes or external requests and leave application state unchanged. The original 47-file/palette/renderer/syntax guard and diff check passed. The first harness attempt used an obsolete grid-container selector; it was corrected for the installed 36.3 DOM before reproducing the product bug.

Ignored evidence: `test-results/treasury-columns/{before.log,reproduced.log,after.log,check.log}` and their artifact directories. Existing screenshots and capture-source hashes predate this sorting-only follow-up and were not regenerated. No full suite, paid/provider call, payment, owner-data change, local Mac activation or recording was performed.

## Channel3 staff availability guidance — November 6, 2026

The existing Merchant source note now distinguishes a Channel3 catalog read from retailer stock verification. A failed CDN image falls back to the existing neutral thumbnail. [Staff guidance and scope](CHANNEL3-MERCHANT.md#staff-availability-guidance-applied--november-6).

**Six focused Chromium checks passed** across desktop and 390 px touch-phone: the existing search/draft/save journey, saved-item refresh/three alternatives/explicit confirmation, and a new deleted-product case at each size. The new case also checks the broken-image fallback. A catalog 404 closes the reserved retailer tab, removes the stale result, retains the query, never opens the old offer link, makes no automatic retry, and leaves all application state unchanged. Merchant captures below were refreshed from these actual fixture renders. No paid search, live catalog call, payment, owner data or full-suite rerun was involved.

## Sponsor freshness, live Treasury data and SDK contracts — November 6 UTC, 2026

`feature/sponsor-depth`, based on `e7afafc`, adds explicit saved-item refresh and cheaper alternatives to the existing Merchant; Studio 3.1 live transactions, original area artwork and a compact weekly comparison to Treasury; and six tests of the real PayPal SDK 2.5.0 transport contracts. The world, payment rules and approved 3021 evidence are preserved. [Merchant contract/source notes](CHANNEL3-MERCHANT.md#freshness-and-cheaper-alternatives--november-6) · [Treasury behavior](TREASURY.md#sponsor-depth-behavior-november-6) · [APIMatic method](APIMATIC-CODEX.md#actual-sdk-transport-contracts--november-6).

**49 distinct unit cases passed across focused runs:** Channel3 merchant (19), Treasury (4), actual SDK transport (6), existing SDK adapter (4), unknown-outcome recovery (7), avatar/migration (3), and stored receipt checks (6). The new coverage exercises product-detail locale/retailer/variant requests, changed price/stock/link, missing products, strict similar-item budget/stock/currency filters, forged or wrong-goal references, coalescing, timeout and unchanged financial rows. Concurrent lookups preserve each caller's own previous-price comparison. Weekly calculations separate accepted-plan dates from net contribution/refund events, with UTC boundaries, no-plan versus zero-due, negative net refunds and no starting-report or pending-payment credit. The SDK's actual auth/controllers/serialization run against fake axios transport; raw capture fields, request IDs, sandbox paths, timeout configuration, provider errors and no hidden retries are checked.

**34 distinct Chromium browser cases passed across focused desktop (1440×1000) and emulated touch-phone (390×844) runs:** seven Merchant, four Treasury and six Studio-framework scenarios, each at both sizes. This covers saved-item reload without a provider call; refresh and three alternatives without auto-saving; explicit Plan confirmation; a renewed retailer link with review required after offer changes; existing stale-goal/expired-draft/error paths; real Studio queries/live transactions and stable grid sorting, filtering, selection and instance; record links to the selected receipt; and scoped agent cleanup, failure/retry and fallback. A real built-in rules plan is accepted in the isolated fixture before its clock advances one week: **$30 planned / $15 simulated** renders correctly, with a single credit, reload and refund checks. A forced live-data transaction failure leaves the milestone and the next explicit steward request usable through the existing fallback, without an automatic paid request.

An initial record-link check found a receipt focus selector that omitted contribution rows; it was fixed and rechecked on both sizes. The software-renderer harness uses reduced motion. Other failed harness attempts were corrected for the final compact heading, the SDK's read-only export namespace, and dismissal of the ordinary earned deed before the next interaction. No unresolved failure remains in the targeted checks. The original 47-file/90-colour/renderer/syntax guard and final diff check passed; no full suite was repeated.

**Actual captures, copied unchanged:** [Merchant desktop](screenshots/sponsor-merchant-desktop.png), [Merchant phone](screenshots/sponsor-merchant-phone.png), [Treasury desktop](screenshots/sponsor-treasury-desktop.png), [Treasury phone](screenshots/sponsor-treasury-phone.png). [Source hashes and fixture provenance](screenshots/sponsor-depth-sources.json). Images show invented products and a simulated contribution, not the owner's payment. UI tests checked page errors and overflow; unlicensed Studio trial console notices are expected.

**Limits:** no live Channel3 detail/similar request, owner-key trial validation, new PayPal order/refund, paid model call, physical-phone test, video, deployment or submission. Historical November 5 search and in-app payment evidence are unchanged. Owner 3010/3021, their `.env` and records were not touched. Migration 5 adds item variant/condition provenance on temporary databases only; coordinate its numbering with the separate garden/schoolhouse and family-access branches before activation. See [release integration note](RELEASE-READINESS.md#sponsor-extension-awaiting-integration--november-6).

## Winner research and checkout readiness — November 6 PST, 2026

[Primary-source comparison and applied decisions](WINNER-RESEARCH.md) covers eight distinct winners across Dev Days 2025, the 2024 Portal PYUSD hackathon and the 2025 Google Cloud bounty. It distinguishes published product descriptions from independent evidence and current rules. The concrete change defers PayPal initialization until an adult chooses Contribute, provides an explicit pre-order load retry with a 20-second script deadline, and binds one active approval attempt to its original order/household scope. It also prevents late callbacks from canceling or enabling a later checkout. Server payment logic, SDK pins, saved checks and art are unchanged.

**Before:** three new desktop cases failed with actual hidden initialization, a permanently rejected loader and two fake orders for distinct-id rapid clicks. **After: 22 targeted browser passes** (eight new readiness/race scenarios plus three existing callback regressions, each desktop/390 px touch-phone), with inspected complete-app renders and unchanged application-table fingerprints for load/retry. The initial full-motion software-WebGL run had two scene-interaction timeouts; the final run uses the existing Plan tests' reduced-motion policy. Source guard verified all 47 copied art/runtime files, original 90-colour palette, renderer wiring and syntax; diff checks passed. No full suite was repeated.

Evidence: ignored `test-results/checkout-readiness-{before,after,final}.log` and `test-results/artifacts/checkout-readiness-world-*/*.png`. These are real browser/HTTP tests with scripted SDK/stateful fake PayPal, not real popup or new provider evidence. There was no actual sandbox order, refund, paid model/search call, recording or owner-data test. The historical approved $15 result is retained; this revised browser lifecycle has not been exercised against another real popup.

## PayPal Doctor checklist and callback recovery — November 6 PST, 2026

Codex applied PayPal's pinned upstream Doctor/best-practices checklist as a source-guided review, not a registered slash command or live probe. It reproduced late SDK cancel/error reporting that contradicted the canonical payment record. The cancel endpoint now reports completed/refunded/pending/unchanged status without changing rows or calling PayPal; the wrapper preserves that response and avoids unsupported “nothing charged/no progress” claims. The existing check row now follows the selected receipt's amount directly, with its timestamp and recovery action together. The local **Needs a check?** query was already present. [Method, exact source, findings and known webhook deployment warning](PAYPAL-DOCTOR-REVIEW.md).

**Before:** 10 new unit cases failed with two foreign-scope controls passing; three desktop wrapper/HTTP reproductions failed. The control's initial wrong expected error code was corrected to the existing `order_mismatch` before recording that baseline. **After: 47 focused unit passes, one existing intentional skip**, comprising the 12 new cases and existing payment suite; **six wrapper/HTTP desktop/390 px touch-phone passes**, plus **two existing Treasury status/local-query/recovery cases**. All provider traffic used stateful fakes and a scripted SDK loader; the wrapper cases do not establish real popup behavior. Actual Treasury renders were inspected at both sizes, with no page errors or overflow. The original 47-file/palette/renderer/syntax guard and final changed-source/diff checks passed; no full suite was repeated.

Ignored evidence: `test-results/paypal-doctor-review/{sources.json,cancel-before-corrected.log,callback-before.log,callback-before-artifacts/,payment-after.log,callback-after.log,callback-after-artifacts/,treasury.log,treasury-artifacts/,source-check.log}` and the current `test-results/treasury-status/{desktop,phone}-receipt-failed.png` captures. No real sandbox order/refund, runtime AI/search call, owner-data test, plugin/MCP installation, video, deployment or submission occurred. The APIMatic answer and skill-use map are prepared in source; the authenticated form remains unfilled.

**Mac activation:** source `439ead4` now runs on owner 3010 PID **59318** and the same preserved 3021 rehearsal PID **59330** after consistent backups. Application-table fingerprints, schema 4, core household state, `.env` bytes/mode/mtime and runtime modes match; ten served frontend files and backend source hashes match reviewed source. No order, provider call or recording occurred. Private report: `~/projects/our-house/test-results/paypal-doctor-activation-20261106T184514Z/report.json`. The subsequent activation-note change is documentation only.

## Steward capability note — November 6 PST, 2026

The existing note inside House steward now states that it reads records and cannot make payments, with PayPal/household scope kept accurate. The change is one copy line in `renderSteward`; no new notice, panel, tool or action. Four isolated Chromium inspections (desktop/390 px touch phone, with/without injected PayPal read tools) showed the correct note without page overflow, errors, external browser requests, writes, model/provider calls or application-table changes. Representative actual captures were inspected. The AI client and tools were inactive fakes; this checks copy/layout, not a new model refusal or live PayPal result. Changed-source syntax and diff checks passed; no suite was rerun for the copy edit. Ignored evidence: `test-results/steward-note/{review.log,review.json,desktop-*.png,phone-*.png}`. The existing receipt saved-status/timestamp/recovery behavior was confirmed in source; it was not rebuilt or backfilled. Recording remains paused.

## Family planning integration review — November 6 UTC, 2026

Reviewed Claude PR #9's server contract alongside Rachel PR #8's campsite, then connected both in the existing Plan journal. **Check schedule** tries a weekly amount/date without saving or invoking AI; **Try [date]** only fills the form. The accepted schedule stays marked **in use**. Changed facts prevent an old proposal being accepted/edited; a local refresh retains unsaved bill rows and trial fields. Market drafts clear old calculations immediately. Enter in a trial amount/date remains read-only; an explicit Make-plan action still saves deliberately. Refused schedule edits show one error. [Reference lock and independent review](FAMILY-PLAN-REVIEW.md) · [backend contract](PLANNING-REVISION.md).

**32 focused unit cases passed** (planning revisions, family-project rules, realm and avatar migration), plus four date-sensitive planning cases under `TZ=America/Los_Angeles`. The keyless planning example completed and proved every application table unchanged by rejected acceptance and read-only checks. The existing migration fixture was corrected to expect already-present schema 4; no schema or dependency was added.

**22 Plan UI cases passed** across focused desktop/390 px touch-phone Chromium runs: trial amounts/dates, explicit later-date choice, zero budget/52-week limit, stale acceptance/deed/focus recovery, cancellation and pending reads, unsaved bills, refreshing untouched saved settings while retaining chosen trials, keyboard Enter with a scripted model, market draft/discard, successful and failed refresh races, and one-message rejected edits. Two full Merchant → Plan → simulated contribution → world → Treasury/reload cases passed. Four campsite stage/visit cases passed across desktop/phone; the long desktop multi-reload scenario passed at 2.1 minutes after its total allowance was raised from 90 to 180 seconds, with individual assertions unchanged. Two isolated native-Three positional cases passed after reproducing and fixing smoke centred 4.05 units away from its fire. The independent Mac review additionally passed the existing normal-motion desktop campsite case once (44.2 seconds), with smoke/fire coordinate assertions unchanged. Actual Plan captures at both sizes were inspected. The original 47-file/90-colour/renderer/syntax guard and diff checks passed.

Claude's independent synthetic-data reviews reproduced three UI issues, a repeated error and an untouched-settings refresh bug before correction; the focused regressions above cover these and the smaller Enter-during-draft feedback issue. Adding that feedback exposed a stale message after discarding the draft; the failing desktop trace is retained and its affected case passed after clearing on both blocked-state transitions. Initial browser drivers also needed two expectation corrections: a collapsed date table still contains its hidden dates, and a newly earned Manor deed must be closed before checking returned focus. The source and traces/logs remain separated from the final passing runs. These are software-WebGL/emulated-browser, synthetic-record and fake-transport checks, not physical-device, human-playtest or new live-provider evidence. No full suite, paid AI/search, real/sandbox order, owner-data mutation or recording was used.

Ignored evidence: `test-results/family-plan-review/{combined-unit.log,calendar-review.log,backend-example.log,integration.log,campsite-final.log,model-smoke-before.log,final-journey.log,peer-fixes.log,refresh-error-final.log,saved-settings.log,draft-clear.log,source-check-release.log}` and their separately named artifact directories. Mac review: `~/projects/our-castle-plan-ui-review/test-results/codex-ui-review/report.md`. [Desktop](screenshots/family-plan-desktop.png), [phone](screenshots/family-plan-phone.png), [capture provenance/hashes](screenshots/family-plan-sources.json).

**Activated on the Mac:** normal merge `fd7e620` (PR #10, including PR #8's exact history) now runs on owner 3010 PID **54852** and preserved rehearsal 3021 PID **54865**. Consistent backups, all application-table fingerprints, core household-state hashes, original-checkout checks, `.env` bytes/mode/mtime and runtime modes passed before/after; schema remains 4. Nine served frontend files match reviewed source. Progress remains $60/$300 and $75/$300; no order, model/search/provider call or recording occurred. Private report: `~/projects/our-house/test-results/family-plan-activation-20261106T094932Z/report.json`. The subsequent activation-note update changes documentation only.

## Family campsite — November 5 PST / November 6 UTC, 2026

One small family project in the existing west meadow: survey stakes, construction site, furnished campsite and gathering place, with the 10/40/80 % estate milestones adding detail inside a stage. The stage is `projectStage(progressCents, targetCents)` in `src/core/family-project.js`, a pure reading of the server's progress and goal through the existing `tierForProgress`/`milestoneCents` rules; it follows current progress, so refunds and larger goals set it back. Geometry lives in `src/world/family-project.js` and joins the shared batches; only the campfire flame and smoke move, on the existing ambient clock. The board rebuilds only its own `project` group when the stage or crest changes. One tent marker focuses the site and the status line names the stage; **Journal → Plan** carries the stage on one line with a quiet **Visit campsite** link that closes the journal and lands on the marker, so a phone reaches it without hunting the overview. No district, reward, payment rule, panel, card, dependency or renderer change. [Reference lock](FAMILY-PROJECT.md). Current `main` (the merged Treasury saved-check work and Merchant draft recovery) was merged into the branch normally; the only conflicts were two import lines and two independent validation entries, both kept.

**Unit: 5 cases passed** in `test/unit/family-project.test.mjs` (a $0.50 sweep of a $300 goal against the server's tier and milestone arithmetic, the exact whole-cent boundaries, refund and larger-goal step-backs, invalid inputs, and the site being a flat, dry frontier meadow overlapping nothing), alongside the unchanged `realm` and `realm-terrain` suites (10 cases). **Browser: 6 cases passed** in `test/e2e/family-project.spec.mjs` on Chromium desktop 1440×1000 and 390 px touch phone: the four stages and the 40 % detail by simulated contributions with a reload between each, marker and status line, no Areas entry, a still fire under reduced motion, a refund stepping back while the castle stays a keepsake, a $1,000 goal reopening the survey, no page writes, errors or horizontal overflow; a normal-motion night case with glowing windows, a moving campfire on the ambient clock and unchanged household records; and the Plan link by touch (phone) and keyboard (desktop): the journal closes, the meadow is focused, keyboard focus lands on the marker, the status names the stage, the Plan line follows a contribution, and the page writes nothing. On the merged branch the `treasury-status`, `payment-recheck`, `confirmation-history`, `journey` and `woodland-legends` suites passed (**37 cases, 1 pre-existing skip**), and the `family-project`, `check-status`, `needs-check`, `receipt-checks` and `realm` unit suites passed (**29 cases**). The 47-file source/palette/renderer/syntax guard passed. Captures are in `docs/screenshots/family-project-*.png`, all from fresh example households. No full suite, provider call, real payment or video was run.

## Treasury PR #7 integration review — November 6 UTC, 2026

Merged current main into Rachel's branch, preserving Merchant draft recovery; the only conflict was two independent validation entries. Review reproduced an incorrect refund label: a saved refund ID could mark a pending or failed refund as completed, and a partial refund could look full. Status now uses the actual recorded refund state and distinguishes it from historical checks; unchecked refunded records retain their refund label. A failed saved check on an unpaid order also keeps the existing explicit recovery button available. No payment service, schema, SDK, dependency, reward or renderer changed.

The initial desktop/phone run reproduced a keyboard-focus race in the new **Open receipt** links: AG Grid's asynchronous selection notification rebuilt an already-selected receipt after focus moved there. Ignoring that redundant selection preserves focus without a timer, extra fetch or model call. Both unrelated failures reported by Rachel were also reproduced on unmodified current main: the history test moved its local-noon clock backward with a fixed UTC timestamp, and the journey test expected a retired celebration banner. Tests now advance the fixture's actual clock and verify the real Manor deed, its close/focus return, receipt, world progress and reload.

**Verification:** 51 distinct focused unit cases passed across the review runs; the six confirmation-history cases passed in UTC and America/Los_Angeles. **16 desktop/390 px touch-phone Chromium cases passed** across targeted runs: full family journey, keyless local history, refund recovery, failed-check history, unpaid-order recheck without capture, receipt-link focus and reload, and the existing Studio/grid/map flow. The initial two receipt-link focus failures and the failing refund regression are retained; the affected desktop/phone cases passed after the fix. Actual desktop/phone renders were inspected and refreshed below. The original 47-file/palette/renderer guard, final changed-file syntax and diff checks passed. No full suite, new real sandbox order, paid AI/search, owner-data change or recording was used.

Ignored review evidence: `test-results/pr7-review/{refund-before.log,refund-after.log,refunded-answer.log,unit.log,timezone-before.log,timezone-after.log,journey-before.log,browser.log,browser-artifacts/,focus.log,focus-artifacts/,source-check.log}`; browser captures in `test-results/treasury-status/` and the four `docs/screenshots/treasury-status-*.png` files. Baseline failures were run against unmodified main `9225d6e`; all providers in these checks are fake transports.

**Activated on the Mac:** merged source `3e7a37f` now runs on owner 3010 PID **46980** and the preserved 3021 rehearsal PID **46992**. Consistent backups preceded restart; every application-table fingerprint, schema 4, runtime mode and `.env` bytes/mode/mtime matched. Served frontend hashes and server-source hashes match the reviewed source; progress remains $60/$300 and $75/$300 respectively. No provider call, new order, paid AI/search or recording occurred. Private report: `~/projects/our-house/test-results/treasury-status-activation-20261106T071708Z/report.json`.

## Treasury saved-check status and "Needs a check?" — November 5 PST / November 6 UTC, 2026

Every PayPal record now carries one compact saved-check status (`src/core/check-status.js`), shown on the grid's source line and as a pill on the selected receipt with the check's time and the server's note. A pending match reads "still pending", never completed; a newer failed check outranks an older success; a captured payment with no separate check reads "No saved check". The existing **Check with PayPal** sits on the status line of a receipt that needs a check and runs only when pressed. The steward's second local question, **Needs a check?**, is answered from this household's active-goal records through the existing `/api/steward` request with no model or PayPal call, and offers "Open receipt" links that only select the record. No endpoint, dependency, money-moving path or renderer changed.

**Rachel’s initial checks (before integration review). Unit (fake sandbox, in-memory databases): 49 cases across check-status, needs-check, confirmation-history, steward, prompt-injection, server, treasury and receipt-checks; 48 pass in this Mac's PST session and 49 with `TZ=UTC`.** The one PST failure is the pre-existing `confirmation-history` case "newest-order selection…", which compares `created_at` values written with a UTC clock override against the fixture's local-noon clock; it is unrelated to this change and passes in UTC. New cases cover every status wording, the newer-failed-over-older-success rule, a match saved before a later refund, pending/failed/unchecked receipts named newest first, no provider call or write with or without an AI key, the simulated-only goal, and a second household's pending order being excluded.

**Browser (Chromium desktop 1440×1000 and 390 px touch phone, real app over the fake sandbox, no AI key): 8 cases passed** in `treasury-status`, `payment-recheck` and `confirmation-history`. The new case checks the four grid statuses, the failed/unchecked/pending receipts and their single check button, the local answer's wording and three receipt links, opening a receipt by link, reload persistence with zero PayPal order reads, and that only the button produces a `/refresh` write, after which the record reads as matched with the failure kept in its history; no horizontal overflow on either viewport. Captures: `docs/screenshots/treasury-status-{desktop,phone}-{needs-check,receipt-failed}.png`. The pre-existing `journey` "full journey" case fails identically on unmodified `main` on this machine (the celebration banner is suppressed while the deed card is open) and was not changed. The 47-file source/palette/renderer/syntax guard passed. No full suite, real payment, live AI or recording was run.

## Merchant draft recovery — November 5 PST / November 6 UTC, 2026

Reproduced two stale-draft failures: a same-ID goal edit and a changed starting-progress report were silently overwritten. A further browser regression reproduced an edit made in another tab before the product search began. Merchant saves now compare the version of the Plan fields actually shown. A conflict keeps the product and edited name/target, offers **Review latest goal**, reloads current starting/date/budget fields locally, and waits for another save click. Contributions alone do not invalidate a draft. An expired price keeps the draft and offers a prefilled **Search again** without an automatic provider retry. Search results retain their budget, and starting any replacement search clears the old selectable results and ignores earlier answers.

**30 focused unit cases and 14 desktop/390 px touch-phone Chromium cases passed.** These cover merchant/server behavior, the existing injected-product-title boundary, conflict recovery, expiry recovery, cancellation/focus, unchanged records on refusal, and the full Merchant → reviewed plan → simulated contribution → Treasury/reload journey. Desktop and phone renders were inspected. The original 47-file/palette/renderer/syntax guard and diff checks passed. The older migration fixture was corrected to expect the existing schema 4; no schema or dependency was added. Tests use isolated example data and fake provider transports, with no paid search, AI call, PayPal order or owner-data write. Rachel's Treasury status assignment remains separate.

Ignored evidence in `test-results/merchant-recovery/`: `before.log`, `stale-form-before.log`, `unit-final.log`, `injection.log`, `browser-final.log`, `journey.log`, `browser-artifacts/`, `journey-artifacts/`, and `source-check-final.log`. [Behavior and API boundary](CHANNEL3-MERCHANT.md), [existing interface references](INTERFACE-DIRECTION.md).

**Mac activation:** `7f87a35` is running on owner 3010 and the preserved 3021 rehearsal. Consistent backups preceded the restart; every existing application table has identical rows, schema remains 4, `.env` bytes/mode/mtime and modes match, and served frontend hashes match tested files. Owner $60/$300 and rehearsal $75/$300 are unchanged. Only local state/static reads were used. [Current runtime handoff](RELEASE-READINESS.md#current-mac-app).

## Local confirmation history — November 5 PST / November 6 UTC, 2026

The existing closed steward now offers **Last confirmation**, or accepts “When was our last contribution confirmed?” through the existing request. It reads this household/active goal's saved checks locally, including with no AI key. A completed stored match must bind to a credited capture with the same identity, amount and currency; pending matches never become completed confirmations. Refunds and a newer failed check remain explicit. Missing history produces no invented timestamp. The response is labelled **Saved confirmation**, has no fresh `verification` result, and makes no model/PayPal call or database write. General model questions and the explicit fresh `get_order` path retain their boundaries. No payment, webhook, toolkit allowlist, schema, dependency or visual renderer changed.

**22 focused unit cases and six desktop/390 px touch-phone Chromium cases passed.** New cases cover saved/absent/pending/refunded/failed history, current-order selection, foreign-order/member refusal, simulated records, no-key use, no provider calls and unchanged application rows. Browser coverage uses the real Studio harness, local answer/reload, keyless availability and the existing exact-order provider-proof path with fakes. The latter's stale forced-tool expectation was aligned with the already-documented supported `auto` setting. Actual desktop/phone captures were inspected; the source/47-file/palette/renderer guard and diff checks passed. These are isolated/fake-provider checks, not a repeated real payment or new live AI result. No full suite or recording was run.

Ignored evidence: `test-results/local-confirmation/{unit.log,browser.log,browser-artifacts/,source-check.log,functional.config.mjs}`. The earlier actual $15 order and check-history table are left as stored; this feature does not backfill a historical check or silently fetch one.

## Phone Journal accessible name — November 5 PST / November 6 UTC, 2026

Automated/semantic inspection reproduced the unnamed phone Journal toggle after its visible text was hidden by responsive CSS. An explicit **Journal** label fixes it without changing layout or behavior. The existing journal test now locates the control by accessible role/name: **two desktop/phone cases passed** for keyboard navigation, draft retention, focus return, preference/reload and skip-link access.

Ten fresh keyless Chromium scans with audit-only axe-core 4.14.0 reported zero configured violations after the fix, with unchanged full household state and no writes, external browser requests, page errors or overflow. Manual/incomplete axe items remain unverified; this does not establish actual screen-reader, physical-device or WCAG conformance. The 47-file/palette/renderer/syntax guard and diff checks passed. No new dependency, full unit/browser suite, provider/payment check or recording was needed. [Detailed method, rule scope, limitations and evidence](ACCESSIBILITY-DEVICE-REVIEW.md#current-follow-up-phone-journal-name--november-5-pst--november-6-utc-2026).

## Saved receipt checks — November 5 PST / November 6 UTC, 2026

[PR #5](https://github.com/alejandro-publius/our-castle/pull/5) saves up to ten explicit PayPal order checks through additive migration 4. One latest-result line remains on the selected receipt after reload; earlier results use the existing closed Payment details control. Reconciliation supplies the verdict, and stored fields exclude buyer details, full provider payloads and model prose. No check runs on render/reload, and historical checks are not backfilled.

Review reproduced a stale-result bug: after a failed lookup the database held `unavailable`, while the receipt still displayed its earlier successful check. The failing browser regression is preserved. The fix reads only local state after the provider error and keeps the original error visible; it never retries PayPal. History rows also received plain list styling instead of inheriting receipt-card borders/padding. [Interface lock](INTERFACE-DIRECTION.md).

**80 focused unit cases: 79 passed, one existing skip. Four desktop/390 px touch-phone Chromium cases passed** with reduced motion. Coverage includes history retention, scope/refusal before a provider read, persistence, mismatch/pending/refund/unavailable results, repeated checks without duplicate credit, schema-3 upgrade preserving every existing application row and the completed receipt, immediate failed-result display, closed history after reload and no second provider lookup. Actual desktop/phone captures were inspected with no overflow/page errors. The original 47-file/palette/renderer/syntax guard and diff checks passed; the steward/amount-source module remained byte-identical to the reviewed PR #4 source. This is fake-provider and browser-emulation evidence, not new live payment or physical-device proof.

Ignored evidence: `test-results/receipt-check-review/{before.log,before-browser-artifacts/,unit.log,browser.log,browser-artifacts/,source-check.log,functional.config.mjs}`. No full suite, payment, refund, paid AI/merchant call or video was run.

The reviewed source is active on the Mac at `610f1de`. Consistent backups of both saved databases were upgraded in separate copies first; every existing application-table signature matched. Active databases then upgraded schema 3 → 4 with only an empty `order_checks` table added. No historical checks were invented or backfilled. Existing records, environment bytes/mode/mtime, runtime modes and progress were preserved: owner 3010 PID **43459**, $60; verified rehearsal 3021 PID **43471**, $75/$300. Four tested module hashes and served HTML/CSS/main hashes matched. No actual provider lookup was run. Private evidence/backups: `~/projects/our-house/test-results/receipt-check-activation-20261106T045644Z/report.json`.

## Ready PRs: amount sources and entry story — November 5 PST / November 6 UTC, 2026

[PR #4](https://github.com/alejandro-publius/our-castle/pull/4) was reviewed against current main. Its new regression reproduced the old defect: a free-text PayPal note of `500.00` allowed an unsupported $500 claim. With the monetary-field rule, **all 16 focused steward/prompt-injection tests passed**; genuine payment/fee figures remain allowed, the four note/subject/custom/name figures are flagged, and same-order verification and the read-only ledger remain intact. The 47-file/palette/renderer/syntax guard and diff check passed. Evidence: ignored `test-results/rachel-ready-prs/{amount-before.log,amount-after.log,source-check.log}`. No full suite or live/paid provider test was repeated.

[PR #3](https://github.com/alejandro-publius/our-castle/pull/3) was reviewed and corrected before merge: the entry follows the current Plan merchant shortcut and confirmation flow, says up to three returned products, describes in-app checkout and same-order recovery precisely, and distinguishes fake-tested webhook handling from unverified live delivery. Broad claims about family habits and an implication of persisted check history were removed. This was a source/evidence and editorial review, not new user research or a test-suite run. Existing runtime proof, missing video insert and unsubmitted status remain explicit.

Both reviewed changes are active from `de11ccf` on the Mac. Consistent SQLite backups preceded restarts after zero-active-order checks: owner 3010 PID **43052**, rehearsal 3021 PID **43061**. Every application-table signature, environment bytes/mode/mtime, runtime mode and progress matched ($60 / $75); served frontend hashes matched and the steward module matched the tested SHA-256. Private evidence: `~/projects/our-house/test-results/ready-pr-activation-20261106T044622Z/report.json`. No new order, payment, refund, AI/merchant call or recording occurred. Rachel's separately assigned saved receipt history is not included in these merges.

## Product goals from Plan — November 5 PST / November 6 UTC, 2026

Fresh-session inspection found product search reachable only after focusing Market Town. Plan now has a quiet **Find an item** action beside Goal, using the same merchant, unsaved draft and explicit **Save as our goal** flow. The original map entry remains. [Reference/decision lock](INTERFACE-DIRECTION.md).

**Six focused desktop/390 px touch-phone Chromium cases passed** with reduced motion: the original map search/three-result/confirmation path, the full House → Plan merchant → confirmed goal → reviewed built-in plan → simulated contribution → world → Treasury → reload journey, and opening/cancelling from Plan while preserving unsaved fields, making no search/write and returning keyboard focus. The new action has a 44 px target; both layouts have no horizontal overflow. Tests use fake Channel3 and isolated example data, not live providers or human usability research. Command: `npx playwright test --config test-results/plan-merchant-entry/functional.config.mjs test/e2e/connected-journey.spec.mjs test/e2e/channel3-merchant.spec.mjs --grep 'fresh family|opening and dismissing|Market Town merchant: explicit'`.

Two additional fresh, keyless desktop/phone inspections passed: the Plan entry opens the honest disconnected state, Escape restores focus, full household state stays equal, and no write, external request, overflow or page error occurs. Actual Plan captures were inspected at both sizes. Ignored evidence and configuration: `test-results/plan-merchant-entry/`.

The original 47-file/palette/renderer/syntax guard and changed-file diff checks passed. No full suite, new payment, paid AI/merchant call or video was needed. The three-person [playtest](PLAYTEST.md) remains unrun.

## Rachel's PR review — November 5 PST / November 6 UTC, 2026

[PR #1](https://github.com/alejandro-publius/our-castle/pull/1) adds prompt/data separation and five scripted-model injection tests. Its checked changes merged into current main with the latest vines, lanterns and fairy retained. This tests the server's behavior when a model follows hostile text, not a live model's resistance; the existing free-text limitations remain documented in [PROMPT-INJECTION.md](PROMPT-INJECTION.md).

[PR #2](https://github.com/alejandro-publius/our-castle/pull/2) adds bounded REST waits, preserved webhook JSON, missed-refund reconciliation, a pending-refund guard and a typed Studio model/calculated progress field. Review reproduced and fixed three transport/request failures: timeout/reset while reading a response body escaped recovery, and trimming webhook JSON lost surrounding whitespace. Added regressions now preserve an uncertain capture or settle it from the same order once. A separate failing regression showed that refund totals were ignored by the steward; it now requests a receipt recheck until the full/partial refund matches. Completed/partially refunded receipts expose that explicit **Check with PayPal** action. Studio descriptions distinguish reported/simulated progress from provider confirmation and retained access after refunds.

Actual combined-source checks: **185 unit tests, 184 passed, one existing intentional skip; eight desktop/390 px touch-phone Chromium cases passed**. The real AG Studio engine supplies shares .8/.625/.5 and corresponding meter widths across contribution/refund/reload; fallback and keyboard access pass. Fake-sandbox receipt checks pick up a dashboard refund with no webhook or AI call, one reversal, no new capture and the earned Manor retained. The 47-file/palette/renderer/syntax guard and final changed-file syntax/diff checks pass. No full browser suite, actual provider test, new payment, paid AI/merchant call or video was run.

An initial default-motion Treasury screenshot timed out on software rendering after its functional assertions passed. That run was stopped (one following case interrupted); its log/traces are retained. The records/query suite now uses reduced motion and all eight relevant cases pass. Evidence: ignored `test-results/rachel-pr-review/{before-fix.log,payment-fix.log,refund-reconciliation-before.log,refund-reconciliation-after.log,unit.log,browser.log,browser-artifacts/}`. No product animation assertion was removed.

Both reviewed PRs were then activated locally at `2dc00e0` after consistent database backups and zero-active-order checks. Owner 3010 PID 41956 and preserved rehearsal 3021 PID 41966 retain identical application-table signatures, environment bytes/mode/mtime, runtime modes and progress ($60 / $75). Four served app/world source hashes match. No provider call was made. Private activation evidence: `~/projects/our-house/test-results/rachel-pr-activation-20261106T041716Z/report.json`.

## Flowering Rapunzel vines — November 5 PST / November 6 UTC, 2026

Two slender climbers with upward forks, small green leaves and nine pink/ivory blooms replace the old barely visible ivy. Most ivory stone remains exposed; windows, braid, crest, balcony and fairy stay readable. Static parts share existing geometry/material batches and add no controls, timers, rewards or provider actions. [Reference lock, actual renders and exact evidence](WOODLAND-LEGENDS.md#flowering-tower-vines--november-5-2026).

Final desktop/390 px touch-phone Chromium reviews passed: day, Night/Rain, zoom/rotation, original figures/court/bridges/access, unchanged full example household state, no overflow, page errors, writes or outside requests. The initial review-driver assumption about not-yet-rendered rain geometry is recorded with its failed capture; no product bug or passed full suite is claimed. Original 47-file/palette/renderer guard and final changed-source syntax/diff checks passed. This used fresh in-memory example data only; no new order, paid call or video.

## Villager candle lanterns — November 5 PST / November 6 UTC, 2026

Kit carries the village's candle lantern; Oswin adds a second at the Manor. Tiny night-only flames, two short-range shadowless lights and small warm ground pools follow their actual articulated hands. The existing ambient tick supplies restrained flicker; daylight/afternoon extinguish both, and reduced motion/modal pause freeze the effect. No extra guests, controls, reward gates, provider calls or dependencies.

Focused Chromium review used a fresh in-memory example with **$75 explicitly reported test progress**, not a PayPal payment. Actual desktop/390 px touch-phone renders were inspected. Day/night/afternoon switching, night refresh, reduced motion, six tier/crest rebuilds and twelve normal-motion samples passed. Rebuilds retained one carrier at the cottage, two at Manor/final tier, the original 2/6/20 guests, nine districts/bridges and a stable 21 geometries. Actual light positions followed the corresponding hand near each walker and paused under an occluding modal. The browser made no writes or outside requests, raised no page errors and left household/financial state unchanged. Three existing court unit cases and the 47-file/palette/renderer/syntax guard passed. Evidence: ignored `test-results/villager-lanterns/`; this is Chromium emulation, not a physical-device or performance claim. No payment, paid AI call or video was made.

## Fairy flight and Rachel handoff — November 5, 2026

The fairy now makes brief, bounded balcony loops with longer hovering pauses on the existing ambient clock. A fresh-example Chromium review sampled 44 normal-motion poses, verified multiple flight/rest positions, advancing rendered frames, modal pause and unchanged progress/contributions. A touch-phone reduced-motion review sampled five identical poses with ambient animation off. Neither produced a page error, write or outside request; the actual flight frame was inspected. Original 47-file art/palette/renderer/syntax guard passed. No new full suite, provider call, order or video was needed. Evidence: ignored `test-results/fairy-flight/`.

GitHub confirms `rachelselbrede` has write access. [START-HERE-RACHEL.md](../START-HERE-RACHEL.md) provides an isolated no-keys run, three bounded task options, a small Claude prompt and branch/PR workflow. The old visual/integration handoffs now point to the current expanded map and completed exact-order proof, avoiding a duplicate build or paid check. No message/invitation was sent and no access or visibility setting changed.

## Mountain border and PayPal hillside — November 5, 2026

The board expands from 228×132 to 292×196 around its unchanged interior. Twelve unbuilt meadows, faceted mountain ridges, river valleys and highland pines add depth without new districts, reward thresholds or financial actions. Six solid extruded letters use PayPal's official wordmark outline, with white faces and grounded rear supports. Font software is not bundled. [Source, reference lock, captures and exact checks](MOUNTAIN-BORDER.md).

10 realm/terrain unit cases and six existing desktop/phone exploration/unlock cases passed. Final desktop/phone visual review covered day, rotation, night/rain, old-property focus, no overflow/errors/outside requests/writes and unchanged example progress. Original art/renderer/palette/syntax guard passed. All activity used isolated example data; no provider call, new payment or video. Original high-sign/pale-rock trials remain preserved.

## Fairy and wizard staff — November 5, 2026

Rapunzel's balcony now has one hovering fairy with four pale wings, a rose/teal dress and small wand; the Observatory's existing wizard is more readable, with a crystal-tipped staff and two restrained sparks. Both use the existing ambient tick, pause behind modals and stay still under reduced motion. No UI, unlock threshold, financial record, provider call or dependency was added. [Reference lock, actual renders and precise checks](WOODLAND-LEGENDS.md#fairy-and-staff--november-5-reference-lock).

Two existing desktop/phone exploration checks passed. Three final one-off review contexts cover desktop/phone reduced-motion renders and normal-motion/occlusion at 1000×740. Initial full-size normal-motion screenshot timeout remains preserved; subsequent focused movement/occlusion verification passed. Actual day/night stills were inspected. Original-art/source guard and final changed-file syntax/diff checks passed. This is Chromium emulation, not a physical phone or performance claim; owner sandbox data and previous video remain separate.

## In-app sandbox and same-order steward — November 5 PST / November 6 UTC, 2026

The owner completed the approved single $15 USD contribution in the preserved 3021 rehearsal. The server has one completed order/capture and one contribution credit: $60 reported + $15 sandbox = $75/$300, with village and Manor open. A real scoped Agent Toolkit `get_order` and ledger read produced deterministic `match`, selected-order `verified` and no warnings. No second payment, refund, planner suite or merchant search was run. [Exact evidence and limits](IN-APP-SANDBOX-VERIFICATION.md).

The first focused steward call received a provider 400 because Opus 5.5 rejects forced tool choice. Fix `3f72609` uses strict automatic tools plus an explicit exact-order instruction; all 10 focused steward tests passed. One necessary runtime retry after a 3021-only restart succeeded. Owner 3010 records/listener were preserved; rehearsal financial rows match before/after. Continuous popup/bridge/steward UI recording remains unconfirmed; current review media is unchanged and not submitted. This newer result supersedes earlier zero-order/unverified runtime statuses below without changing their historical evidence.

## Gold fountain — November 5, 2026

Small ivory/gold courtyard fountains now accompany the existing Manor/Market/Keep/Citadel access rules. A 48-instance faceted coin spill replaces the old 28 separate spark meshes, and settled gold remains as an earned ornament. There is no new UI, API, dependency, payment action or reward threshold. Original palette/renderer/assets, all nine districts, existing water fountain, bridges, farm life and weather are preserved. [Design, actual render and exact evidence](GOLD-FOUNTAIN.md).

Four reduced-motion Chromium desktop/touch-phone cases passed. The new normal-motion trajectory and existing post-animation deed/focus/reload cases passed; one final normal-motion rerun after coin-face polish also passed. The source guard verified 47 protected art/runtime files, the 90-colour palette, original renderer and syntax. The initial normal-motion trajectory failure (no intermediate samples on slow rendering) remains preserved. A reward-only bounded progress step fixes the skipped effect without changing bridge/walk timing; reduced motion stays instant. No real PayPal or paid AI/Channel3 call was made. Existing media is unchanged and predates this addition.

## Public-clone judge rehearsal — November 5, 2026

An anonymous shallow clone of the public repository at `be73dfb674b444c1f8283aff50029b442d9d63c4` installed with `npm ci` and passed the source/art guard. The actual `npm run demo` launcher then ran on its own OS-assigned IPv4 localhost port, fresh in-memory state, no `.env`, keys or saved household. No installed-package or product-source change was needed.

The corrected current-build recording driver passed **10 checks**: example-only startup; house/crest; two chosen family avatars; reviewed and accepted rules plan; one simulated $15 credit to $75 and Manor with the village retained; Treasury source labels/next area/selected receipt; reload with no duplicate credit or deed; later simulated progression through the nine-area world; a 390×844 touch-phone journal with no horizontal overflow; and zero page errors/outside browser requests. This is isolated Chromium emulation and self-operated interaction, not a human usability study or live provider test.

The first recording attempt passed the main family/contribution/Treasury/reload path but its driver clicked **Close all** on a multi-deed queue and incorrectly waited for the next card. The corrected driver uses **Next**, selects the Los Angeles device time zone and checks journal visibility before opening it on the phone. The failed original/report remain ignored and are excluded from the current edit. No application bug was inferred from that recording error; no complete product suite or paid/provider test was repeated.

The continuous original is preserved at `test-results/judge-final-20261105T210813Z/capture-corrected/`; the public [recording report](demos/current-review/sources/public-demo-capture.json), [source manifest](demos/current-review/sources/manifest.json) and [editable kit](demos/current-review/README.md) identify the exact source and limits. This does **not** establish in-app PayPal approval or same-order real `get_order` reconciliation. Owner data, original environment and 3010/3021 processes were untouched by the cloud check.

The current review cut exported on the Mac: **162.000 seconds, 1920×1080 H.264/AAC, 25 fps, 4,050 video frames**. Offline Daniel narration fits every scene; 14 measured caption cues accompany it. Source/narration hashes, frame count, duration and full decode passed; one representative frame from each of the 14 scenes was inspected. The first audio preparation correctly refused a 0.537-second overrun in the APIMatic sentence; shortening that sentence resolved it. CSV/Markdown whitespace was normalized without changing the exported media. Exact output/hash is in [render-report.json](demos/current-review/render-report.json). The 28-second slate at 1:08 remains unfilmed; no final YouTube upload or Devpost submission is claimed.

A final passive Mac read still found 3010 in sandbox/live-AI/live-merchant configuration and the preserved 3021 rehearsal with **zero orders, one ledger entry and no plan**. These are configuration/local-state checks, not fresh provider authentication. The public source/media package adds no product-source or dependency change, creates no payment or provider call, and preserves the earlier original clips and household data.

## Mac activation and public source — November 5, 2026

The Mac reconnected. Its original checkout was clean `791e8ae`; the existing Claude session's latest implementation turn ended on November 5 at 12:51 a.m. PST, and no session was interrupted or replaced. Main app 3010 was sandbox/live AI/live merchant; the separate 3021 rehearsal remained sandbox/live AI with zero orders, one starting ledger entry and no plan.

To preserve that rehearsal's original source as well as its records, Codex added a **detached reviewed worktree** at `/Users/alexvintera/projects/our-castle-reviewed`, pinned to implementation `9d7a126`. Exact `npm ci`, the 47-file/palette/renderer/syntax guard and four focused demo/deed unit cases passed on the Mac's Node 26. This is native Node/backend evidence, not a native-browser or physical-phone pass. Its ignored `.env`/`data` links point to the original configuration and household; both links are explicitly ignored and both worktrees remain clean.

Consistent SQLite backups and private environment copies preceded activation. Only the old main listener (23747) was stopped; the reviewed main listener (32278) was started on **3010**. At verification, every row in all application tables of both databases matched its pre-activation signature; schema versions stayed owner 3 / rehearsal 1. The original environment's SHA-256, mode 0600 and modification time matched. The main HTML and three app/world modules matched reviewed files. Rehearsal PID **67124**, its database, and its HTML/main/world source hashes stayed unchanged. The original checkout remains `791e8ae`, deliberately serving 3021; the reviewed worktree is the active 3010 app. No owner goal, plan, member, payment or receipt was reset.

Private evidence: `~/projects/our-house/test-results/mac-activation-20261105T202636Z/{baseline.json,pre-activation.json,activation.json,install.log,source-check.log,focused-unit.log}`. Backups and the environment remain local in that ignored owner-only folder; none were uploaded. `test-results/CURRENT-APP.md` records the active checkout/restart path.

The owner's existing Mac `gh` CLI then completed the previously authorized source visibility change. GitHub returned `private: false`; separate anonymous repository-metadata and raw README requests returned HTTP 200. The earlier cloud integration's 403 remains a historical permission limit; no token was extracted or copied and no unrelated repository setting changed. Original art/licence notices remain intact. No site, final YouTube video or Devpost entry was published by this action.

All runtime-mode/source/state checks were passive local reads. No new PayPal order, capture, refund, Channel3 search or paid AI call was made. Historical live reports are unchanged. Browser-tool discovery still supplies no control of the owner's local browser; the approved popup → receipt/unlock → same-order `get_order` test remains outstanding, with its existing coordinator retaining ownership.

## Family deeds, quieter modal screens and a fresh demo command — November 5, 2026

Newly earned deeds now include the household's saved pixel characters beside the existing crest. The card remains **388×406**, with the same name/art/milestone/actions and no extra visible text. Reopened map deeds keep the earlier compact face. A new district uses its deed as the celebration, suppressing the parallel banner. [Reference lock, current capture and behavior](UNLOCK-CELEBRATION.md).

Normal-motion review exposed idle world redraws continuing behind open cards. An actual regression failed against that behavior; `isOccluded` now pauses only the ambient loop while a deed/merchant is open and excludes that interval from its visual clock. Closing resumes it. Essential bridge/traveler updates still run, including a newly earned area arriving while another card is open. No geometry, original pixel renderer/palette, access rule or payment server changed.

**30 focused browser passes across recorded runs:** 14 Chromium and 8 Linux WebKit reduced-motion cases cover chosen portraits, one celebration, post-animation opening, queueing, pending/refund/re-crossing, map reopens, focus return, reduced motion and 390/320 px phone layouts. Two phone-only layout variants are intentionally skipped in each desktop run. After the idle-loop fix, **6 normal-motion Chromium and 2 normal-motion WebKit cases passed** for the new card, an unlock replacing a still-open map card, and modal pause/resume with no writes. Reduced-motion results preceded the idle-loop-only follow-up; that loop is disabled in reduced motion. WebKit used the official Playwright `v1.64.1-noble` container. These are desktop/touch-phone emulations, not physical-device or macOS Safari evidence.

The original normal-motion attempts exceeded their 90/150-second budgets; the trace included a 79-second screenshot under software rendering. Those failed logs remain in `test-results/unlock-finish/{first-card.log,normal-verified.log}`. The new pause regression failed before the change (`modal-before.log`) and passes afterward (`modal-after.log`, `webkit-modal-after.log`). No failed result is relabelled as a pass. This is functional evidence, not a hardware speed benchmark. The broader functional logs are `chromium-functional.log` and `webkit-functional.log`.

**Four focused unit cases passed:** two existing deed contracts plus two new demo-launcher cases. `npm run demo` creates an in-memory household on an OS-assigned IPv4 localhost port. It never calls the environment-file loader or opens an on-disk household. A child-process check supplied invented provider keys, an explicit environment file, `HOST=0.0.0.0`, `PORT=3010` and a sentinel data folder: the app remained example payments/example planner/merchant off, licence absent, and the sentinel folder unchanged. The app and main module served successfully and SIGINT closed cleanly. Two simultaneous demos retained independent progress through refresh and closed independently. A separate manual `npm run demo` smoke returned the expected modes and its port was closed after Ctrl+C.

The source/original-47-file/palette/renderer guard and diff checks passed. No full provider or unrelated unit suite was repeated. A three-person [playtest sheet](PLAYTEST.md) is prepared; those human sessions are **not run**, and no feedback is fabricated.

Ignored evidence: `test-results/unlock-finish/`, including configurations, artifacts, `focused-unit.log`, `demo-unit-verified.log` and `final-source-check.log`. All payments here were isolated simulations. No new PayPal order, Channel3 credit, paid AI call, video, deployment or submission occurred. The Mac remained offline; its household, saved keys and separate approved 3021 rehearsal were not accessed or changed.

## AG Studio Agent Framework and release handoff — November 5, 2026

The existing closed House steward now runs through the installed **AG Studio 3.0.0 Agent Framework**: native `createAiHarness`, a custom server-backed runner, AG-UI events and one temporary thread per explicit question. All Anthropic/PayPal tools and deterministic reconciliation remain on the server. No new chat panel, model, credential or provider call on render was introduced. This uses a custom runner inside Studio's harness; it does not claim built-in-agent delegation or a replacement harness.

**28 focused browser cases passed across the recorded runs:**

- Chromium desktop and touch-phone: 18/18, comprising ten new framework cases, six existing Treasury cases and two complete fresh-family journeys.
- Linux WebKit desktop and touch-phone: 10/10 new framework cases, in the official Playwright `v1.64.1-noble` container.

The five new cases at each size/browser use the actual Studio bundle/harness with scripted fake Anthropic transport: one request and temporary-thread cleanup; a member change during a held request suppressing a late result; explicit retry after an HTTP failure without automatic retry; original fallback when Studio cannot load; and exact selected-order server proof using fake PayPal. Record changes also hide previous completed answers. Financial table signatures stay unchanged during steward asks. This is browser emulation, not a real-phone or macOS Safari pass, and fake provider proof does **not** close the actual in-app popup/same-order gap. Browser fetch cancellation does not assert upstream provider cancellation.

The 47-file original-art/palette/renderer/syntax guard passed. No world/CSS/markup/payment-server/credential/data file changed. Desktop/phone stills were inspected. Ignored evidence: `test-results/studio-agent/{chromium.log,webkit.log,source-check.log,desktop-existing-steward.png,phone-existing-steward.png}`; the separate configurations/artifact directories identify each run. No full unit/provider suite was repeated after the already-passing maintenance checks.

Judge/run instructions, entry copy, current 2:45 shot list, sponsor-use notes and the AG Studio commercial notice were updated. Historical verification reports and all recorded footage/captions remain unchanged. The README now leads with the game and a short local setup; detailed operational commands moved to RUNBOOK.md. [RELEASE-READINESS.md](RELEASE-READINESS.md) records the actual publication audit/status.

**Source release:** `331d864` was pushed normally to GitHub main. Its source archive clean-installed and started without credentials; app/runner/Studio/font returned HTTP 200 and the source guard passed. Remote text history (85 commits), the two new commits, current-source and sampled media OCR scans reported zero credential matches. GitHub's visibility update returned 403 `Resource not accessible by integration`; a fresh read confirmed the repository remains private. This is not a public release or Devpost submission. The final documentation-status update does not change the tested application code.

No real Channel3 credit, PayPal order/refund, paid AI call, household change or new video was made. The owner's Mac is still offline; the latest cloud build is not installed there. Existing 3010/3021 data, keys and servers were not accessed or changed. The rehearsal's **last inspected**, not freshly read, state remains zero orders, one reported starting entry and no plan. No supported authenticated browser control is available here.

## Sponsor/Toolkit maintenance — November 5, 2026

**40 focused sponsor/payment cases passed**, using fake transports and fresh example/in-memory states. Five new real-Toolkit/wrapper/compatibility cases cover actual OAuth/read request shapes with native network blocked, exact sandbox URLs, stalled/late reads, malformed output, and the scoped LangChain patch. An additional steward case verifies that a timed-out selected order stays unverified after late success/model claims and never changes ledger rows. Existing Merchant, Treasury, SDK and uncertain-capture contracts passed in the same focused run.

A clean install succeeded with the updated lockfile; five targeted Toolkit cases passed afterward. The original 47-file art/palette/renderer/syntax guard passed. Browser evidence from the prior review remains unchanged; no full browser/unit/provider suite was repeated. Details, version pins, the remaining 12-package audit result and ignored evidence paths: [TOOLKIT-MAINTENANCE.md](TOOLKIT-MAINTENANCE.md).

No live PayPal, Channel3 or paid AI call occurred; no account/credential, household data, visual component, video, deployment or submission was changed. The Mac remains unavailable, so this code was not installed in the running owner app or 3021 rehearsal.

## Family journey and browser follow-up — November 5, 2026

Runtime fixes at `397a8ba` keep castle navigation clear of the journal, prevent a WebKit name-blur redraw from losing a setup click, and prevent concurrent lazy loads from mounting multiple Treasury grids. Three stale assertions were corrected to the current amount, geography and selected-receipt interface. The new delayed-script regression produced three grids before the guard; the affected WebKit setup cases failed before the change and passed afterward.

**Actual focused results:** 24 distinct cases pass: six checks at both desktop (1440×1000) and touch-phone (390×844) sizes in Chromium and Linux WebKit. They cover pending/refund/re-crossing deeds, completed-goal keyboard navigation, route visibility at turn/zoom, canceled/declined receipts with a single credit, the complete fresh-family merchant/plan/contribution/receipt/reload flow, and delayed Treasury loading with one grid. Functional checks use reduced motion. WebKit ran in the official Playwright `v1.64.1-noble` container; these are emulations, not physical phones or macOS Safari.

The Chromium matrix initially had 11 passes and one isolated-server teardown timeout after the journey assertions had passed. Test-only cleanup at `bfa779b` now closes active connections before releasing the in-memory database; the affected desktop journey then passed independently. The full WebKit matrix passed 12/12. No already-passed full/unit/provider suites were repeated. The 47-file original-art/palette/renderer/syntax guard passed; desktop/phone merchant, plan and Treasury stills were inspected.

**Normal motion:** two additional Chromium cases passed at desktop/phone sizes with the actual full-route walk, queued deeds and keyboard castle visit. The initial software-rendered run exceeded the old 25-second settling/90-second case budgets. Test-only `6da7a96` keeps the animation/arrival assertions and gives this full-goal jump a bounded 60-second settling wait and 150-second case budget. The retry passed 2/2; no animation or renderer was shortened. This is functional evidence, not a hardware performance benchmark. Total: **26 passing focused checks** across the recorded runs.

Evidence/configurations in the cloud worktree: ignored `test-results/family-finish/{chromium-verified.log,fresh-family-cleanup-verified.log,webkit-verified.log,grid-race-before.log,webkit-setup-after.log,source-check.log}` and `test-results/connected/`. The earlier baseline/failing logs are retained rather than rewritten. See [FAMILY-FLOW-REVIEW.md](FAMILY-FLOW-REVIEW.md) for the exact scope, official sponsor checks and remaining browser/provider limits.

All financial activity here used fresh in-memory/example data, fake Channel3 and simulated contributions. No new real Channel3 credit, PayPal order, paid AI call, payment, refund, video, deployment or submission occurred. The approved 3021 rehearsal is untouched; its last read-only check showed zero orders, one starting ledger entry and no plan. The Mac's remote connection subsequently went offline, preventing local sync/native testing; its last inspected checkout was clean `791e8ae`. Supported control of the existing browser is also unavailable in this chat, so the in-app popup/same-order live verification remains outstanding. No keys or owner records were copied into the cloud checkout.

## APIMatic context for Codex — November 5, 2026

Eight SDK-specific skills and two references are installed verbatim from upstream `6aa057126f0d4709a42e15002aab832a94935d92`; each copied file matches the pinned source and its recorded SHA-256. Codex 0.163.0 app-server `skills/list` discovers all eight as enabled repository skills, with zero loading errors. No model thread was created. See APIMATIC-CODEX.md and `.agents/apimatic-paypal/discovery.json`.

Codex applied the entry point, client initialization, authentication and resilience context to the actual 2.5.0 SDK source and the current adapter. No additional runtime-code change was needed. This context-only change does not rerun or extend historical live PayPal/AI evidence. No new financial/provider test was made.


## Canonical app promotion — November 5, 2026, 08:38 UTC

Reviewed implementation `68e1c61` was fast-forwarded onto main. `npm ci --prefer-offline` succeeded; only the owner app on 3010 was restarted. The separate 3021 rehearsal stayed intact.

A consistent SQLite backup preceded schema 2 → 3. The new `goal_items` table is empty; every existing row in all ten application tables hashes identically before and after. SQLite's internal sequence high-water mark advanced during initialization and was preserved. Integrity: `ok`. `.env` content, permissions and modification time match.

Passive reads confirm configured sandbox payments, live AI, Channel3 and Studio licence, plus byte-identical HTML, three app modules and Studio bundle. No new provider call or financial/AI test occurred. Ignored evidence/private backups: `test-results/connected-promotion-20261105T083131Z/`.


## Connected journey (merchant → goal → contribution → world → Treasury) — November 5, 2026

At branch head a4ed597, 14 desktop and touch-phone browser cases passed. These were the connected journey plus the merchant and Treasury specs. The journey ran on one fresh in-memory example household:
- a fake Channel3 search, a draft with no write, and a confirmed save at the actual $189.50 price (Manor deed);
- an adult-approved simulated $20 contribution (Market Town deed);
- the Treasury's next area for the new goal ($80.00 of $113.70);
- distinct reported and simulated sources, filtering, a receipt leading to Market Town, and reload persistence.

No external requests, no writes beyond the three explicit actions, no horizontal overflow, and no PayPal, AI or live Channel3 call. This is not live payment evidence. Handoff: docs/CONNECTED-HANDOFF.md.

## APIMatic-informed PayPal review — November 5, 2026

The APIMatic PayPal Context Plugin's published skills (marketplace commit 7cbdf85) were applied to a contract review of the official `@paypal/paypal-server-sdk@2.5.0` adapter. Installing the plugin was blocked by automatic permission review and not retried.

Fix: a capture with no answer or a PayPal 5xx is now settled by re-reading the same order. It is left `pending` and recheckable, never `failed`. A webhook-settled order is never downgraded by a failed or stale read, and a lost refund reply has honest wording.

Seven fake-sandbox cases were added; each changed behaviour was checked against the earlier code or the reviewed defects. One existing payment case (a 500 on capture) now expects "unknown and pending". Unit suite: 161 cases, 160 passed, 1 existing skip. No PayPal call, order or refund. Details: docs/APIMATIC-USAGE.md.

## Treasury (AG Studio next-area widget) — November 5, 2026

Three unit cases and six desktop/touch-phone browser cases passed, using fresh in-memory example databases, simulated payments only, no licence and no provider credentials. They cover:
- the next area from real server states, through pending, canceled, replayed and refunded payments (the Manor stays open as a keepsake), bills, grouped milestones, completion and a changed goal;
- the AG Studio custom widget rendering it;
- filters and search never changing it;
- receipts on tap, "View on map" and "Visit" focus, and reload persistence;
- the plain fallback when Studio cannot load;
- keyboard access;
- no question, chat or model controls, and no writes or external requests on load, filter or select;
- the licence route exposing only that value.

The owner's AG Studio evaluation licence was validated in the installed SDK (`ag-studio@3.0.0`) in an isolated local run, with only that assignment loaded in memory: valid, `STUDIO-PRO-AI`, trial, expiring 19 December 2026, with no licence console messages.

I reran the existing Ledger-related specs (area-cards, earned-realm, family-journey, journey). Two changes came out of that:
- `journey.spec.mjs` now ignores only AG's unlicensed trial banner in its console-error check.
- A height-fitting loop that shifted the Ledger on phones was replaced by container-only sizing.

After both, full journey (journey :57) and bills/gifts (journey :190) passed on desktop and phone. The remaining failures are the four cases that also fail on unmodified main (area-cards :87 and :234, estate :67, journey :216), now seen on phone as well. The 47-file original-art guard passed. Details: docs/TREASURY.md.

## Market Town merchant (Channel3) — November 5, 2026

Eleven unit cases and six desktop/touch-phone browser cases passed. They use a fake Channel3 transport with the documented response shape and invented products, plus fresh in-memory example databases on separate ports. They cover:
- the exact request, with no household data sent;
- valid, missing-price, non-USD, malformed, error, timeout and unreachable answers;
- cache and burst limits;
- explicit search only, with stale answers dropped;
- the unsaved draft changes nothing; explicit confirmation saves provenance through ordinary goal-edit rules, without a new ledger entry or payment order;
- the confirmed save at the actual price, matching the ordinary goal edit (a later correction removed a merchant-only area floor);
- the below-price, stale-goal and expired-draft refusals;
- Escape/focus return and the not-connected state;
- the additive `goal_items` migration.

The avatar migration fixture now models version one without `goal_items` and expects schema version 3. The 47-file original-art/palette/renderer guard passed.

I also ran the existing specs that touch the board foot, deed button and Plan form (area-cards, journey, estate, game-shell, realm-focus): 50 passed, 3 were intentional skips and 4 cases failed. Each of the four also fails on unmodified main 877764e, so none comes from the merchant:
- area-cards :87, a threshold text expecting $240 where $225 is shown;
- area-cards :234, Citadel marker focus;
- estate :67, which expects the old 164-wide region;
- journey :216, a canceled-record receipt selection.

One owner-authorized live search ran on 2026-11-05 at 07:13 UTC: "camping tent", budget $250, a single provider call. It returned three real USD products with Channel3-CDN images, rendered in the actual desktop flow, and matched the documented schema. The live phone render and live draft/save were not exercised (the phone page load timed out, and no second credit was spent). Details: docs/CHANNEL3-MERCHANT.md. No PayPal, AI or checkout evidence is implied.

## Overlapping clouds — November 5, 2026

Two GPU regression cases passed on desktop and touch-phone projects. They execute the actual cloud-bank GLSL over three spatial sample windows and require cloud-body coverage above 99.75%, preventing a return to broad backdrop gaps. A separate 384×384 diagnostic measured 18.51% covered samples before this change and 99.987% afterward (coverage threshold 240/255); this is a finite shader-mask sample, not a guarantee for every possible camera coordinate.

Actual Day/Afternoon/Night/Night+Rain desktop views and a phone Day view were reviewed. All nine districts/bridges, ten farm animals, three tavern figures and family avatars remained; there were no page errors, external calls, writes or horizontal overflow, and the example server state was unchanged. The 47-file original-art/palette/renderer and JavaScript guard passed. The original terrain mask and cloud clock were not changed. Source/stills: docs/DEFINED-CLOUDS.md; ignored evidence: test-results/overlapping-clouds/ under the owner's checkout. No new paid/provider calls or video work.


## Market Town tavern — November 5, 2026

Four focused browser cases passed across desktop and touch phone. They check three animated background townsfolk, unchanged family/farms/access and financial state, still reduced-motion poses, hidden-tab pause, bounded resumption, and four tier/crest render rebuilds without accumulated people or geometry. Requests were limited to same-origin GET: no household writes or provider calls.

The original-cottage/tavern detail, actual Day Market Town, and actual Night/Rain views were reviewed on isolated example data, with no page errors/external calls and unchanged server state. The source/47-file original-art/palette/renderer guard passed. Evidence is in docs/TAVERN.md and ignored test-results/tavern/ under the owner's checkout. No new live integration evidence is implied.


## Stables and farm life — November 5, 2026

Six focused browser cases passed across desktop and touch phone: scenery counts, unchanged financial state/family/access, eight visual realm rebuilds without accumulating animals or geometry, retained twenty-person court, reduced motion, hidden-tab pause and bounded clock resumption. All browser requests were restricted to same-origin GET; no provider/AI/payment calls or household writes.

Four detail renders and three actual Day realm views were reviewed after roof/ramp refinement. The actual app also rendered manual Night/Rain. Reviews recorded no page errors/external requests and unchanged example server state. A placement audit sampled existing guest lanes, all family route segments and 3,005 river-bank points against conservative building/fence envelopes: nearest guest clearance 1.22 units; family route clearance 2.93 units. This is a scenery placement check, not general collision physics. The 47-file original-art/palette/renderer and JavaScript guard passed.

Evidence: docs/FARM-LIFE.md and its stills; ignored test-results/farm-life/ under the owner's checkout. No new live integration evidence is claimed.


## Family avatars — November 5, 2026

New checks use synthetic temporary/example data only. Three avatar domain/migration cases and nine HTTP cases (12 total, including existing fake-provider protections) passed. Eight targeted browser cases passed across 1440px desktop and 390px touch: independent saves/reload, matching party identities, keyboard/Escape/Cancel without writes, failed-save retry, all eight portrait loads, target sizes and retained child-payment restrictions. A separate read-only review checked 1440/390/320px, all nine districts, no overflow, no page errors/external calls/writes and unchanged example state. Browsing uses no provider calls. The 47-file original-art/palette/renderer guard passed.

The portraits are original renders from the same member model as the world; assets/member-avatars/provenance.json contains matching source/image hashes. The schema change only adds nullable members.avatar_id. A version-one synthetic database migration and restart preserved existing members and every financial table. Keyboard/tile hit targets and stable accessible radio names were corrected during this pass. No checkout/AI evidence is added by these tests.

Local review evidence: test-results/family-avatars/ under the owner's checkout (ignored). See docs/FAMILY-AVATARS.md for scope; this is appearance selection for the existing members, not new invitations or authentication.


## November 5, 2026 UTC: private main sync and split handoff

The owner authorized moving the full working game to private GitHub main, with Claude responsible for visuals and Astra for sponsor/integration engineering. CLAUDE-START.md and the launcher text now point to the visual handoff; active README/judge instructions now support an authenticated clone rather than describing main as the starter. Existing financial code, visuals, assets, reference notices and historical videos are unchanged by this handoff.

Actual clean-checkout checks: npm ci installed the locked dependencies; the original 47-file/palette/renderer/syntax guard passed; eight server cases passed with fake/in-memory transports; shell syntax and diff whitespace checks passed. An isolated no-credentials server from that clean main checkout served nine districts on desktop and a 390 px touch context, reached the last Areas item, supported keyboard/touch sword discovery, loaded the three newest portrait assets and produced no page errors, external requests, writes or state change.

npm audit reports twelve advisory entries (eleven high, one moderate) in the toolkit dependency graph. These remain open for compatibility/reachability triage in ASTRA-INTEGRATION-HANDOFF.md; the suggested toolkit replacement is not silently applied. No paid payment/AI/provider suite was rerun, no real financial action occurred, and no site was deployed. The owner's .env/household data and the 3021 rehearsal are not part of Git.

Ignored evidence on the owner's Mac: test-results/main-sync/{npm-ci.log,npm-audit.json,source-check.log,server-tests.log,fresh-smoke.json}. Final publication/secret-scan evidence is recorded alongside those files.

## November 4, 2026: connected folklore clearings and sword discovery

Added two original tower districts tied to existing home milestones: Starfall Observatory at 60%, Rapunzel's Tower at 100%. They have their own short deeds and river crossings. The hidden sword is camera-only scenery: no payment, reward entry, household write, new tier or change to tracked progress. All earlier locations, financial route, court capacity and cloud shader remain.

Actual checks: 21 unique focused realm/deed/reward/court unit cases passed; the seven geography cases were rechecked after relocating the grove further into the forest. They cover dry clearings, water under all nine bridge centres, existing milestone boundaries, final simultaneous awards, replay, refund keepsakes, bill separation, continuous route and no secret reward gate. Fourteen desktop/390 px phone Chromium cases passed for final/queued deeds, direct district visits, existing Manor animation, time/rain persistence, all nine destinations, non-overlapping plaques, genuine touch/keyboard sword discovery and zero writes during exploration. A focused check of the existing game shell and bridge/walk/deed choreography is recorded separately.

The original 47-file/palette/renderer/syntax guard passed. Read-only still review covered both towers in Day and Night/Rain, the overview, the sword grove and phone views, with nine warm door lights at night and zero page errors, external requests, writes or financial state changes. Phone review exposed the longer menu clipping against the world boundary; both desktop and phone menu height rules now cap against the actual map. Review also strengthened hair/roof appliques for readable pixel interiors.

Evidence: ignored test-results/woodland-legends/{unit.log,realm-final.log,e2e.log,e2e-affected.log,check-final.log,review.json}; tracked assets/area-cards/legends-provenance.json records exact source/image hashes. New portrait generation uses its own empty example database, no credentials, no server writes and no payment/AI calls. Existing live PayPal/AI evidence and unresolved in-app same-order verification remain unchanged. No video work or paid/provider tests were run. Physical phones, Safari/Firefox and assistive technology were not checked in this pass.

## November 4, 2026: brighter clouds with recognizable contours

Changed only the original cloud-surround helper's shape/colour logic: explicit softly joined lobes replace the noise wash, with irregularly spaced banks, white crowns, light underside shading and thin translucent tails. The first rounded version looked repetitive on a phone, so crown geometry, scale, mirroring and placement were varied before the final review.

Actual checks: the original 47-file/palette/renderer/syntax guard passed. Read-only Chromium still review covered Day, Afternoon, Night/Rain, Raw 3D, phone width 390, camera turn/zoom, reduced-motion stillness and hidden-tab pause/resume. No page/shader errors, external requests, writes or financial state changes. An independent before/after render comparison found the 32x32 interior traveler crop identical, all seven districts' access/paint and every bridge unchanged, and geometry count 13 to 13. Sky pixels changed as intended.

All 21 protected file signatures (owner settings/data, rehearsal data, renderer/palette and historical MP4s) remained identical. No server restart, payment, paid AI/provider call or video work. Evidence: ignored test-results/defined-clouds/review.json, comparison.json, source-check.log and protected-before/after.json. These are focused Chromium checks, not physical phone, Safari/Firefox or assistive-technology validation.

## November 4, 2026: Rosewind Palace and a larger connected board

Seven woodland clearings on 228x132 ground; old district coordinates, buildings, twenty financial steps, home thresholds and total court capacity are preserved. The palace and crossing open with the existing completed-goal achievement. Its separate deed survives refunds as a keepsake.

**Actual checks:** 20 focused realm/deed/court/reward unit cases passed with in-memory example states/fake transports. Thirteen applicable desktop/390 px Chromium browser cases passed; one existing phone choreography test is intentionally skipped. Coverage: dry clearings, river below every bridge, old coordinates/continuous route, final simultaneous unlock, replay/refund, no bill shortcut, final example-payment/card queue, Visit focus, Manor bridge/walk/deed order, Day/Night/Rain and refresh, uncluttered phone overview, four journal actions and one general notice.

Initial geography checks found a river bend too near the palace meadow; the bend and downstream main river were moved into the forest corridor before the checks passed. An existing pixel-colour test counted the new clouds as world paint; it now classifies actual fixed-palette surface pixels, keeping its original green/water thresholds. Still review found phone plaque overlap and trees over planted beds; both were corrected.

The original 47 copied art/runtime files, palette, renderer wiring and syntax check passed. Independent read-only Day, Night/Rain, overview and phone still review found no page errors, external requests, writes or financial state change. Forest geometry remains instanced (960 trees in 21 forest batches); this is not a hardware performance claim. The new portrait generator completed in its own no-credentials example context with zero payment/AI calls or server writes.

Evidence on the owner's Mac: `test-results/palace-expansion/` (focused logs, review.json, protected-file checks and local handoff) and tracked `assets/area-cards/palace-provenance.json` (exact source/image hashes). Physical phones, Safari/Firefox and assistive technology were not tested in this pass. No paid AI/PayPal/provider checks or video work occurred. The existing in-app/same-order live integration gap remains.

## November 4, 2026: soft clouds in place of the navy surround

Empty space around the woodland now contains broad pale cloud banks, thinner haze and light drift. Wisps touch only a few units of the outer forest. Day, Afternoon, Night and Rain tint the same shapes; the world interior, rivers, architecture and controls remain clear. The clouds use smooth alpha after the original world palette pass to avoid night-time colour banding. No image downloads, new notices or controls were added.

The original copied PixelRenderer and palette are byte-for-byte preserved. The initial direct renderer edit was caught by the source-integrity guard; the final solution decorates an actual original renderer instance in a separate cloud compositor. Initial patterned and banded cloud versions were rejected during visual review and retained in ignored test-results/cloud-surround/.

**Checks:** original 47-file/palette/renderer/syntax check passed. Read-only Chromium still-image review covered Day, Afternoon, Night/Rain, Raw 3D, camera turn/zoom, 390 px fit, static reduced motion and hidden-tab pause/resume without a large drift jump. There were no page/shader errors, writes, external requests or financial state changes. A 32×32 interior traveler crop matched the earlier renderer exactly; the sampled sky corner contained no old navy pixels, and all six district access/paint states matched. Resource counts and the same-context comparison are recorded with the review, not used as a hardware performance benchmark.

All seven protected owner/rehearsal files retained their hashes, modes and timestamps. No server restart, new payment, paid AI/provider check or video recording/export occurred during this cloud pass. Physical phones, Safari/Firefox and a screen reader were not checked. [Current woodland](screenshots/cloud-woodland.png) · [Night and rain](screenshots/cloud-night-rain.png).

## November 4, 2026: record-to-realm integration and exact-order verification

The existing Community grid now supports source/order/capture search, keyboard/single-row selection, one selected receipt and a link from a calculated milestone to the already-earned district. Pending/failed attempts are visible with zero credited impact. Refunds retain their own amount and reference. The pinned total remains current server progress, independent of search/filtering. Plain-table selection/search remains if AG Grid cannot load.

New-area choreography temporarily frames both banks, lowers the bridge, follows the family, then focuses the destination for the original fanfare and compact deed. Manual camera input takes priority. No access rule, payment credit or utility-provider claim changed.

Focused AI verification now requests get_order first for the selected household/goal order. Order, contribution reference and credited capture identity must match before reconciliation succeeds. A fluent model answer without that exact tool proof remains unverified, and changing the selected payment clears a stale answer. Tool/model details are collapsed. The AI still cannot create, capture or refund.

**Checks:** 12 unit cases passed with fake AI/PayPal transports; a focused guard follow-up verifies that missing PayPal tools reject before an AI call. Fifteen applicable desktop/phone Chromium browser cases passed, with one intentional phone animation skip. These cover the new grid/trail, pending/completion/refund, fallback, the actual bridge/walk/fanfare/deed order, queued cards, saved-record navigation and a mocked AI proof presenter. The initial grid tests used pre-v36 container selectors; the installed 36.2 DOM was inspected and the selectors corrected. A real initial-selection issue was fixed so a newly returned pending payment selects its own record. Initial failures and traces remain in ignored test-results/award-finish/.

This is not a full suite or live-provider retest. No new PayPal order, paid AI call, external bill verification or public deployment was made by these checks. Current product-doc reads, actual integration and prize-rule uncertainty are separated in [AWARD-STRATEGY.md](AWARD-STRATEGY.md). Render's example Blueprint is prepared, not deployed. The approved sandbox checkout/same-order recording remains with the existing browser operator.

## November 4, 2026: one carved stag for the Citadel lawn

Added one static ivory stag on a stepped, carved plinth, with branching gilt antlers, facial cuts, cloven hooves and a household-color crest plaque. It uses the original geometry/material batching. No other district, building, interface or progression rule changed. [Estate view](screenshots/citadel-statue.png) · [detail](screenshots/citadel-stag-detail.png).

**Checks:** the source/asset/palette/renderer check passed. A focused read-only Chromium review of isolated example data confirmed all six districts and the still-locked Citadel, reviewed Day and Night, and found no 390 px overflow, page errors, writes or external requests. Household state was identical before/after. The first placement intersected the final journey approach; the statue was moved to the opposite front lawn. The final base clears all sampled guest routes by at least 0.755 world units and the journey route by 6.8 units. The antler widths were refined after viewing the actual pixel render. The original failed review is retained in ignored test-results/citadel-statue/.

The closest detail capture uses only the normal camera zoom and pan controls. Physical phones, Safari/Firefox and hardware performance were not checked. No full suite, payment order, paid AI or provider call was run. Earlier videos and the approved sandbox-insert gap are unchanged. All seven protected owner/rehearsal files retained their hashes, permissions and timestamps.

**Minor sculpture follow-up:** the stag turns slightly toward the normal view, its antlers spread more clearly and retain broader gold cores through the outlines, and the brow/hoof cuts are sharper. A shallow carved laurel now frames the existing crest. No object was added to the lawn, and the pedestal location/base is unchanged. Syntax and diff checks passed. A new focused desktop Chromium capture reviewed estate/detail Day and detail Night from isolated example data, with six districts, the Citadel still locked, no page errors, writes or external requests, and unchanged household state. The seven protected files also retained their hashes, modes and timestamps. No full suite, phone retest, paid call or payment order was run. Before/after captures and source hashes are in ignored test-results/citadel-statue-polish/.

## November 4, 2026: a compact game frame and one general notice

The owner rejected the surrounding website chrome and repeated explanations. The realm now sits beside one collapsible household journal, with the four existing actions. Goal and progress appear once in the header. Areas, camera controls and World settings open on request. Model IDs and integration details moved out of the main header; duplicate slogans, summaries and general financial/persona paragraphs were removed. One footer notice states the active payment mode and the limits of profiles/reported progress. Exact-amount approval, error states and source/status labels on actual receipts and records remain.

Research and the reference lock: [INTERFACE-DIRECTION.md](INTERFACE-DIRECTION.md). Live Refero research covered Wayfinder, MekaVerse and Haley Park styles plus PamPam/OneSoil map-menu screens. The existing world, fonts, palette and artwork remain primary. No generated or third-party artwork was added.

**Checks:** the original 47-file asset/palette/renderer/syntax check and final syntax/diff checks passed. **61 applicable targeted browser cases passed, with 5 intentional project skips**, across the family journey, payment/receipt states, new journal/menu behavior, keyboard focus, realm framing, cards, night/rain and mocked local weather. This was not a full unit or browser-suite run. Two additional follow-up executions confirmed that closing the wider Ledger journal returns its space to the realm.

Initial failures were kept and resolved: phone focus at a fractional viewport edge needed a 16 px scroll margin; the goal amount was raised to 24 px; changed source/profile labels needed matching test expectations. A two-tab workflow timed out under simultaneous software-WebGL animation, so that navigation test now uses reduced motion and the current profile label. Weather-result clicks replace their own DOM nodes; the outside-click handler now checks the original event path, preserving the open menu and focus. Only failed cases or newly changed behavior were rerun.

Final visual review captured desktop, 390 px and 320 px views from isolated example data. There was one general notice, no horizontal overflow, no page errors and no external requests. The setup capture used only house setup and a built-in plan; the final refresh was read-only. No contribution, PayPal order, paid AI call, utility-provider verification or live-weather request was made by the visual review. Browser-flow tests used isolated example payments and mocked weather.

Protected owner/rehearsal file hashes, modes and timestamps were identical before and after this work. Their servers, data and keys were not replaced or restarted. The approved in-app sandbox recording/steward gap and all source-pinned older videos remain unchanged. Logs, earlier failures/traces, source hashes and capture reports are in ignored `test-results/game-shell/`.

Limits: Chromium desktop and phone emulation; physical phones, Safari/Firefox and a real screen reader were not checked. No production authentication, bill-provider integration or enterprise-readiness claim follows from this visual pass.

## November 4, 2026: subtle river flow

Static surface marks were replaced by 59 sparse moving glints along the three existing narrow channels. This is cosmetic: no geography, bridge access, progression or financial behavior changed. Night/rain lower the highlights' contrast, and the existing ambient clock drives the effect.

**Checks:** original asset/palette/renderer/syntax check passed. A focused isolated Chromium review confirmed motion on all three rivers, channel confinement over 100 seconds, hidden-tab pause/resume, static reduced motion, Night/Rain compatibility and stable geometry after initial uploads. It recorded no writes, external requests, page errors or financial state changes. The first geometry assertion compared the pre-rain count (12) with the first upload of existing rain meshes (15); the focused continuation warmed those meshes before comparing. No application fix or unrelated suite repeat was needed. Logs and original recording are in ignored `test-results/river-flow/`.

[Actual river-motion clip](demos/river-flow/our-castle-river-flow.mp4): 7.20 seconds, silent, from isolated example data. [Provenance](demos/river-flow/README.md). Desktop Chromium only; no new physical-device, Safari, Firefox, paid AI or PayPal check. Existing videos and the sandbox insert gap are unchanged.

## November 4, 2026: closer world, parchment property names and a quiet contribution step

The owner asked for larger visible architectural detail, less information in the contribution screenshot, and ivory/parchment property labels with better fonts. The camera now starts on the current earned home. Whole realm still restores the full six-district map. Property plaques use the original ivory/ink palette, bundled Uncial at 19 px (16 px on narrow screens), a small lock and clamped positioning to stay inside the map. World geometry, land, buildings, bridges, access, cards and light/weather are unchanged.

The contribution step is a centred, bounded form with a larger amount field, one explicit approval and the payment action. Plan recap, amount-suggestion cards, projection essay, repeated next-step heading/reasons, bank-balance paragraph and server-plumbing note were removed. Validation errors appear when relevant. Financial modes remain clearly labelled in badges, the compact checkout note and receipts. A single next-action button disappears when already at that step; the saved-record link remains on House/Plan, and full records remain in the Ledger. Editing the amount now clears approval so a prior check cannot authorize a changed amount.

**Checks:** original assets/palette/renderer/syntax check passed. The initial syntax check caught an extra closing parenthesis in the new renderer; it was corrected before browser checks. **31 targeted browser cases passed, 5 intentional project skips**: 27 from the family journey, selected end-to-end money flows, responsive layout and realm focus; 4 explicit overview/route cases followed because line filters in the first command did not select those cases. No already-passed suite was repeated.

Evidence includes: the close view draws the home at over twice the overview scale; all six districts persist; parchment text/background/font and marker bounds; keyboard navigation and 320 px fit; untouched progress when navigating; House/Plan/contribution/receipt and saved-record recovery after AG Grid loads; invalid/child/pending/canceled/declined handling; exact-amount reapproval; full-map framing, colour and locked gates. Actual contribution screenshots were captured from the isolated example-mode fixture. No PayPal order or paid AI call was made. Protected owner/rehearsal files, permissions and timestamps are unchanged; no existing server restart was needed.

**Visual review:** the actual read-only example fixture at source `ab2aac5` shows the starting home at **3.24× the overview scale**. Root viewed the [closer home](screenshots/home-close-detail.png), [parchment overview](screenshots/realm-parchment.png), [citadel detail](screenshots/citadel-parchment-detail.png), and the compact contribution screenshots on desktop and phone. The scene review logged no writes, external requests or page errors, and its financial state was unchanged. New plaque text is the name only with a small lock; no descriptive paragraphs were added. Its source hashes match the committed files.

Limits: Chromium desktop/phone emulation, not Safari/Firefox, physical phones or a real screen-reader pass. No hardware performance claim. The broader approved sandbox popup/same-order steward recording gap remains unchanged. Original art and source-pinned older videos are preserved. Logs and preservation evidence: ignored `test-results/quiet-realm/`.

## November 4, 2026: compact collectible unlock cards

The owner asked for Monopoly-like brevity. The face now has only its area name, original pixel artwork, household crest and a short status/milestone line, such as **Unlocked · 25% milestone**. A small count appears only when several cards queue. Visit, Next and Close share one row; their accessible labels still name the destination or next card. Architecture descriptions, guest lists, evidence/stamp paragraphs and expandable details are deleted. Financial facts remain in receipts and the Ledger. No reward rule, access, core deed data, payment code, timing or stored record changed.

**Checks:** original-asset/palette/renderer/syntax checks passed. All 8 applicable focused desktop/phone browser cases passed, with 2 intentional device-project skips: the short face/pixel image/crest, automatic arrival after the board animation, Escape focus and reload, multiple-card queue/Visit, a new area arriving during an open map deed, and 390/320 px sizing and reachable 44 px actions. The initial queue checks found a remaining reference to the deleted details element in the Next handler. It was removed; only the two failing queue cases were rerun, and both passed. Logs and initial contexts remain in ignored `test-results/short-deeds/`. The full suite and paid/provider checks were not run.

[Current Manor card](screenshots/deed-manor-simple.png), captured from the isolated example-mode $15 unlock in the browser test. Its 388×406 face was visually reviewed; the original pixel artwork is unchanged. Saved owner/rehearsal files, permissions and timestamps match the protected snapshot. No existing server restart, PayPal order, real payment or paid AI call was made.

## November 4, 2026: remove the Rewards catalogue; keep progression in the map

The owner explicitly asked to delete the pictured Rewards panel and use less interface. The entire fifth tab and panel are removed: introduction, evidence banner, architectural catalogue, provider explainer, future-tier tour banner/exit and their unused rendering code/styles. Four journey tabs remain: House, Plan, Contribute, Ledger. The original world/models and automatic pixel unlock cards remain.

Earned deeds reopen from a contextual **View deed** button when an owned district is selected on the map. It is hidden for locked districts and the whole-realm view. Cards retain their real status/evidence; visiting, opening and closing still do not write. The completed-goal next step now visits the castle directly. A remembered legacy Rewards tab falls back to a valid step.

**Checks:** asset/palette/renderer/syntax check passed; 3/3 existing journey unit tests passed, including saved payment states and goal completion. All 28 applicable targeted browser cases passed across desktop and phone Chromium emulation, with 2 intentional device-project skips. Coverage: automatic unlock timing/queue/reload, pending/refund/re-crossing, opening/closing/visiting earned map deeds with no writes, arrival while another deed is open, 390/320 px layouts, reduced motion, stale tab recovery, completed-goal navigation, night/rain persistence, the earned court, route framing, milestone announcements/keepsakes and keyboard district focus.

The initial batch had 25 passes, 2 skips and 3 failures: the new desktop completion scenario checked the deed before the long board walk ended; both estate scenarios still asserted a line in the deleted catalogue. The new scenario now waits for the existing board-settled condition; the obsolete text assertion was removed while retaining authoritative keepsake status, announcement and world assertions. Only those 3 failing cases were rerun, and all passed. Original logs/contexts remain ignored in `test-results/minimal-realm/`. No production-code fix was needed for those test expectations. The full suite, provider verifiers and paid calls were not run.

Owner keys/database and approved rehearsal database hashes, permissions and timestamps remain unchanged. No existing server was restarted, and no PayPal order, payment, refund or paid AI call was made. Unit/browser simulated payments/refunds used only their isolated test fixtures. The old videos are preserved at their source commits and now documented as predating this deletion.

## November 4, 2026: game language for destination exploration

The owner rejected the playable world's “Previewing a reward” and art-disclaimer language. The game now uses **Explore** for future rewards, **Visit** for earned rewards, the actual district name (for example **Explore Royal Citadel**), a short **Locked / Open / Keepsake** condition and **Return to your realm**. The court describes its guests and princesses directly. The footer keeps the artwork credit without linking to the historical art-reference tool. Contribution limit errors no longer call the game a prototype.

Only presentation and existing test-language expectations changed. Internal inspection selectors/flags remain compatible. Reward ownership, bridges, server writes, financial logic and provider boundaries are unchanged; sandbox/simulated money and reported savings remain accurately labelled. The old standalone art-reference route and historical media remain preserved.

Checks: the asset/palette/renderer/syntax check passed. Ten existing targeted browser cases passed (desktop and phone Chromium emulation): exploring larger courts, no financial writes or achievements, exact locked condition, restoring actual locks, keyboard focus/accessible description and pointer return. The full suite and paid provider checks were not rerun. Ignored `test-results/game-language/protected-check.json` confirms the saved keys, owner database files and approved rehearsal database hashes/permissions/timestamps are unchanged. No server restart, order or paid AI call was made for this copy edit. A separate actual-game capture also checked the complete visible text for development qualifiers, the Royal Citadel's 20 guests / three princesses / exact locked condition, 320 px keyboard focus and overflow, zero writes/requests/errors and unchanged financial state. The resulting [17.60-second gameplay demo](demos/gameplay/README.md) fully decodes and was visually reviewed.

## November 4, 2026: realm atmosphere, day, afternoon, night and rain, with optional local weather (branch `feature/realm-atmosphere`)

The owner asked for *"night/day/afternoon/rain mode that enables the homes or castles to change and have lights to illuminate the dark"*, optionally following the person's time zone or weather. Built in the worktree `our-castle-district-guide` from `b2b31d5` and promoted locally as `feada574`. Nothing was pushed. The reference lock and ledger are in the atmosphere section of [ART-DIRECTION.md](ART-DIRECTION.md).

**What changed:**
- **Light presets:** the world's existing hemisphere light and sun follow presets for day, afternoon (lower warm-gold sun, cooler fill) and night (teal-blue moonlight).
- **Night lights:**
  - window glass and lantern glass glow, with their own material roles, so cream stone never glows;
  - small wall lanterns at every door, and lamps on the bridge gate posts;
  - six distance-limited warm point lights at the district doors, hidden by day;
  - 18 soft ground pools of five concentric discs each, in one instanced mesh.
- **Rain, with any time of day:** softer, greyer light; damp ground, wet-looking materials and darker water; 540 slanted streaks in two seamless instanced layers; 220 re-placed splashes, moved only on the existing ambient tick. No lightning.
- **Unchanged:** the forest, rivers, bridges, buildings, locks and deeds.
- **Controls** beside the map: `#time-mode` (Auto, Day, Afternoon, Night) and `#weather-mode` (Clear, Rain, Local weather), with an `#atmosphere-status` line naming the source.
  - **Auto** uses the device's IANA time zone through `Intl` (`src/core/atmosphere.js`): day 06–15, afternoon 15–19, night 19–06, labelled as the device clock. It refreshes on the minute tick and when the page becomes visible.
  - **Saved preferences:** they are kept in this browser only and survive refreshes, art previews and contributions.
- **Local weather** uses root's `src/app/local-weather.js` and the CSP `connect-src` addition for the two Open-Meteo hosts.
  - **Opt-in:** nothing is requested until a town is searched and chosen.
  - **Requests:** a search sends only the typed name; choosing a result loads that town's weather.
  - **Saved town:** it is remembered in the browser and can be disconnected.
  - **Late answers:** stale searches and forecasts are canceled, and an old answer never overrides a newer choice.
  - **Retries:** a scheduled reload waits at least 15 minutes after any attempt, failed or not; choosing again is an explicit retry.
  - **Labels:** the status shows Open-Meteo's report time, says when data is not current or unavailable, and draws snow and fog as overcast, never as rain. Open-Meteo and GeoNames are credited.
- **Cosmetic only:** the atmosphere never writes to the server and never touches progress, access, rewards or previews. Night light is not the provider-locked lantern festival, which stays `connection_required`.
- **Debug hooks:** `window.__ourCastle.scene().atmosphere` reports the period, weather, panes, lamps, point lights, pools and rain counts and animation; `window.__ourCastle.sky()` reports the controller state.

**Checks run** (Playwright example server and an isolated example server on 3154; Open-Meteo mocked in browser tests; no PayPal or AI calls):
- **Unit:** `test/unit/atmosphere.test.mjs` **4/4**: period edges; New York and London daylight-saving changes; Kolkata's half-hour offset; the fallback for an unknown zone; manual overrides; local-weather looks and labels (fresh, stale, failed, loading, snow as overcast). Root's `test/unit/local-weather.test.mjs` (7/7) was run by root and not rerun here.
- **Browser:** `test/e2e/atmosphere.spec.mjs` **15 passed, 1 skipped by project**:
  - Night + Rain apply six point lights, 90 pool discs and glowing panes, with no write. They survive a reload, a castle art preview and its return (with no `previewFeature` and the festival still locked), and a simulated contribution.
  - Auto in Los Angeles, with a fixed clock, goes from afternoon at 18:59 to night at 19:00.
  - Local weather is opt-in, with no request before a search. It is remembered after a reload with no new search, and Disconnect forgets the town and makes no further requests.
  - A slow forecast never overrides a newer Clear choice; an unreachable service is labelled and drawn clear.
  - After a failed load, the scheduled reloads at 1, 5 and 14 minutes make no request, 16 minutes does, and an explicit choice retries at once.
  - Reduced motion keeps rain still with no timer. A hidden page stops ambient frames.
  - At 320 px: 44 px keyboard-usable selects, and no overflow.
- **Affected existing specs:** `realm`, `estate`, `realm-focus` and `area-cards` **36 passed, 2 skipped by project**. The woodland colour test in `realm.spec` now selects Day explicitly, because Auto follows the machine clock.
- `npm run check` and the whitespace check passed. The full suite, the financial/family suites, Postman guards and PayPal/AI verifiers were not run.

**Frame cost** (one finished frame, whole realm, headless SwiftShader, possibly contended by root's parallel review; not a hardware benchmark):

| Mode | Desktop frame | Phone frame | Triangles |
| --- | --- | --- | --- |
| Day | 209 ms | 97 ms | 189,622 |
| Afternoon | 203 ms | 98 ms | 189,622 |
| Night | 217 ms | 99 ms | 196,102 |
| Night + rain | 220 ms | 112 ms | 211,702 |
| Day + rain | 231 ms | 109 ms | 205,222 |

Draw calls: 441 by day, 442 at night, 443–444 with rain.

**Root review:**
- On its own example server (3156), root's actual browser search and forecast for a public city (Edinburgh) succeeded through the new CSP, with exactly two anonymous GETs to Open-Meteo.
- The manual controls and camera moves made zero financial writes.
- Root approved the night cottage and night rain citadel renders, now in `docs/screenshots/atmosphere-night-cottage.png` and `atmosphere-night-rain-castle.png`.

**New visual preview:** [18.04-second MP4](demos/atmosphere/our-castle-time-weather-preview.mp4), actual example-mode UI with manual Day, Afternoon, Night and Rain. Its burned-in label names example mode and manual weather. The entire export decodes, and its size and SHA-256 match the [source notes and timeline](demos/atmosphere/README.md). No payment, paid AI call or live-weather footage is presented in this clip. The older 2:51 review is preserved and predates deeds and atmosphere.

**Limitations:**
- **Local activation:** the main app on 3010 was restarted from the promoted source to activate the two weather origins in its CSP (PID 57180 to 91227). Its selected household/API state and every user database table/row match the pre-restart backup; only SQLite's internal `sqlite_sequence.seq` counter changed during ordinary startup. The saved `.env` bytes, permissions and timestamp are unchanged. The active header was verified; a public Edinburgh forecast was exercised on the separate example fixture, not with the owner's city on 3010. The isolated 3021 rehearsal (PID 67124) and its database remain untouched, with its original runtime CSP. Do not restart it or start checkout from this project worker. Ignored preservation evidence: `test-results/atmosphere-review/activation.json` and `database-comparison.json`.
- **Clock:** Auto uses fixed device-clock bands, not astronomical sunrise or sunset.
- **No geolocation:** there is no automatic location, IP lookup or PayPal account time zone.
- **Not covered:** Chromium emulation only; no real phone, Safari, Firefox or screen reader.

## November 4, 2026: district deeds, a card when a new area opens (branch `feature/area-unlock-cards`)

The owner asked for *"a card that indicates when you unlock a new area pixelated like a monopoly card."* Built from `7918113` and promoted locally as `da602b8`. The owner's keys, database file hashes/modes/timestamps, selected household state and original server PIDs on 3010, 3021 and 3140 were unchanged. The current main app serves the new files; preservation evidence is in git-ignored `test-results/area-card-review/promotion.json`. Nothing was pushed. The reference lock and ledger are in the district-deeds section of [ART-DIRECTION.md](ART-DIRECTION.md).

**What it does:**
- **When it appears:** after the board animation, a portrait deed card (a native modal dialog) appears for each district that the server's state newly opened for the same household and goal. The rule is `newlyOpenedDistricts` in `src/core/deeds.js`, which compares `rewards.realm.districts` between server states.
- **When it never appears:** first loads, reloads, replays, refunds and keepsakes, re-crossing a milestone, pending or canceled payments, and art previews.
- **Several at once:** they queue as "Deed 1 of 3", with Next and Close all.
- **Card face:**
  - the exact condition the server reports;
  - one line on the main buildings, one line on the court guest count with any princess;
  - the server's evidence label;
  - a "Realm keepsake" stamp ("Example mode · simulated payments", "PayPal sandbox · test money", or for the Woodland Garden "self-reported habit, not verified by any bill provider");
  - Visit and Close.
- **Deed details:** the full building description, guest names, estate additions with their real status, and the provider-required water garden (still locked).
- **Picture:** root's original 320 × 176 render of the district (`assets/area-cards/`, provenance in that folder), shown at 1× with pixelated rendering and cropped, not resampled, on narrow screens; its alt text says it is a pixel portrait. The household crest is the seal.
- **Visit** leaves any art preview, focuses that district on the map and keeps keyboard focus on its control.
- **Close or Escape** returns focus to where it was.
- **Reopening:** Rewards → District deeds reopens earned and keepsake deeds, and shows locked ones with their exact condition.
- **Nothing writes:** viewing, visiting and closing make no server request. There are no backend, threshold, entitlement or persisted-data changes.
- **Race fixed during review:** an open dialog is updated in place instead of being closed and reopened. A close event that arrives late is ignored once the dialog is open again, so it cannot clear newer deeds.
- **Copy:** the manor's reward text now matches the current model: a cobalt main roof and a crimson-roofed wing.

**Checks run** (Playwright example server and an isolated example server on 3143; no keys, no PayPal or AI calls):
- **Unit:** `test/unit/deeds.test.mjs`, **2/2**, against a real in-memory example server.
  - Only newly opened districts count. Nothing opens on a first load, an unchanged state, a canceled payment or a pending payment; the manor opens when the server completes the pending one.
  - A replayed request and a refund to a keepsake open nothing, and re-crossing announces nothing.
  - A $120 jump opens the market and the keep; a self-reported bill opens the garden; a different goal is never compared.
  - The content of each deed: the exact conditions, evidence, stamps (example, sandbox, self-reported), the provider-locked water garden, no invented guests for the market or garden, and addition statuses.
  - The related unit tests (`journey`, `rewards`, `realm`, `court`) also pass: 22 tests in total.
- **Browser:** `test/e2e/area-cards.spec.mjs`, desktop and phone projects, 8 scenarios. All pass.
  - The deed opens only after the board stops animating, with focus on its title, and the picture is 320×176 and pixelated.
  - Escape returns focus to the receipt, and a reload shows no deed.
  - Pending, refund, re-crossing and art previews show none.
  - The collection reopens a deed with keyboard focus returned on Escape, and locked entries show their conditions.
  - A three-deed queue with Next works, and Visit focuses the Stone Keep fully on screen with no writes.
  - Visit from the collection ends an art preview.
  - A new area arriving while a collection deed is open replaces it in place and is not lost.
  - At 390×844 Visit and Close are on screen without scrolling. At 320×568 the card scrolls inside itself with Close reachable. Buttons are at least 44 px and nothing overflows horizontally.
  - Reduced motion removes the entrance animation.
- **Existing specs:** `journey`, `family-journey`, `estate`, `realm`, `court` and `realm-focus` pass (all non-skipped tests; skips are by project). In specs where deeds are not under test, `test/e2e/support/deeds.mjs` closes an opened deed with its real Close button before the next action; no assertion was removed.
- `npm run check` and the whitespace check passed. The full suite, Postman guards and PayPal/AI verifiers were not run.

**Visual review:** root reviewed the actual card on its own example fixture (port 3153), checking:
- a $15 simulated payment unlocking the Manor;
- a quiet reload;
- collection Enter and Escape returning focus;
- Visit focusing the Manor;
- zero writes from navigation, no page errors and no external requests;
- a closed card 614 px tall at 390×844, scrolling inside itself at 320 px.

The approved crop is `docs/screenshots/deed-manor.png`. The card tryout on http://localhost:3153 is an isolated example household, initially $60 reported plus one $15 simulated contribution; it is left available for the owner and must not be reset during their review. The preserved 2:51 video predates these cards; it remains labelled with its original footage provenance.

**Limitations:**
- **Not covered:** Chromium emulation only; no real phone, Safari, Firefox or screen reader.
- **Sandbox wording not exercised:** the stamp's PayPal sandbox wording is unit-tested but was not seen in a browser, and the live checkout/`get_order` gap is unchanged.
- **Session-only queue:** if a family reloads before reading a queued deed, it is not shown again automatically. It remains in Rewards → District deeds.

## November 4, 2026: current woodland/family review video

The private [2:51 review kit](demos/woodland-review/README.md) shows new recorded example-mode family steps, the green woodland, a simulated $15 Manor unlock, a saved record after refresh and a labelled castle art preview. Earlier live-AI footage and historical PayPal verifier evidence remain separately labelled. The approved sandbox popup/receipt/same-order get_order insert is still **unfilmed at 2:17–2:41**. No missing outcome was reconstructed and nothing was submitted.

- App footage source: `ecc7cc5`; a new headless Chromium context and an owned key-free example server on 3141 with a fresh database. Four real UI writes: setup, example plan, explicit plan acceptance and one simulated contribution. No external browser request, page error, PayPal call or paid AI call. Navigation made no writes.
- The continuous original is retained. The earlier capture that exposed the Ledger focus issue is retained as superseded QA; the corrected recording checks the focused record is fully visible after the grid settles.
- Actual export: **171.00 seconds**, 1920×1080 H.264 at 25 fps, **4,275 frames**, AAC mono narration at 24 kHz, **37 measured captions**. Fully decoded without errors; caption bounds and every included source hash checked. Representative final frames were inspected against the actual app for the forest, family plan, fully-visible record and explicit unfinished slate.
- Synthetic voice: offline macOS Daniel, not the owner's voice. Editable narration, timeline, SRT/WebVTT, source hashes/ranges, original notices, capture/render scripts and exact insert instructions are included.
- MP4: 10,447,683 bytes; SHA-256 `95dbde0b754fd37c8dd51054fa74c8bb9026ebe5f055f6511ec0b130b865606e`. The 36-second original clip and older 2:36 draft retain their original bytes.
- The Mac's existing Python 3.9/Pillow environment was used for rendering; no new package was installed. The editable kit records that interpreter because the separate Homebrew Python lacks Pillow.
- The owner reports PayPal login, but this worker has no supported browser controls. The preserved 3021 rehearsal still needs the existing browser operator to verify its personal sandbox-buyer session and resume the already-approved isolated test. No new key or repeated payment approval is needed. Source/provenance: [PROVENANCE.md](demos/woodland-review/PROVENANCE.md); exact remaining flow: [OWNER-INSERT.md](demos/woodland-review/OWNER-INSERT.md).

## November 4, 2026: an easier family journey with one next step (branch `feature/family-journey`)

The owner chose *"An easier family journey: clearer planning, contributions and next steps."* This superseded the district-guide task before any of that feature was implemented; its drafted art-direction note is saved in the worktree's git-ignored `test-results/district-guide-paused/`. Built in the worktree `our-castle-district-guide` (branch renamed in place) from `68878ac`, reviewed, and promoted locally to `expansion/wider-estate` at `2a18bc5`.

**What changed:**
- **Next step:** the goal card shows one next step from saved state, with one or two lines on why and a button naming what it opens. The steps, in priority order:
  1. found the house;
  2. the goal is complete;
  3. a payment is pending;
  4. a confirmed receipt has not been shown yet;
  5. make a plan;
  6. review a plan that is not in use;
  7. this week's planned contribution;
  8. contribute more after the planned weeks.
- **Shared logic:** `src/core/journey.js` derives the step and is shared and unit-tested.
- **Supporting lines:** canceled, declined, unfinished, refunded and keepsake states add a line that never reads as credit.
- **Opening a step:** the button only switches tab and focuses that step's heading or control. Keyboard activation scrolls instantly.
- **Payment record link:** a small line under the step names the latest saved payment and opens its record in the Ledger, by GET-only navigation.
- **Tabs:** the tab holding the next step has a gold underline and "next step" for screen readers. The Plan tab counts as done only when the current plan is the accepted one.
- **Resume:** a refresh keeps the tab the family chose in that browser tab (session storage); a new visit opens the next step's tab; an unfounded house always opens House. Refreshes after actions never move the family or clear unsaved plan or amount input; that behaviour already existed and is now tested.
- **Contribute:** it names the plan in use. Under the amount, "If the server confirms…" shows the new total and any milestone or estate addition it would reach, with the shared milestone rules. It says nothing counts until the server confirms, and that the receipt appears below and in the Ledger.
- **Existing defects fixed on the way:** the contribution receipt printed a literal "null" at its end (`replaceChildren` with a `null` argument). At 320 px, the bold "Contribute" tab label was clipped by 1–2 px.
- **Unchanged:** no new financial rules, thresholds, planner, navigation or server endpoints. No art or renderer changes.

**Checks run** (isolated example server on 3140 and the Playwright example server; no PayPal or AI calls):
- **Unit:** `test/unit/journey.test.mjs`, **3/3**. It drives a real in-memory example-mode server through every step in order: setup → plan → accept → canceled → pending → server completion → receipt → refund/keepsake → completion. It checks the step, button, target and record link at each state, and the child persona's adult-approval line. Plus:
  - an unfinished `created` sandbox order;
  - a newer unaccepted plan;
  - projections for the default goal, a keepsake, the village quarter and an awkward custom goal ($1,234.56).
- **Browser:** `test/e2e/family-journey.spec.mjs`, **8/8** on desktop and phone projects, including 320×568:
  - first-time House step;
  - keyboard focus reaching the House heading, Plan heading, plan headline, Ledger heading, receipt and Ledger row;
  - no non-GET request from any step button, tab change or record link;
  - review without accepting;
  - the Plan done mark cleared by a newer plan;
  - the projection;
  - an unsaved amount kept across a bill log on another tab;
  - a pending payment that is not credit;
  - receipt-ready while on the Ledger;
  - refresh restoring the chosen tab, then the record link;
  - a new tab resuming at Contribute;
  - the child persona line;
  - no overflow, labels that fit, and a 44 px button at 320 px.
- **Existing browser tests on affected paths:** `journey.spec`, `estate.spec` and `realm-focus.spec`, **39 passed, 1 skipped by design** (the keyboard-only journey runs on desktop only). After the final narrow-tab CSS change, the full and layout journey tests were rerun, **4/4**.
- `npm run check` and whitespace checks passed. The full suite, Postman guards and PayPal/AI verifiers were not run.

**Captures:** `docs/screenshots/journey-next-step.png`, `journey-receipt-ready.png`, `journey-phone-first-time.png` and `journey-320-contribute.png`. All states on desktop, 390 and 320 px are in git-ignored `test-results/family-journey/final/` with `journey.json` (no page errors, no horizontal overflow). The 3140 demo was reset to its starting state ($60.00 of $300.00, no house, plan or contributions; 1/6 districts).

**Limitations:**
- **Not covered:** Chromium emulation only, with no real phone, Safari, Firefox or screen reader.
- **Sandbox wording not exercised:** the PayPal sandbox wording of the projection and next step was not seen in a browser, because this worker does not use a signed-in browser or sandbox checkout. The live checkout/`get_order` reconciliation gap recorded elsewhere is **not** resolved by this change.
- **Session-only receipt:** the receipt-ready step lives only in the browser session; after a refresh the record link is the way back.

**Recorded-flow focus follow-up (`ecc7cc5`):** actual 1760×760 recording exposed a lazy-AG-Grid layout shift: the focused saved payment record moved below the viewport after its first reveal. A deterministic route gate reproduced it before the fix. The destination now waits for the existing grid load/fill promise and two stable-height animation frames, then reveals only if navigation and focus intent are unchanged. It reuses the existing grid work and performs no server write. The same handling covers the pending-payment Ledger destination. New gated-load tests passed in two repeats (8 passed, 8 duplicate-viewport cases skipped by design); the complete family spec then passed 12/12 active cases and the affected Ledger journey cases 8/8. A real-grid 1760×760 capture measured the focused row at top 12, bottom 123 within the 760-pixel viewport. Only main.js and the focused browser spec changed. Root reviewed and promoted the fix; the original recording is retained as superseded QA evidence, and the corrected walkthrough is recorded separately. No paid test or unrelated suite was repeated.

**Local promotion check (November 4, 2026, 12:42 PM Pacific):** the existing app on 3010 serves the checked HTML, CSS, main module and new journey module byte-identically. All baseline household files and .env retained their content hashes, modification times and permissions; the selected household/goal/progress/ledger/plan state also hashed identically. Original 3010/3021 server processes remain 57180/67124. No server restart, checkout, payment or paid AI call was needed. Evidence: git-ignored `test-results/family-journey-promotion/after.json`. The identical-code suites were not repeated after promotion. The isolated example demo remains on 3140; recording uses its own fresh 3141 copy instead.

## November 4, 2026: woodland realm with rivers and colourful locked castles (branch `art/woodland-realm`)

The owner's visual correction: *"it should be all green the landscape is a forest separated by rivers under the bridge not this big ocean and why are the castles so bland?"* Built in the separate worktree `our-castle-woodland` from `da82bad`, reviewed, and promoted locally to `expansion/wider-estate` at `ce43a0f`. Brief, reference lock and ledger: the woodland section of [ART-DIRECTION.md](ART-DIRECTION.md).

**What changed (presentation only):**
- **Ground:** one continuous forest floor. The districts are meadow clearings; there are no island slabs or rock-cliff shores.
- **Rivers:** three narrow connected rivers (`REALM_RIVERS` in `src/core/realm.js`). The main river runs under the garden, keep and royal-procession bridges, the west tributary under the manor bridge, and the east tributary under the citadel and market bridges.
- **Bridges:** stone approaches on the banks, bank piers clear of the channel, and two wooden leaves meeting over mid-river. Locked crossings have raised leaves and a closed gate on the far bank.
- **Colour:** the blanket desaturation of locked districts is removed. Added crimson, cobalt and gold roofs and spires, shutters, quoins and string courses, long banners, crest shields, planters, a fountain and bunting. The manor, keep and citadel are distinct.
- **Copy:** the UI and canvas text no longer promises grey districts.
- **Unchanged:** earned access, milestones, court sizes, payments and rewards. Previews make no writes.

**Rendered evidence** (headless Chromium + SwiftShader, isolated example server on 3138; before = `da82bad`). Share of drawn map pixels, background and outlines excluded:

| View | Green before → after | Blue water before → after |
| --- | --- | --- |
| Desktop 1440×1000, whole realm, 1/6 open | 7.2% → 54.0% | 44.2% → 6.3% |
| Desktop, locked Royal Citadel close-up | 5.7% → 59.3% | 39.6% → 8.3% |
| Phone 390×844, whole realm | 6.9% → 54.9% | 38.6% → 4.7% |

- **Outline pixels:** desktop 13% → 22%, phone 25.7% → 30.1%. These are the forest silhouettes; at phone scale the forest reads as green canopy with dark texture.
- **Geometry** (unit-tested): water covers 7.7% of the realm (the test requires under 10%). River half-widths are 2.4 and 1.9 units, against the old 11–19-unit gaps between shores.
  - Every bridge centre lies on its river's centre line, and both ends land at least 3.5 units onto dry bank.
  - Every clearing stays at least 2 units from water.
  - Both tributaries join the main river, and all three run off the board edge.
- **Captures:** `docs/screenshots/forest-*.png` (overview, locked citadel, phone overview, citadel preview, simulated manor). Before/after pairs, pixel reports and scripts are in git-ignored `test-results/woodland-realm/`.

**Lock truth:**
- **Start:** only Hearth Village is open. All six bridges are raised with gates, and no district has grey paint; each has at least 4 hue families.
- **Simulated progression** (example mode, no PayPal call): a simulated $15 contribution, $60 → $75, opens the manor and lowers only `manor-bridge`, with 2 village and 4 manor guests.
- **Castle art preview:** labelled; opens five districts and five crossings, and `garden-bridge` stays raised and gated. Returning restores 1/6 and 2 guests.
- **Reset:** the 3138 demo was afterwards returned to its starting $60 / $300, 1/6 state with `/api/demo/reset`.

**Performance** (one finished frame forced by a pixel read-back, whole realm, SwiftShader software rendering; a stress proxy, not device timings):

| Build | Draw calls | Triangles | Desktop frame | Phone frame |
| --- | --- | --- | --- | --- |
| Before (`da82bad`) | 354 | 79,142 | 157 ms | 57 ms |
| First woodland pass, standard material | 422 | 202,230 | 483 ms | 128 ms |
| Final: forest and ground in flat Lambert batches, hidden trunks dropped | 422 | 188,650 | 197 ms | 98 ms |

- **Woodland contents:** one ground mesh (21,199 vertices, 38,504 triangles), plus the forest and river details in 22 instanced meshes (3,441 instances):
  - 473 trees (249 conifers, 215 broadleaf, 9 birches);
  - 120 shrubs and 163 fern clumps;
  - 123 floor details;
  - 75 reed clusters and 61 bank stones.
- **Build cost:** the woodland is built once, 423 ms in a headless run, and kept. A milestone or preview rebuild of the districts and bridges took 7 ms.
- **What went wrong first:** the standard-material pass starved the compositor under software rendering. Smooth scrolling then stalled for 1–2 s, and the keyboard preview check failed 6/6 (the unchanged `da82bad` code passed 24/24).

**Keyboard follow-up:** a keyboard activation (`click` with `detail` 0) of a reward preview or a district now scrolls **instantly** to the realm. Focus has already moved, so the focused control is on screen at once. Pointer navigation keeps the smooth scroll. The `d869f1b` visibility assertions are unchanged.

**Checks run:**
- `npm run check`: 47 art/runtime files, the 90-colour palette, renderer wiring and syntax passed.
- Unit `realm` and `court`: **8/8**, including the new river test.
- Browser: `realm.spec`, `court.spec` and `estate.spec` **18/18**; the journey tests "full journey", "world keeps living" and "original art preview" **6/6**; `realm-focus.spec` **16/16** over two repeats. These ran before the final ground-material side fix, which only restores the board's soil edge; captures and the progression run after it had no page errors and no unexpected writes.
- Not run: the full suite, Postman/Newman guards, PayPal or AI verifiers. No paid call, order or refund.
- Not checked: real devices, Safari or Firefox.

**Owner data:**
- During development the primary checkout stayed clean at `da82bad`. `.env` and `data/` modification times are unchanged; the later local promotion is recorded below.
- The servers on 3010, 3020 and 3021 were left running and untouched.
- The temporary before-baseline server (3139) was stopped. Its data folder was left in place.

**Local promotion check (November 4, 2026, 12:05 PM Pacific):**
- The reviewed woodland commit `ce43a0f` is now in the primary local branch `expansion/wider-estate`. Nothing was pushed or published.
- The existing app on `http://localhost:3010` serves all five changed JavaScript modules byte-identically to the checked source. Refresh the page to load the new art; no server was restarted.
- All baseline `.env` and household files retained their content hashes, modification times and permissions. The selected household, goal, progress, ledger, contribution, achievement and plan state also hashed identically.
- The owner app on 3010 (PID 57180) and the separately coordinated sandbox rehearsal on 3021 (PID 67124) kept their original processes. No checkout, AI call or rehearsal action was performed for this art change.
- The example preview remains available on `http://localhost:3138`, with $60 of $300 and 1/6 districts earned. Its progression is simulated, separate from the owner's records.
- The original 36-second realm clip and the 2:36 judge draft retain their original SHA-256 hashes. They still show the historical island visuals.
- Machine-readable preservation and served-source checks: git-ignored `test-results/woodland-promotion/after.json`. No already-passed browser or unit suite was repeated after promotion of the identical code.

## November 4, 2026: playable judge review draft and focused keyboard/device fix

**Judge review draft:** `docs/demos/judge-review/our-castle-judge-review-draft.mp4` is a **2:36.36 private draft**, not a submitted or fully live end-to-end video. It reuses the current example-mode connected-realm footage, labelled earlier live-AI UI recordings, and separately labelled historical verifier reports. A visible **24-second unfilmed owner insert at 2:00.36–2:24.36** remains for the actual in-app popup approval, receipt/bridge and household `get_order` reconciliation. No missing outcome was reconstructed. Editable timeline, narration, SRT/WebVTT, source excerpts/hashes and an exact insert guide accompany it.

**Media checks actually performed:**
- 156.360 s; 1920×1080 H.264; 25 fps; **3,909 video frames**; AAC mono narration. Full video/audio decode completed with exit 0.
- **32 caption cues** use measured offline speech-phrase durations, are ordered and non-overlapping, fit their scenes, and end within the cut. No spoken phrase is truncated. The voice is synthetic offline macOS Daniel, not the owner's voice; no speech service or music was used.
- Audio measured mean −20.2 dB and peak −1.0 dB.
- The two original recordings match their recorded SHA-256 values. The preserved 36-second realm clip remains **1,932,194 bytes**, SHA-256 `33dd65316e28ee6e059cb856deccaaebfe8eb071e00750ab18f4d3b51beb2fc1`.
- Historical excerpts are cropped/trimmed from actual earlier recorded UI; original obsolete narration/small-plot world are omitted. Report copies are byte-identical. All included source/derivative hashes are checked by the renderer. Representative rendered frames were inspected for legibility and correct provenance labels.
- Final draft SHA-256: `14e9f9aea57c4988979a45fc473dd55c8a79db3fdb04cca104aa5f882c52c344` (10,046,567 bytes). The clip's render report and source manifest record its inputs.
- No new payment order, refund, paid AI call, integration retest, upload or publication. This is media preparation, not evidence that any previously unverified app path now works.

**Focused UI review/fix:** commit `d869f1b`; details in [ACCESSIBILITY-DEVICE-REVIEW.md](ACCESSIBILITY-DEVICE-REVIEW.md).
- On a keyboard reward preview, focus had stayed thousands of pixels below the scrolled-to realm, 21 Shift+Tab presses from its exit. At 320 px, district selection could also scroll the focused button off-screen.
- The fix keeps the selected district control visible, moves preview focus to its described return control, and restores keyboard focus to the source reward card when returning. The six-district geometry, buildings, grey locked areas, raised bridges and renderer are unchanged.
- Chromium desktop/390×844/320×568 emulation audit: visible focus, names, tab navigation, no horizontal overflow and no page errors/non-GET audit requests.
- **8/8 focused browser tests passed.** Against the old code, four fail; those demonstrate the 320 px district and keyboard-preview regression. The small desktop clipping measured by the audit did not reproduce in that runner, as the detailed review explicitly records.
- **12/12 existing affected-path browser checks passed** (realm/court 10, estate preview 2). Syntax and whitespace checks passed. No full suite or already-passed Postman guard suite was rerun.
- `.env` and owner `data/` hashes/timestamps and all compared household fields matched the saved baseline. Existing servers on 3010 and 3020 were preserved. The isolated review server was stopped; its temporary database was retained.
- This is **Chromium emulation only**. It does not close real iOS/Android hardware, Safari/Firefox, screen-reader, forced-color, 200% zoom, AG Grid or PayPal popup accessibility checks. Remaining observations are in the review.

## November 4, 2026: tracked demo clip and private offline review kit (packaging only)

**Handoff fixes**, commit `47b35eb`:
- **The clip:** the finished example-mode clip is now tracked at `docs/demos/our-castle-connected-realm.mp4`. It is byte-identical to the git-ignored original, which stays in place (`cmp` identical; 1,932,194 bytes; SHA-256 `33dd65316e28ee6e059cb856deccaaebfe8eb071e00750ab18f4d3b51beb2fc1`). `ffprobe` shows 36.36 s, 1920×1080 H.264, 25 fps and no audio stream. A provenance note sits beside it, and NOTICE.md says the artwork scope applies to it.
- **JUDGE-HANDOFF:**
  - It no longer implies that cloning GitHub gives the prototype, since `main` is only the original starter. It points to the review kit instead.
  - A failed popup rehearsal now stays in the isolated copy, with no fallback to the owner's household on 3010.
  - Its "nothing blocked on code" line is limited to the scope actually reviewed.
- **README and DEMO-SCRIPT:** point at the tracked clip; README uses `npm ci`.

**Review kit validation**, run on a trial archive of `47b35eb`. The same script repeats it on the final kit, built from the commit that adds this note. That kit's commit and archive hash are in the manifest beside the zip, outside the archive, so no commit has to contain its own hash.
- **Built** with `git archive --format=zip --prefix=our-castle/` from the committed HEAD (clean tree), not the working directory. Source snapshot only, with no history.
- **Paths:** 167 files under one top-level `our-castle/` folder, equal to the 167 files tracked at the commit. No `.git/`, `node_modules/`, `test-results/`, runtime `data/`, `*.sqlite*` or `.env*` other than `.env.example`.
- **Extraction:** into a fresh directory under the ignored `test-results/local-review/`. Present:
  - the realm source (`src/core/realm.js`, `src/world/realm-models.js`, `src/world/board-scene.js`) and the server;
  - README, the judge handoff, the demo script and this log;
  - `NOTICE.md`, `LICENSE`, `assets/manifest.json`, `vendor/three/LICENSE` and both OFL font licenses;
  - the three `references/images/our-house-*.png` captures;
  - `package.json`, `package-lock.json` and `.env.example`.

  The extracted clip's hash matched.
- **Secrets:**
  - Exact-match check against the configured `.env` credentials (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `AI_API_KEY`; `PAYPAL_WEBHOOK_ID` is not set): 0 matches in every extracted file. Values were read only for the comparison and never printed. `.env` was not modified.
  - Pattern scan, 6 matches, all explained:
    - 4 synthetic `sk-ant-` fixtures in `test/unit/set-ai-key.test.mjs`;
    - 2 key-shaped strings inside a `data:font/ttf;base64,` run in `references/pixel-rendering-study.html`, the original hash-locked art reference, present since `5cf8363`.
  - No SQLite files.
- **Not done:** dependencies were not installed, and no app, unit, browser or paid suite was run from the extracted copy.

**Owner app:** read-only `GET /api/status` still reports PayPal sandbox and live AI (`claude-opus-5-5`). `GET /api/state` matches the saved baseline for household, members, goal, progress, ledger, contributions, achievements, plan, accepted plan and next step. The `.env` and `data/` modification times are unchanged.

The kit is private review material. It does not satisfy the public-repository, YouTube or Devpost requirements, which remain owner decisions.

## November 4, 2026: the Postman sandbox folder is off by default

**The gap.** The example-folder guard (next section) stops at its own folder. Running the whole collection after a successful folder 1 would have continued into folder 2. Folder 2 calls the app on `baseUrl` (the owner's sandbox app on 3010) and PayPal directly on `paypalApiBase`, and its steps 2.2 and 2.10 create sandbox orders.

**The fix.**
- Folder 2 has a folder-level pre-request guard with no network call of its own.
- Unless `allowSandboxRequests` is exactly `"yes"` for the run, the guard uses the same mechanism tested for folder 1. It records a failing `BLOCKED "<request>" (not sent)` assertion, calls `pm.execution.setNextRequest(null)`, then calls `pm.execution.skipRequest()`.
- The committed environment and collection defaults are empty strings, so folder 2 is off.
- The opt-in is a developer test permission only. Adult approval in the app and sandbox buyer approval in PayPal are unchanged.
- Docs now pin the tested runtime as `npx --yes newman@6.2.1`. On this Mac, `npx --offline --yes newman@6.2.1` resolved to the cached 6.2.1 with no download and no new cache entry. The check script refuses any other Newman version.

**Real Newman 6.2.1, `npm run check:postman-guard`: 16 passed, 0 failed.** That is the 12 folder-1 cases from the next section plus four new cases. In every folder-2 case, both destinations pointed at local logging stubs: the app (`baseUrl`) and the PayPal API (`paypalApiBase`).

| Case | Result |
| --- | --- |
| **Whole collection, no opt-in** (what an accident looks like) | Folder 1 ran against a fresh example server: temporary database, no `.env`, empty keys, behind a logging proxy. It sent its 10 requests. Folder 2 stopped at 2.1. **App stub 0 requests, PayPal stub 0.** Newman counted 20 requests, and exactly 20 were logged locally, so nothing went anywhere else. The only failure was `BLOCKED "2.1 Server is in PayPal sandbox mode" (not sent)`; exit 1 |
| Folder 2 alone, no opt-in | App stub 0, PayPal stub 0, Newman 0 requests; exit 1; stopped after 2.1 |
| Folder 2 alone, `allowSandboxRequests=true` (not exactly `yes`) | Same: 0 requests anywhere; exit 1 |
| Folder 2, `allowSandboxRequests=yes`, **stubs only** | The guard let the run through: app stub 8 requests, PayPal stub 3 (token, order lookup, direct order create). Newman counted 11. There was no `BLOCKED` failure. The stubs' fake replies fail folder 2's own assertions, as expected: this proves the opt-in path, not the sandbox |

**Visible CLI result:** the whole collection ran with the pinned `npx --offline --yes newman@6.2.1`, against a throwaway example server on 3134, with `baseUrl` and `paypalApiBase` pointed at a closed local port.
- Output showed `BLOCKED "2.1 Server is in PayPal sandbox mode" (not sent): sandbox requests are off by default; allowSandboxRequests is "", not "yes".`
- Newman's table: 20 requests, 32 assertions with 1 failed; exit 1.
- The server was then stopped.

**Unit tests:** `node --test test/unit/postman.test.mjs`, 8 passed. New tests check that:
- the committed defaults are empty;
- each folder has its own guard, and the sandbox guard sends nothing of its own;
- ten non-`yes` values all block (missing, empty, `no`, `true`, `1`, `YES`, `Yes`, padded, `y`), and only `yes` passes.

Loosening the comparison to `!optIn` failed the guard test, and committing `"yes"` as the default failed the defaults test. Both files were restored.

**Not done:**
- Folder 2 was never run against the app on 3010 or against PayPal.
- No sandbox order was created and no AI call was made.
- The owner's household was read only through `GET /api/status` and `GET /api/state`, and matched the saved baseline.
- Other suites were not rerun.

## November 4, 2026: fail-closed guard for the Postman example folder

**The gap.** Folder 1 of the Postman collection writes and calls the planner and steward. It used the same `baseUrl` default as folder 2, `http://localhost:3010`, which is where the owner's sandbox app with live AI runs. Run as documented on that Mac, it would have renamed the sandbox household, logged a bill and made paid AI calls.

**The fix.**
- Folder 1 now targets its own `exampleBaseUrl`, default `http://localhost:3134`. Folder 2 keeps `baseUrl`.
- A folder-level pre-request script runs before every folder-1 request and calls `GET {{exampleBaseUrl}}/api/status`. Unless the reply is HTTP 200 JSON with `payments.mode === "example"` **and** `ai.mode === "example"`, the guard:
  1. records a failing `BLOCKED "<request>" (not sent): <reason>` assertion;
  2. calls `pm.execution.setNextRequest(null)`;
  3. calls `pm.execution.skipRequest()`.
- A malformed or empty `exampleBaseUrl` blocks before any network call.
- The guard does not rely on throwing. `skipRequest` is supported for pre-request scripts by the cached runtime (Newman 6.2.1, postman-runtime 7.39.1, postman-sandbox 4.7.1), and the runs below show the request is not sent.

**Real Newman runtime, `npm run check:postman-guard`: 12 passed, 0 failed.** Mock targets on free localhost ports log every incoming request. Port 3010 is refused by the script and was never targeted.

| Case | Result |
| --- | --- |
| Status says sandbox payments, example AI | Blocked: exit 1; the mock received only `GET /api/status`; the run stopped after item 1.1 |
| Example payments, **live AI** | Blocked, same evidence |
| Sandbox payments and live AI | Blocked, same evidence |
| Status HTTP 500 / not JSON / `{}` / modes as plain strings | Each blocked, same evidence |
| Status port closed (`ECONNREFUSED`) | Blocked: exit 1; only the failed status attempt; stopped after 1.1 |
| `exampleBaseUrl` empty, or with a path | Blocked: exit 1; no request at all |
| Control: a mock that claims example/example | The guard lets requests through, and the mock received all 10 folder requests. So the mocks above would have recorded any mutation |
| A fresh example-mode server (temporary database, no `.env`, empty PayPal and AI variables) behind a logging proxy | Exit 0; 10 folder requests, each immediately preceded by `GET /api/status`; **31/31 assertions passed** (the original 21 plus one guard confirmation per request) |

**The README's exact commands** were run on port 3134 with the cached Newman CLI:
- the server started with `Payments: EXAMPLE mode` and `Planner: EXAMPLE mode`;
- every item showed "example payments and example AI confirmed by /api/status before sending";
- Newman's table reported 20 requests (10 guard checks plus 10 folder requests) and 31 assertions, 0 failed.

The server was then stopped.

**When the port is taken:** the documented start command, pointed at an occupied port (3020), printed `Error: listen EADDRINUSE` and exited, and the existing server kept answering. The README and the judge handoff now say to stop at that point rather than run Newman.

**Unit tests:** `node --test test/unit/postman.test.mjs`, 5 passed.
- Two new tests run the guard exactly as written against a stubbed `pm`. Twelve status replies and six malformed variables must block, and only example/example sends.
- A third checks the variable split: folder 1 uses only `exampleBaseUrl`, folder 2 never does, and the guard is not attached to folder 2.
- Weakening the guard to ignore `ai.mode` made the fail-closed test fail; the file was then restored.

**Not done:**
- Folder 2 (sandbox) was not run.
- No PayPal order was created and no paid AI call was made.
- The owner's app on 3010 was read only through `GET /api/status` and `GET /api/state`. Household, members, goal, progress, ledger, contributions, achievements and plan matched the saved baseline.
- Other suites were not rerun; only the Postman files, a new check script, `package.json` scripts and docs changed.

## November 4, 2026 — connected districts, grey future areas and gated bridges

*Visual target superseded by the woodland revision above. Its grey-paint browser assertions were replaced with full-colour, raised-bridge and gate assertions; the lock, access and non-mutation checks were kept.*

Implemented in the isolated `expansion/connected-realm` worktree, keeping the previous running household available during development. The owner's corrected visual direction is now a six-district 164×114 realm rather than one upgraded building on a small plot.

- **Integrity and units:** all 47 locked art/runtime files, the original 90-color palette and renderer wiring pass; all JavaScript parses. **104 unit tests passed, 1 skipped by design.** New checks cover separate shore footprints, district and bridge access from earned achievements, continuous travel over the existing 0/5/12/20 milestones, and retained guests in their own districts.
- **Browsers:** **43 cases passed across desktop and phone, 1 skipped by design.** The full run initially had 41 passing cases and two outdated assertions for the former board heading. After updating that expectation to the new realm heading, both full household journeys passed in the targeted rerun. No financial assertion was removed or relaxed.
- **Bridge behavior:** a simulated $15 contribution from $60 to $75 opens the manor and lowers its bridge; the village remains and both districts have their own guests. Other destinations stay locked. Locked districts have real grey-painted meshes and raised drawbridge halves. Selecting a destination changes only camera focus; it cannot unlock the destination or write to the server.
- **Previews and keepsakes:** an explicitly labeled castle art preview shows the connected earlier districts and open crossings, but returning restores the actual locks and two village guests. Existing refund/keepsake checks still pass. No preview changes progress, contributions or achievements.
- **Visual QA:** inspected all six shores in the overview, the locked citadel, manor and citadel art previews, and the phone overview/detail views. The world spans the page width. Mobile overview labels do not obscure the landscape; district buttons provide the names and conditions. No page errors or horizontal overflow occurred in the captures.
- **Scope:** all new transactions exercised in tests/demo are simulated against isolated example databases. No new PayPal order or paid AI call was needed. The woodland garden is the existing self-reported habit reward; confirmed-bill rewards still require an authorized provider that is not connected.

## November 4, 2026 — a living royal court

The owner clarified that larger homes should welcome more guests and princesses. Implemented in an isolated `expansion/living-court` worktree before promotion to the running app. The existing home thresholds, financial ledger, provider boundaries and original art/runtime files are preserved.

- **Full `npm test`: exit 0.** The 47 locked art/runtime files and original 90-color pipeline pass integrity checks; **100 unit tests passed, 1 skipped by design; 37 browser tests passed, 1 skipped by design** at desktop and phone sizes.
- **New court tests:** guest counts grow 2/6/12/20, with 0/1/2/3 original princesses; all existing guests remain when a new tier arrives. Every guest is sampled across 500 seconds of walking and pauses to check position continuity at stops, reversals and loop boundaries, and safe lanes outside the castle, moat, market and proposed water fountain.
- **Rendering:** shared batches contain the articulated native 3D cast (16/32/38/39 batches across the tiers). The existing ambient loop moves their boots, arms and heads. No second rendering loop is added. Reduced motion preserves the full cast in still poses.
- **Browser checks:** previews show the right guest/princess counts, actual guests change position, returning restores the earned cottage and two guests, and repeated previews do not accumulate instance batches. No preview writes to the server; contributions, achievements and progress stay identical. Both reduced-motion runs keep the royal cast still.
- **Visual QA:** inspected real renders of all four tiers, the castle close view and phone layout. A stale earned-home caption during previews was corrected; the final court/estate browser suite then passed **12/12**. The caption now states the preview's guest/princess counts and the household's actual earned home separately.
- **Scope:** the court is cosmetic. A kept home retains its guests after refunds. No new PayPal order or paid AI request is needed to exercise it, and no utility bill provider is claimed.

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
