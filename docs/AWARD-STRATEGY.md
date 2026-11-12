# Awards and integration evidence

Rechecked November 6, 2026 against the official public [rules](https://paypalaihackathon.devpost.com/rules), [resources](https://paypalaihackathon.devpost.com/resources), overview and all three sponsor briefs below. All returned HTTP 200. Earlier direct-fetch 403s are historical. The repository is now public; no hosted site or Devpost entry has been published.

Implementation inventory refreshed November 9 against the integrated family-planning release and its playable example. The underlying product source through `b21b2d8` is on main; [release readiness](RELEASE-READINESS.md) identifies subsequent integration. This is a source/evidence update, not a new rules check, provider run or recording.

| Target | Actual evidence | Remaining gap |
| --- | --- | --- |
| PayPal + AI; creative consumer experience | Owner-completed in-app $15 sandbox capture, single credit from $60 to $75, Manor access and actual same-order Agent Toolkit get_order/server match; runtime planner and persistent family woodland | Continuous popup/unlock/steward footage remains unfilmed, with recording paused; see IN-APP-SANDBOX-VERIFICATION.md |
| Channel3 | One real desktop search inside Market Town; explicit goal confirmation, manual offer refresh, cheaper alternatives, changed-offer expiry and selected-variant stock checks. [Implementation and separate fake-provider evidence](CHANNEL3-MERCHANT.md) | Refresh/alternatives/variant recovery use fake-provider checks; live phone/save not re-run. No automatic purchase or automatic price refresh |
| AG Grid / AG Studio | Community 36.3.0 records/receipts; Studio 3.1.0 illustrated next-area/weekly widget, live data and Agent Framework behind the existing steward | Real harness/custom server runner tested with fake providers; no built-in-agent delegation or complete eligibility guarantee |
| APIMatic | Eight enabled SDK-specific Codex skills; documented capture recovery and actual SDK 2.5.0 OAuth, serialization, request-ID, timeout-configuration and response/error contracts tested with fake transport. [Provenance and findings](APIMATIC-CODEX.md) | Context use and transport fixtures are evidence, not fresh live-provider verification or a prize guarantee. Existing safeguards are distinguished from new fixes |
| Family decision engine | Adult offers/preferences, expense-aware schedules, complete kits, owned-item exclusion and smallest-change repair with kept choices; compiled Rust/reference agreement on 403 cases | Invented example and fake-catalogue checks demonstrate behavior, not measured family benefit or uniqueness |
| Optional kit AI | OpenAI photo-to-editable-list adapter with one successful live synthetic-image check; Cohere eligible-kit ordering implemented with public-description-only requests | No real-photo accuracy benchmark; Cohere remains off and ranking quality is unmeasured; these are not extra sponsor-prize claims |
| Render | Example-only Blueprint, automatic deployment off | No hosting or Workflows use; no award claim |
| Postman | Guarded example walkthrough and explicit sandbox opt-in, with duplicate-credit checks | Useful validation; no separate prize claimed |

## Sponsor briefs checked

- [Channel3](https://paypalaihackathon.devpost.com/details/channel3) requires meaningful API/MCP use rather than a reference alone. Our recorded call supplies direct usage evidence. The advertised 20,000-search hackathon promotion was not applied or tested.
- [AG Grid](https://paypalaihackathon.devpost.com/details/aggrid) emphasizes Studio custom widgets, theming/layout and the Studio Agent Framework. The Treasury now uses all three: a data-engine-backed milestone widget, the parchment theme and a custom server-backed steward runner in Studio's native harness. It does not claim to delegate to built-in Studio agents or swap the entire harness. The framework fixes stale answers and owns cancellation behind existing controls. The trial is evaluation-only; see [TREASURY.md](TREASURY.md) for the exact API use and limits.
- [APIMatic](https://paypalaihackathon.devpost.com/details/apimatic) describes using Context Plugins to build the PayPal integration. A generated dependency alone is not that proof. PayPal context needs no extra APIMatic login. The earlier review produced fixes; Codex now has the SDK-specific skills installed and discovery-verified. See [APIMATIC-CODEX.md](APIMATIC-CODEX.md).

Official entry requirements and judging still apply. The owner has requested finishing the release/submission work. Current runtime evidence and remaining video/submission work are tracked in [RELEASE-READINESS.md](RELEASE-READINESS.md). No eligibility guarantee or winner status is claimed.

The rules rechecked November 6 allow at most **one Grand Prize plus one Sponsor Prize**, or **one Honorable Mention plus one Sponsor Prize**. Entering all three relevant sponsor categories does not mean three sponsor awards can be combined. The strongest presentation targets are the creative consumer/family experience, PayPal + AI and a clear demonstration; do not describe the read-only steward as an autonomous purchasing agent.

## Earlier implementation status — November 7

The campsite and read-only schedule recommendations shipped through PRs #8–#10. Main now also includes a per-goal **Build** choice of campsite, garden or schoolhouse, and opt-in shared families with passkeys, invitations, adult/child permissions and live updates. See [family projects](FAMILY-PROJECT.md#what-the-family-builds), [family access](FAMILY-ACCESS.md) and the [integrated release](RELEASE-READINESS.md). These are implemented; a separate cosmetic reward selector at each milestone remains unbuilt. Shared-family checks use local virtual authenticators and simulated payments, with human playtest and physical-device evidence still pending.

[Previous-winner research](WINNER-RESEARCH.md) compares eight distinct winners and records the resulting checkout loading/recovery improvements and 22 targeted browser checks. The earlier product rationale below does not assign another feature build.

The rules equally weight implementation, design, impact, innovation and presentation. Deadline remains November 12 at noon Pacific. The November 6 [public gallery](https://paypalaihackathon.devpost.com/project-gallery) check found that managers had not published it; that dated observation supplies no current competitor ranking.

The owner asked whether FarmVille could deepen the game. Zynga's current [co-op guide](https://zyngasupport.helpshift.com/hc/en/91-farmville-3/faq/16027-how-do-i-join-a-co-op/) describes helping other members; its [quest guide](https://zyngasupport.helpshift.com/hc/en/91-farmville-3/faq/16453-how-do-i-play-the-exotic-animal-quests/) connects staged tasks, construction, characters and new buildings. Borrow visible construction progress, a shared project and a choice of cosmetic rewards. Do not add paid speedups, spending streaks or punish a family for missing a payment.

**Earlier proposed build, now shipped in these parts:** the family chooses a campsite, garden or schoolhouse in Plan, and the illustrated project develops with current goal progress while earned districts persist. The family can check a revised remaining schedule without saving and review a fresh proposal before applying it. The Build choice changes the illustration; it does not certify real construction or move money. A separate cosmetic choice awarded at a milestone remains a future feature.

The existing integration supplies the foundation: Channel3 item → explicitly confirmed goal → validated AI plan → adult-approved JS SDK v6 checkout → Server SDK capture matched to the local contribution → world progress → Treasury receipt/read-only verification. The integrated family/sponsor work is in main through PRs #20/#27/#28. Keep reported progress, simulated payments and confirmed sandbox captures distinct. Rachel's observed [three-person playtest](PLAYTEST.md) remains pending; automated coverage does not substitute for those observations.

## Product outcome to demonstrate

Lead with the family's decision: **“An expense changed. Can we keep our trip and the gear we already agreed on?”** The [family-trip example](FAMILY-TRIP-EXAMPLE.md) makes that decision playable without a provider account: compare the computed $150/$180 kits, choose the lighter one, keep the stove, then change the one-off from $90 to $120. The engine offers a $150 repair that changes only the tent. Its people, listings and prices are labelled invented; it is not a live Channel3 search or Cohere recommendation.

| Criterion | Concrete contribution | Evidence limit |
| --- | --- | --- |
| Technological Implementation | Exact bounded Rust search, independent reference, scoped typed requests, atomic goal/schedule adoption and controlled payment-recovery tests | No speed, production-scale or security-certification claim |
| Design | One playable example in the existing map/journal, contextual links, editable drafts and an exact-receipt handoff | Browser checks and emulated phone; human comprehension remains to be observed |
| Potential Impact | Whole-kit costs, personal offers and minimum-change repair address a family's changing constraints | A product hypothesis supported by public pain-point research, not demonstrated adoption or savings |
| Innovation | Family coordination and repair connected to a growing shared place | Shared saving and photo extraction already exist elsewhere; no claim of market exclusivity |
| Presentation | A clone-and-run example and screenshots let a reviewer try the decision engine | Current video still predates this flow; recording and submission remain pending |

Kubernetes, a Java rewrite, Kafka/JunoDB, another HF provider and UCP/WebMCP checkout were researched options, not missing implementation requirements. They do not resolve the demonstrated first-use gap. The existing Node/SQL boundaries, real Rust solver and optional AI adapters implement the selected useful lessons.

## Show the implemented evidence

- **Treasury:** select the contribution. Its source line and receipt already show the saved-check status, with a time when a check exists. The configured **House steward** says “Cannot make payments”; the no-key demo instead labels its local-only mode “Saved confirmations.” **Last confirmation** reads local saved history without a provider/model call. Missing history must stay missing: the earlier real verification was not backfilled into the later check table. [Existing UI and limits](TREASURY.md).
- **Shared family:** use the separate simulated family runner and two browser profiles to show an invitation and a saved change arriving on the other page. [Short review route](JUDGE-HANDOFF.md#optional-shared-family-route). This demonstrates collaboration separately from the preserved real sandbox contribution.
- **Presentation:** the existing cut predates these additions; recording is paused. A completed order cannot replay its original approval/unlock sequence. [Current evidence and recording limits](IN-APP-SANDBOX-VERIFICATION.md). This review route uses the existing controls and preserved evidence.

**Current PayPal limits that inform this choice:** the [agent tools reference](https://developer.paypal.com/ai-tools/agent-tools/) is dated October 29, 2026 and states that its extra MCP commerce search/cart/checkout tools are **gift-card-only**. They do not turn an arbitrary Channel3 listing into an integrated retailer checkout. The [JS SDK v6 setup](https://developer.paypal.com/sdk/js/set-up), dated October 13, lists Venmo (US), Apple Pay and other methods; optional eligible methods are a later convenience, not a prerequisite for the project loop. [Subscriptions](https://developer.paypal.com/api/subscriptions/v1) and [invoices](https://developer.paypal.com/api/invoicing/v2) are billing flows; this app has no utility-provider connection or SDG&E verification.

The [current PayPal AI Toolkit README](https://github.com/paypal/AI-Toolkit) documents a coding plugin, diagnostic commands and a sandbox MCP connection. This is distinct from the installed runtime Agent Toolkit and the APIMatic context skills. No plugin was installed or authorized to move money during this research. Webinar recommendations are based on the published topics and the supplied notes already reviewed in [WEBINAR-ROI.md](WEBINAR-ROI.md), not a claim to have rewatched all recordings.

Ignored source snapshots, links, retrieval timestamps and hashes are in `test-results/devpost-research-20261106/`. The old Devpost-linked `docs.paypal.ai/developer/tools/ai/agent-tools-ref` returned 404; the current developer.paypal.com reference above returned 200. No app code, household record, paid provider call, payment or video changed in this research pass.

## Handoff

[CONNECTED-HANDOFF.md](CONNECTED-HANDOFF.md) records the exact flow, settings, live-versus-fake checks and current blockers. Original art, palette and renderer are preserved. No new PayPal order, refund or paid AI test was made for this work.

The older clean-install audit reported 12 advisory entries in the toolkit graph. That is not an exploit finding; assess compatible upstream fixes before deployment without force-downgrading the pinned toolkit. Historical audit files remain ignored at `test-results/main-sync/`.

The Render Blueprint starts the keyless family-trip demo under the service's own public name (`--public-host`), names no provider key, uses disposable invented data and has automatic deployment off. It has not been deployed. Do not upload the owner's `.env`, household or rehearsal data.