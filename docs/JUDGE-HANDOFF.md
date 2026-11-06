# Run and review Our Castle

Review [current main](https://github.com/alejandro-publius/our-castle/tree/main) and state the commit you inspected. Nine woodland districts, a campsite that develops with the goal, one household journal, Merchant, Treasury, APIMatic context, the Studio Agent Framework and saved explicit receipt checks are implemented. [Family-planning integration](FAMILY-PLAN-REVIEW.md) adds read-only amount/date checks and protection against using stale plans. [Release status](RELEASE-READINESS.md) records actual runtime evidence and remaining recording/submission gaps. This is not a submitted entry.

## 1. Run it

Use Node.js **22.16 or later** (verified development environment: Node 26). The no-credentials game runs with simulated payments and a built-in rules planner. It is not a live PayPal/AI demonstration.

The repository is public; cloning needs no GitHub sign-in. Runtime keys and owner data are excluded. See [release readiness](RELEASE-READINESS.md#github-publication-result).

```sh
git clone https://github.com/alejandro-publius/our-castle.git
cd our-castle
npm ci
npm run demo
# Open the localhost URL printed in the terminal.
```

Use the same command from a POSIX shell or PowerShell; the launcher has no shell-specific environment syntax. It uses an OS-assigned localhost port and a fresh in-memory database, ignoring `.env`, inherited provider keys, `HOST`, `PORT` and data-directory settings. It leaves existing servers and households alone. Refresh retains progress; Ctrl+C ends the session. A new run starts fresh. Use ordinary `npm start` for the separately configured, persistent app.

For live integrations on another machine, use your own sandbox developer credentials and runtime API key following [the README](../README.md#real-paypal-sandbox-and-ai). Channel3 needs a server key; Studio's local trial is not bundled. Studio may show its evaluation notice without a suitable licence. No runtime secrets or owner databases are distributed.

## 2. A short review route

1. Name the house and choose a crest. The map starts close to Hearth Village; **Whole realm** shows all nine districts.
2. **Journal → Plan → Find an item**, or **Areas → Market Town → Merchant:** with Channel3 configured, search within a budget. **Use as goal** drafts the Plan; confirm **Save as our goal** explicitly. The no-key demo keeps search disconnected and uses its existing camping-trip goal; do not treat the disconnected state as fake product results.
3. **Journal → Plan:** try a weekly amount/date with **Check schedule**; a later-date suggestion only fills the form. Explicitly make, review and use a plan to save it. The AI planner is live only with a runtime key; otherwise the rules planner is labelled accordingly. **Visit campsite** reaches the developing family project, including on a phone.
4. **Contribute:** choose Rowan (adult), approve the exact amount and contribute. A $15 simulated contribution from the synthetic $60/$300 starting state opens the Manor at $75. It is labelled simulated.
5. Dismiss the short deed, inspect the Manor and confirm the village remains. **View deed** reopens an earned area's card.
6. **Ledger:** the Studio milestone points to the next area, AG Grid filters/search affect only the list, and a selected contribution opens its receipt. **Visit…** returns to the earned district. The existing steward stays closed until requested.
7. Refresh and select the receipt again. Goal, contribution records and earned areas persist while this demo session runs. Explore night/rain and inspect the palace, towers and sword; viewing a locked property does not earn it. Saved PayPal-check history belongs to the configured sandbox flow, not to simulated receipts.

Searching does not buy a product. Bills/gifts do not count toward savings. No verified utility provider is connected.

New unlock cards briefly welcome the household's selected pixel characters beside the crest. The parallel banner is suppressed for the same event; reopening a deed uses the original compact face. [Reference lock](UNLOCK-CELEBRATION.md). For observed usability sessions, use the [three-person playtest sheet](PLAYTEST.md); no participant results have been invented.

## 3. Evidence, without mixing modes

| Feature | Actual evidence | Limit |
| --- | --- | --- |
| Current in-app sandbox / steward | [Owner-completed $15 contribution and exact-order verification](IN-APP-SANDBOX-VERIFICATION.md): one credit to $75, village/Manor open, real `get_order`, deterministic `match` | Subsequent steward request used the local API; continuous popup/bridge/steward UI footage is unconfirmed |
| Saved explicit receipt checks | [Reviewed PR #5](VALIDATION.md#saved-receipt-checks--november-5-pst--november-6-utc-2026): persistence, scope, failure/mismatch/refund outcomes, schema upgrade and immediate failed-result display | Fake-provider unit/browser evidence; activation added an empty history table, without backfilling the earlier live result or making another provider lookup |
| PayPal Server SDK | [Historical sandbox run](LIVE-VERIFICATION.md): hosted buyer approval, $15 capture, single credit, replay/mismatch checks, matching order and refund | Not an in-app popup recording |
| AI planner/steward | [Historical live AI run](LIVE-VERIFICATION-AI.md): exact plan arithmetic, impossible target, ledger and transaction listing | No same-household-order `get_order` in that run |
| Channel3 Merchant | One real desktop search; local fake-provider phone/save/journey tests | No new credit or live phone/save retest |
| AG Grid / Studio | Actual installed widget, theme, harness/custom runner, cancellation, cleanup and fallback in browser checks | Provider responses in framework tests are fake; production licence not included |
| APIMatic | [Eight SDK-specific Codex skills](APIMATIC-CODEX.md), discovery/hash evidence and tested payment fixes | Developer context, not another runtime money service |
| World and family journey | Focused desktop/touch-phone Chromium and Linux WebKit checks | Browser emulation, not physical devices/macOS Safari |

[VALIDATION.md](VALIDATION.md) gives exact runs and versions. [AWARD-STRATEGY.md](AWARD-STRATEGY.md) maps the implementations to official sponsor briefs without guaranteeing a prize.

## 4. What remains, by who has to act

**Current Mac apps:** the owner household stays at **http://localhost:3010** and the isolated rehearsal at **http://localhost:3021**, both from `~/projects/our-castle-reviewed`. The original checkout stays clean at `791e8ae`; private keys and both existing databases remain. Reviewed PRs #1–#5 are active, including the additive schema-4 receipt history. Existing application rows and environment are preserved, including 3010's separate original $60 state. [Release readiness](RELEASE-READINESS.md#current-mac-app) and the private session metadata hold the latest process/source details; this review guide does not assign a new checkout operator.

**Completed manual checkout:** the owner was the sole browser operator and completed the approved $15 contribution. This worker inspected the saved capture/credit, fixed the provider's forced-tool incompatibility, and made one necessary same-order steward retry through the local API. It genuinely called `get_order`; the server returned `match`, selected-order `verified`, and no warnings. Do not create another payment or repeat paid suites.

The rehearsal now has **one completed order, one completed capture, two ledger entries ($60 reported plus one $15 sandbox credit), no plan and no payment waiter**. Progress is $75/$300; Hearth and Manor are open. Private `approved-sandbox-insert/session.json` and the linked verification report supersede earlier zero-order statuses.

**Remaining recording handoff:** locate/confirm any continuous owner recording. None is presently established. The actual bridge movement and steward UI have not been independently filmed; API proof does not supply that footage. The [insert plan](demos/current-review/INSERT.md) offers a 28-second completed-order receipt/state segment with separately labelled historical verification evidence. That plan has not been recorded or inserted. A new approval → unlock sequence would require a separately authorized sandbox checkout; the completed order cannot replay it. Keep all original sources intact. No final YouTube upload or Devpost submission is claimed.

**Submission:** current entry copy is [SUBMISSION-DRAFT.md](SUBMISSION-DRAFT.md). The current three-minute shot plan is [SUBMISSION-SHOTLIST.md](SUBMISSION-SHOTLIST.md). A public YouTube video is not uploaded, and no authenticated Devpost submission control is available here. Hosting is optional under the checked rules. The deadline is **November 12, 2026, noon PST**.

**Production follow-up, not a claim of current support:** real family sign-in, multi-device access, live webhooks, physical-device/screen-reader passes, suitable AG commercial terms and remaining dependency advisories. Utility rewards require genuine authorized provider evidence; there is no such connection.

## 5. Current review cut and preserved media

The existing [2:42 review cut](demos/current-review/our-castle-current-review-cut.mp4) is exported with narration, captions, an editable timeline and exact provenance. It predates the latest scenery, Plan shortcut and receipt history. Its explicit unfilmed checkout insert is at **1:08–1:36**; [kit and revised insert plan](demos/current-review/README.md). Recording/editing remains paused under the owner's instruction; this handoff refresh produces no media. The cut has not been uploaded to YouTube or submitted. Historical live sources are labelled separately from the recorded example game. Older kit instructions are historical; use the current insert plan before touching the already-occupied rehearsal port.

All older sources and captions remain unchanged:

| Material | Path and status |
| --- | --- |
| Woodland/family review, 2:51 | [MP4](demos/woodland-review/our-castle-family-woodland-review-draft.mp4), [editable kit](demos/woodland-review/README.md); historical UI, unfilmed sandbox insert at 2:17–2:41 |
| Earlier judge review, 2:36.36 | [Kit](demos/judge-review/README.md); older visuals, unfilmed insert at 2:00.36–2:24.36 |
| Gameplay, 17.60 s | [MP4](demos/gameplay/our-castle-gameplay-demo.mp4), [sources](demos/gameplay/README.md); example mode, older Rewards catalogue |
| Time/weather, 18.04 s | [MP4](demos/atmosphere/our-castle-time-weather-preview.mp4), [sources](demos/atmosphere/README.md); example UI, no live-weather/payment proof |
| Original world clip, 36.36 s | [MP4](demos/our-castle-connected-realm.mp4), [provenance](demos/README.md); historical six-island example-mode world, not the current forest |

All footage shows its recorded version. No missing checkout or tool outcome has been reconstructed.

## 6. For source reviewers

Identify the commit you actually inspected, read [release readiness](RELEASE-READINESS.md) and [validation](VALIDATION.md), then follow the relevant implementation. Report inaccessible files explicitly. These are source-review entry points, not claims that every execution path has live-provider proof.

| Review question | Implementation | Focused evidence |
| --- | --- | --- |
| Can progress credit or reverse twice? | [Contribution service](../server/payments/contributions.mjs), [SDK adapter](../server/payments/paypal-sdk-client.mjs) | [Payment cases](../test/unit/payments.test.mjs), [uncertain outcomes](../test/unit/paypal-unknown-outcome.test.mjs), [reconciliation](../test/unit/paypal-reconciliation.test.mjs) |
| Does a receipt remember an honest check without rechecking on load? | [Migration 4](../server/db.mjs), contribution service, [receipt/error rendering](../src/app/main.js) | [Saved-check unit cases](../test/unit/receipt-checks.test.mjs), [browser recheck cases](../test/e2e/payment-recheck.spec.mjs) |
| Can AI verify from prose or move money? | [Steward/reconciliation](../server/steward/index.mjs), [read-tool wrapper](../server/steward/paypal-tools.mjs), [planner validation](../server/planner/validate.mjs) | [Steward cases](../test/unit/steward.test.mjs), [injection cases](../test/unit/prompt-injection.test.mjs), separate [actual runtime result](IN-APP-SANDBOX-VERIFICATION.md) |
| Can a family try an affordable schedule without changing the plan in use? | [Plan check](../src/app/plan-check.js), [server facts](../server/planner/facts.mjs), [remaining calculation](../server/planner/remaining.mjs) | [Planning regressions](../test/unit/planning-revision.test.mjs), [actual Plan UI cases](../test/e2e/plan-check.spec.mjs), [review evidence](FAMILY-PLAN-REVIEW.md) |
| Does product search become a goal only after confirmation? | [Merchant dialog](../src/app/merchant.js), [Channel3 adapter](../server/merchant/channel3.mjs), [goal save](../server/merchant/goal-item.mjs) | [Merchant browser cases](../test/e2e/channel3-merchant.spec.mjs), [connected journey](../test/e2e/connected-journey.spec.mjs) |
| Is Studio doing meaningful work? | [Treasury widget](../src/app/treasury.js), [agent runner](../src/app/treasury-agent.js), [typed model](../server/treasury.mjs) | [Treasury implementation/evidence](TREASURY.md) |
| What did APIMatic contribute? | [Pinned context and provenance](APIMATIC-CODEX.md), SDK adapter | Documented context use and fake-provider recovery checks; not a runtime money service |
| What is still a limitation? | [Release status](RELEASE-READINESS.md), [dependency review](TOOLKIT-MAINTENANCE.md), [licences](../NOTICE.md) | Unfilmed insert, unpublished video/unsubmitted entry, human playtest notes pending, local-only personas, no utility provider, remaining dependency advisories |

Suggested independent review request:

> Review the current main branch of alejandro-publius/our-castle. State the commit and files you accessed. Read docs/JUDGE-HANDOFF.md, docs/RELEASE-READINESS.md and docs/VALIDATION.md first. Give at most five actionable findings, with file/line references, the trigger, expected versus actual behavior, severity and a concrete correction. Separate demonstrated defects, untested concerns and known limitations; distinguish example/fake-provider tests from actual sandbox/AI evidence. If you cannot access or run something, say so. Treat the missing video as a presentation gap; do not infer that the already-documented sandbox payment is unverified.
