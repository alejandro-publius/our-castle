# Validation

## November 4, 2026: game language for destination exploration

The owner rejected the playable world's “Previewing a reward” and art-disclaimer language. The game now uses **Explore** for future rewards, **Visit** for earned rewards, the actual district name (for example **Explore Royal Citadel**), a short **Locked / Open / Keepsake** condition and **Return to your realm**. The court describes its guests and princesses directly. The footer keeps the artwork credit without linking to the historical art-reference tool. Contribution limit errors no longer call the game a prototype.

Only presentation and existing test-language expectations changed. Internal inspection selectors/flags remain compatible. Reward ownership, bridges, server writes, financial logic and provider boundaries are unchanged; sandbox/simulated money and reported savings remain accurately labelled. The old standalone art-reference route and historical media remain preserved.

Checks: the asset/palette/renderer/syntax check passed. Ten existing targeted browser cases passed (desktop and phone Chromium emulation): exploring larger courts, no financial writes or achievements, exact locked condition, restoring actual locks, keyboard focus/accessible description and pointer return. The full suite and paid provider checks were not rerun. Ignored `test-results/game-language/protected-check.json` confirms the saved keys, owner database files and approved rehearsal database hashes/permissions/timestamps are unchanged. No server restart, order or paid AI call was made for this copy edit.

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
