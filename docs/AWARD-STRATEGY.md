# Awards and integration evidence

Rechecked November 6, 2026 against the official public [rules](https://paypalaihackathon.devpost.com/rules), [resources](https://paypalaihackathon.devpost.com/resources), overview and all three sponsor briefs below. All returned HTTP 200. Earlier direct-fetch 403s are historical. The repository is now public; no hosted site or Devpost entry has been published.

| Target | Actual evidence | Remaining gap |
| --- | --- | --- |
| PayPal + AI; creative consumer experience | Owner-completed in-app $15 sandbox capture, single credit from $60 to $75, Manor access and actual same-order Agent Toolkit get_order/server match; runtime planner and persistent family woodland | Continuous popup/unlock/steward footage remains unfilmed, with recording paused; see IN-APP-SANDBOX-VERIFICATION.md |
| Channel3 | Real search inside Market Town; one live desktop call, ten focused fake-transport browser cases plus four connected-journey cases; explicit goal confirmation and stale-draft recovery | Live phone/save not re-run; no automatic purchase or automatic price refresh |
| AG Grid / AG Studio | Community 36.2.0 records/receipts; Studio 3.0.0 custom next-area widget, parchment theme and Agent Framework behind the existing steward | Real harness/custom server runner tested with fake providers; no built-in-agent delegation or complete eligibility guarantee |
| APIMatic | Exact SDK context installed as eight enabled Codex repository skills; earlier capture-timeout fixes retain seven fake-provider cases | Repo-scoped context use is documented; global registration and prize qualification are not claimed |
| Render | Example-only Blueprint, automatic deployment off | No hosting or Workflows use; no award claim |
| Postman | Guarded example walkthrough and explicit sandbox opt-in, with duplicate-credit checks | Useful validation; no separate prize claimed |

## Sponsor briefs checked

- [Channel3](https://paypalaihackathon.devpost.com/details/channel3) requires meaningful API/MCP use rather than a reference alone. Our recorded call supplies direct usage evidence. The advertised 20,000-search hackathon promotion was not applied or tested.
- [AG Grid](https://paypalaihackathon.devpost.com/details/aggrid) emphasizes Studio custom widgets, theming/layout and the Studio Agent Framework. The Treasury now uses all three: a data-engine-backed milestone widget, the parchment theme and a custom server-backed steward runner in Studio's native harness. It does not claim to delegate to built-in Studio agents or swap the entire harness. The framework fixes stale answers and owns cancellation behind existing controls. The trial is evaluation-only; see [TREASURY.md](TREASURY.md) for the exact API use and limits.
- [APIMatic](https://paypalaihackathon.devpost.com/details/apimatic) describes using Context Plugins to build the PayPal integration. A generated dependency alone is not that proof. PayPal context needs no extra APIMatic login. The earlier review produced fixes; Codex now has the SDK-specific skills installed and discovery-verified. See [APIMATIC-CODEX.md](APIMATIC-CODEX.md).

Official entry requirements and judging still apply. The owner has requested finishing the release/submission work. Current runtime evidence and remaining video/submission work are tracked in [RELEASE-READINESS.md](RELEASE-READINESS.md). No eligibility guarantee or winner status is claimed.

The rules rechecked November 6 allow at most **one Grand Prize plus one Sponsor Prize**, or **one Honorable Mention plus one Sponsor Prize**. Entering all three relevant sponsor categories does not mean three sponsor awards can be combined. The strongest presentation targets are the creative consumer/family experience, PayPal + AI and a clear demonstration; do not describe the read-only steward as an autonomous purchasing agent.

## November 6 product recommendation — proposed, not implemented

The rules equally weight implementation, design, impact, innovation and presentation. Deadline remains November 12 at noon Pacific. The [public gallery](https://paypalaihackathon.devpost.com/project-gallery) currently says the managers have not published it; no competitor ranking can be inferred from that page.

The owner asked whether FarmVille could deepen the game. Zynga's current [co-op guide](https://zyngasupport.helpshift.com/hc/en/91-farmville-3/faq/16027-how-do-i-join-a-co-op/) describes helping other members; its [quest guide](https://zyngasupport.helpshift.com/hc/en/91-farmville-3/faq/16453-how-do-i-play-the-exotic-animal-quests/) connects staged tasks, construction, characters and new buildings. Borrow visible construction progress, a shared project and a choice of cosmetic rewards. Do not add paid speedups, spending streaks or punish a family for missing a payment.

**First proposed build:** give the existing family goal a small project in the world, with visible construction between its current milestones and a cosmetic choice at an earned milestone. A camping goal could build a campsite while the original realm persists. Reuse the Plan and deed surfaces; reward selections never change money, access rules or payment status. Next, let the existing planner propose a revised remaining schedule when the family changes what it can afford; the family reviews it before applying. These are future features, not claims about the current build.

The existing integration already supplies the foundation: Channel3 item → explicitly confirmed goal → validated AI plan → adult-approved JS SDK v6 checkout → Server SDK capture matched to the local contribution → world progress → Treasury receipt/read-only verification. New quests do not require another PayPal write API. Keep reported progress, simulated payments and confirmed sandbox captures distinct. Rachel's assigned Treasury status/receipt work remains separate; no new open PR was visible during this pass.

**Current PayPal limits that inform this choice:** the [agent tools reference](https://developer.paypal.com/ai-tools/agent-tools/) is dated October 29, 2026 and states that its extra MCP commerce search/cart/checkout tools are **gift-card-only**. They do not turn an arbitrary Channel3 listing into an integrated retailer checkout. The [JS SDK v6 setup](https://developer.paypal.com/sdk/js/set-up), dated October 13, lists Venmo (US), Apple Pay and other methods; optional eligible methods are a later convenience, not a prerequisite for the project loop. [Subscriptions](https://developer.paypal.com/api/subscriptions/v1) and [invoices](https://developer.paypal.com/api/invoicing/v2) are billing flows; this app has no utility-provider connection or SDG&E verification.

The [current PayPal AI Toolkit README](https://github.com/paypal/AI-Toolkit) documents a coding plugin, diagnostic commands and a sandbox MCP connection. This is distinct from the installed runtime Agent Toolkit and the APIMatic context skills. No plugin was installed or authorized to move money during this research. Webinar recommendations are based on the published topics and the supplied notes already reviewed in [WEBINAR-ROI.md](WEBINAR-ROI.md), not a claim to have rewatched all recordings.

Ignored source snapshots, links, retrieval timestamps and hashes are in `test-results/devpost-research-20261106/`. The old Devpost-linked `docs.paypal.ai/developer/tools/ai/agent-tools-ref` returned 404; the current developer.paypal.com reference above returned 200. No app code, household record, paid provider call, payment or video changed in this research pass.

## Handoff

[CONNECTED-HANDOFF.md](CONNECTED-HANDOFF.md) records the exact flow, settings, live-versus-fake checks and current blockers. Original art, palette and renderer are preserved. No new PayPal order, refund or paid AI test was made for this work.

The older clean-install audit reported 12 advisory entries in the toolkit graph. That is not an exploit finding; assess compatible upstream fixes before deployment without force-downgrading the pinned toolkit. Historical audit files remain ignored at `test-results/main-sync/`.

The Render Blueprint uses blank provider keys, disposable example data and no automatic deployment. Do not upload the owner's `.env`, household or rehearsal data.
