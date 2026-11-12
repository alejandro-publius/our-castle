# Run and review Our Castle

Our Castle turns family goals and a neighborhood's shared fund into woodland projects. The focused class-trip example follows an adult-approved contribution across five families, a shared world change and its receipt. The deeper family-trip route shows how to keep a goal affordable when an expense changes.

Start with the runnable example below. The [four-step route](#2-a-short-review-route) follows one family decision; [source and integration evidence](#6-for-source-reviewers) comes later. The [illustrated journal and original castle identity](JOURNAL-DESIGN.md) are in the current source. Review [main](https://github.com/alejandro-publius/our-castle/tree/main) and state the commit you inspected.

## 1. Run it

Use **Node.js 22.16 or later**. No provider account or Rust installation is needed for this example; without a compiled solver, it uses the checked JavaScript reference.

```sh
git clone https://github.com/alejandro-publius/our-castle.git
cd our-castle
npm ci
npm run demo -- --village-fund
# Open the localhost URL printed in the terminal.
```

The five families and starting $200 are invented; contributions are simulated. This opening runs the shared-fund service and keeps private family savings separate. It makes no PayPal, AI or blockchain request. [The focused route and current limits](VILLAGE-DEMO.md) distinguish implemented adapters from actual account acceptance. [Historical live evidence](#3-evidence-without-mixing-modes) is identified separately. For the complete-kit decision instead, run **`npm run demo -- --family-trip`**.

<details>
<summary>Other run modes and optional live integrations</summary>

For the plain fresh household without the authored trip or sample catalogue, use `npm run demo`. Its live integrations remain off without their keys. The [family-trip guide](FAMILY-TRIP-EXAMPLE.md) records the scenario, real checks and screenshots. A checkout without a compiled Rust binary uses the independent JavaScript reference; [native build instructions](KIT-PLANNER.md) describe the optional Rust path.

Use the same command from a POSIX shell or PowerShell; the launcher has no shell-specific environment syntax. It uses an OS-assigned localhost port and a fresh in-memory database, ignoring `.env`, inherited provider keys, `HOST`, `PORT` and data-directory settings. It leaves existing servers and households alone. Refresh retains progress; Ctrl+C ends the session. A new run starts fresh. Use ordinary `npm start` for the separately configured, persistent app.

For live integrations on another machine, use your own sandbox developer credentials and runtime API key following [the README](../README.md#real-paypal-sandbox-and-ai). Channel3 needs a server key; Studio's local trial is not bundled. Reading a kit-list photo and ordering complete kits use their own optional keys, `KIT_OPENAI_API_KEY` and `KIT_COHERE_API_KEY` ([settings](RUNBOOK.md#merchant-and-treasury-settings)). Studio may show its evaluation notice without a suitable licence. No runtime secrets or owner databases are distributed.

</details>

## 2. A short review route

### A focused village opening

Use **`npm run demo -- --village-fund`**. Review **Class trip together**, starting at **$200/$400**, then approve **$40** and choose **Add simulated contribution**. The shared project advances to its next stage and Records shows the contribution. **Visit the shared square** shows the schoolhouse and family appearances; **My realm** restores private progress, which remains $60. Refresh retains the single contribution. [Full route](VILLAGE-DEMO.md).

The earlier **`--village-story`** runner remains a separate single-household library example at $150/$300. [Historical route](VILLAGE-STORY.md).

### Start with the family decision

In the family-trip example, **Plan** opens with a family and packing list already entered. Rowan offers $20 a week and Ash $10; the two torches already at home need no purchase. Starting progress is a reported $60, not a bank balance. The deadline is seven weeks after this demo starts.

| Step | Do this | Look for |
| --- | --- | --- |
| **1. Compare** | **Try a one-off expense** → enter **90** → **See which complete kits fit** → **Compare complete kits** | Two computed choices: **$150** lower total and **$180** lower listed weight. |
| **2. Adapt** | Choose the **$180** kit → **Keep stove as it is** → **Preview on map** → change the one-off to **120** | A temporary **$150 Proposal · smallest change** switches only the tent. The stove stays; the saved choice is still $180. |
| **3. Agree** | Choose the $150 repair → **Review this kit** → inspect the draft → **Save goal and propose this schedule** → **Use this plan** | The goal and schedule change only through those explicit confirmations. Nothing has been paid. |
| **4. Contribute and review** | In **Contribute**, enter **15**, tick the exact-amount approval and choose **Simulate approved payment**. Finish the deed's Visit/Close action, then **Review the receipt**. | Earned progress, followed by that exact contribution selected in Treasury. It says simulated and shows no invented PayPal Match. |

The receipt route is deliberately one explicit click after the world response; it does not automatically cover an unlock or perform a provider lookup. Which district opens depends on the saved goal. A $15 contribution toward the repaired $150 goal is a different scenario from the historical $15/$300 Manor evidence.

Optional stress case: before choosing the repair, enter **200**. The chosen $180 kit is $110 short; the separate closest $150 kit is $80 short. Neither fits the $70 limit. Return to **120** to continue. [Full steps, arithmetic and screenshots](FAMILY-TRIP-EXAMPLE.md).

The map preview has separate [desktop/phone captures and focused checks](KIT-MAP-PREVIEW.md). [Selected product scope](PRODUCT-COMPLETION.md) distinguishes completed features from presentation and live-evidence limits.

The same planner and approval boundaries drive the configured app. Sample products exercise their local path; they do not establish live Channel3 prices, stock or purchasing. Switching example profiles is not passkey sign-in; use the separate family route below to inspect that implementation.

### Optional neighbor-help moment

Run `npm run demo -- --village-exchange` in a separate fresh session. In **Plan → Village Exchange**, Alder needs a tent and Willow has offered one. **Accept offer** leaves the kit need unchanged. **I received the item** makes the tent available; **Compare what is left to buy** and then **Compare complete kits** reduce the lowest listed total from **$150 to $70**, with recorded progress unchanged at $60. **I returned the item** restores the need. These two families and the catalogue are invented; the same service and visible controls are tested with two separate passkey households. [Complete flow and privacy boundaries](VILLAGE-EXCHANGE.md).

### Explore the plain household or configured integrations

1. Name the house and choose a crest. The map starts close to Hearth Village; the **compass beside View** lets you drag between places at that scale. **Whole realm** shows all nine districts. Property markers use compact arrows; selecting one or reaching it by keyboard reveals its name. The wider forest has two waterfalls and a hidden knight camp, discoverable with the compass. Optionally, **Meet the Keeper** at the top of Journal → House starts Moss's eight-step tour.
2. **Journal → Plan → Find an item**, or **Areas → Market Town → Merchant:** with Channel3 configured, search within a budget. **Use as goal** drafts the Plan; confirm **Save as our goal** explicitly. Manual refresh and cheaper alternatives keep changed offers subject to review; selected stock/variant checks can expire an old draft. The plain `npm run demo` keeps search disconnected; the opt-in family-trip command above supplies explicitly invented results instead.
3. **Journal → Plan:** save a campsite, garden or schoolhouse **Build** choice with the goal, then try a weekly amount/date with **Check schedule**; a later-date suggestion only fills the form. Explicitly make, review and use a plan to save it. The AI planner is live only with a runtime key; otherwise the rules planner is labelled accordingly. The project's **Visit** control reaches the chosen place, including on a phone.
4. **Journal → Plan → Kit list and Family choices** need no key.
   - In Kit list, type `1 x 4-person tent; 2 x sleeping bag; 2 x torch`, choose **Check this list**, enter what is already at home under Have, then **Save this list**.
   - In Family choices, Rowan can offer a weekly amount and try a one-off expense against the current goal.
   - Reading a photo needs the server's own OpenAI key. Real product listings need Channel3. The opt-in family-trip example supplies a local invented catalogue to the same Market Town and complete-kit flow; the plain demo keeps Market Town disconnected.
   - The README's kit screenshots use a fake catalog and an invented family, not a live catalog.
5. **Contribute:** choose Rowan (adult), approve the exact amount and contribute. A $15 simulated contribution from the synthetic $60/$300 starting state opens the Manor at $75. It is labelled simulated.
6. Dismiss the short deed, inspect the Manor and confirm the village remains. **View deed** reopens an earned area's card.
7. **Ledger:** the illustrated Studio 3.1 milestone points to the next area and its weekly comparison uses the accepted plan and contribution/refund records. AG Grid filters/search affect only the list; select a contribution to see its receipt and saved-check status/time when present. A record with no saved check says so. **Visit…** returns to the earned district. One note beside the selected record identifies the steward's mode: the configured steward says “Cannot make payments,” while the no-key demo says “Saved confirmations.” **House steward** opens the questions; **Last confirmation** reads saved local history without a model or PayPal call. Opening the Ledger or a receipt never makes a fresh provider check.
8. Refresh and select the receipt again. Goal, contribution records and earned areas persist while this demo session runs. Explore night/rain and inspect the palace, towers and sword; viewing a locked property does not earn it. Saved PayPal-check history belongs to the configured sandbox flow, not to simulated receipts.

**After an in-app contribution:** finish the deed's Visit/Close action, then **Review the receipt** opens Treasury at that contribution and its existing saved-check status. The steward's one note sits beside the record; its questions stay closed until requested. A final contribution follows this receipt route before **Visit your castle**. [Handoff and focused evidence](RECEIPT-HANDOFF.md).

Searching does not buy a product. Bills/gifts do not count toward savings. No verified utility provider is connected.

New unlock cards briefly welcome the household's selected pixel characters beside the crest. The parallel banner is suppressed for the same event; reopening a deed uses the original compact face. [Reference lock](UNLOCK-CELEBRATION.md). For observed usability sessions, use the [three-person playtest sheet](PLAYTEST.md); no participant results have been invented.

### Optional shared-family route

Run `npm run family -- --port 3200` separately, then open **http://localhost:3200** on this computer. It uses its own persistent database, simulated payments and the rules planner; it reads no provider keys. It leaves the existing owner/rehearsal apps alone.

1. **Start a new family** and create a passkey. Set the house and goal in House/Plan.
2. In **House → Invite to the family**, invite another adult. Open that one-time link in a **separate browser profile or browser**, then join with that member's own passkey. Two tabs in one profile share the sign-in cookie and do not represent two members.
3. Save a goal or Build change on one page and observe the other update without reloading. An optional adult-approved **simulated** contribution shows the same progress, receipt and earned-area event on both pages. This is separate from the preserved $15 sandbox evidence.

Passkey setup needs a compatible browser/device. Existing multi-context tests use virtual authenticators; they do not establish a human playtest or physical-phone result. [Permissions, recovery and exact checks](FAMILY-ACCESS.md).

## 3. Evidence, without mixing modes

| Feature | Actual evidence | Limit |
| --- | --- | --- |
| Current in-app sandbox / steward | [Owner-completed $15 contribution and exact-order verification](IN-APP-SANDBOX-VERIFICATION.md): one credit to $75, village/Manor open, real `get_order`, deterministic `match` | Subsequent steward request used the local API; continuous popup/bridge/steward UI footage is unconfirmed |
| Saved explicit receipt checks | [Reviewed PR #5](VALIDATION.md#saved-receipt-checks--november-5-pst--november-6-utc-2026): persistence, scope, failure/mismatch/refund outcomes, schema upgrade and immediate failed-result display | Fake-provider unit/browser evidence; activation added an empty history table, without backfilling the earlier live result or making another provider lookup |
| PayPal Server SDK | [Historical sandbox run](LIVE-VERIFICATION.md): hosted buyer approval, $15 capture, single credit, replay/mismatch checks, matching order and refund | Not an in-app popup recording |
| AI planner/steward | [Historical live AI run](LIVE-VERIFICATION-AI.md): exact plan arithmetic, impossible target, ledger and transaction listing | No same-household-order `get_order` in that run |
| Channel3 Merchant | One real desktop search; fake-provider search/save/journey, manual freshness, cheaper alternatives and selected-variant recovery checks | Refresh/alternatives/variant endpoints have not been rechecked live; no live phone/save retest |
| AG Grid / Studio | Studio 3.1 illustrated next-area/weekly widget, live data preserving the report, Grid 36.3 records, theme and Agent Framework custom runner; cancellation/cleanup/fallback checks | Provider responses in framework tests are fake; production licence not included |
| APIMatic | [Eight SDK-specific Codex skills](APIMATIC-CODEX.md), discovery/hash evidence, documented payment fixes and real generated-SDK wire contracts using fake transport | Developer context and fixture-backed contracts, not another runtime money service or new live-provider proof |
| Shared-family access | [Passkeys, invitations, adult/child permissions and live updates](FAMILY-ACCESS.md); separate authenticated browser contexts and fake-provider boundary/recovery checks | Local WebAuthn with virtual authenticators; no hosted service, physical-device or observed human-playtest claim |
| World and family journey | Focused desktop/touch-phone Chromium and Linux WebKit checks | Browser emulation, not physical devices/macOS Safari |
| Family choices, schedules and family fit | [Offers, preferences, one-off trials, saved schedules and fit searches](FAMILY-CHOICES.md); fake-provider unit and browser checks | Invented catalog and fake transports; these flows were not retested against live Channel3 |
| Kit list and complete kits | [Typed lists, fake-OpenAI draft journeys and one successful live synthetic-image adapter check](KIT-LIST.md); [the compiled Rust solver equal to the reference on 403 cases, and fake-catalog/fake-Cohere journeys](KIT-PLANNER.md) | One invented photo is not a quality benchmark or browser upload proof; no live Channel3 or Cohere check for these features, and ranking quality is unmeasured |
| Recovery and payment safety | [Restart recovery, two servers on one database, refund ordering and snapshots](RELEASE-READINESS.md): real app processes on disposable databases with fake providers | Not a production or disaster-recovery guarantee |

[VALIDATION.md](VALIDATION.md) gives exact runs and versions. [AWARD-STRATEGY.md](AWARD-STRATEGY.md) maps the implementations to official sponsor briefs without guaranteeing a prize.

## 4. What remains, by who has to act

**Current Mac apps:** **http://localhost:3010** (PID 83876) and the isolated rehearsal **http://localhost:3021** (PID 83914) run reviewed source `a56170a` from `~/projects/our-castle-runtime-release-20261110`, schema 18, since the owner-requested upgrade on November 10. Private-copy rehearsals, a rehearsed rollback and stopped-app backups preceded it. Every original row is unchanged and the seventeen new tables are empty. Progress remains $60/$300 and $75/$300, and the existing completed $15 capture/credit is preserved. Prior payment, planner, Merchant and access modes remain; the compiled Rust solver and OpenAI photo configuration are active, and Cohere ordering is now selected. Later merges to `main` (the hold extension and stepped releases, meadow scenery and Snow) are not in these apps. Shared-family mode remains opt-in. [Release readiness](RELEASE-READINESS.md#current-mac-app) records the exact local upgrade, operator correction and limits. Refresh an idle page to load these assets; no further payment or provider check is needed.

**Completed manual checkout:** the owner was the sole browser operator and completed the approved $15 contribution. This worker inspected the saved capture/credit, fixed the provider's forced-tool incompatibility, and made one necessary same-order steward retry through the local API. It genuinely called `get_order`; the server returned `match`, selected-order `verified`, and no warnings. Do not create another payment or repeat paid suites.

The rehearsal now has **one completed order, one completed capture, two ledger entries ($60 reported plus one $15 sandbox credit), no plan and no payment waiter**. Progress is $75/$300; Hearth and Manor are open. Private `approved-sandbox-insert/session.json` and the linked verification report supersede earlier zero-order statuses.

**Remaining recording handoff:** locate/confirm any continuous owner recording. None is presently established. The actual bridge movement and steward UI have not been independently filmed; API proof does not supply that footage. The [insert plan](demos/current-review/INSERT.md) offers a 28-second completed-order receipt/state segment with separately labelled historical verification evidence. That plan has not been recorded or inserted. A new approval → unlock sequence would require a separately authorized sandbox checkout; the completed order cannot replay it. Keep all original sources intact. No final YouTube upload or Devpost submission is claimed.

**Submission:** current entry copy is [SUBMISSION-DRAFT.md](SUBMISSION-DRAFT.md). The current three-minute shot plan is [SUBMISSION-SHOTLIST.md](SUBMISSION-SHOTLIST.md). A public YouTube video is not uploaded, and no authenticated Devpost submission control is available here. Hosting is optional under the checked rules. The deadline is **November 12, 2026, noon PST**.

**Production follow-up:** hosted multi-family operation, public webhook delivery, physical passkey/device and screen-reader passes, suitable AG commercial terms and remaining dependency advisories. Local passkey households and cross-page updates are implemented and tested with virtual authenticators; they are not a claim of hosted production validation. Utility rewards require genuine authorized provider evidence; there is no such connection.

## 5. Historical review cut and preserved media

The preserved [2:42 review cut](demos/current-review/our-castle-current-review-cut.mp4) is exported with narration, captions, an editable timeline and exact provenance. It predates the complete-kit planning flow, map preview and redesigned journal. Its explicit unfilmed checkout insert is at **1:08–1:36**; [kit and revised insert plan](demos/current-review/README.md). Recording/editing remains paused under the owner's instruction; this handoff refresh produces no media. The cut has not been uploaded to YouTube or submitted. Historical live sources are labelled separately from the recorded example game. Older kit instructions are historical; use the current insert plan before touching the already-occupied rehearsal port.

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

### Money rules, and the tests that hold them

Money is held first and counts only when an adult releases it. Each rule below names where the server keeps it and a test that fails if it is broken. The tests run against a fake PayPal: they are evidence about this server's rules, not about the PayPal sandbox. The full list of twelve is in [PAYMENT-HOLDS.md](PAYMENT-HOLDS.md#rules-the-server-keeps).

| Rule | Where it is kept | A test that fails without it |
| --- | --- | --- |
| A hold is not progress. | `applyAuthorization` in `server/payments/contributions.mjs` records a hold and never credits one. | "a held contribution asks PayPal to authorize, places the hold and credits nothing" |
| Every decision is written down before PayPal is asked. | `holdDecision` saves a row in `payment_hold_steps` (who, what, how much, which request) in one transaction, then the provider is called. Only one decision at a time can wait. | "an unanswered release is never guessed: it stays recheckable, and PayPal's own record settles it once" |
| Only a capture that matches that decision counts, and it counts once. | `applyCapture` compares amount, currency and reference; `credit` is one transaction per capture ID. | "a capture that does not match the adult's release, or that no adult released, is never credited" |
| A release can never take more than is still held. | Checked in `holdDecision`, and again by a `CHECK` constraint in the database. | "the database itself refuses a release larger than what is still held, and a released total larger than the hold" |
| An unknown outcome is never guessed. | A timeout, a server error or a success answer the SDK cannot read leaves the decision waiting; **Check with PayPal** settles it from PayPal's own order. | "a successful answer the SDK cannot read is an unknown outcome, never a refusal: PayPal has already acted" |
| A retry can never capture twice. | The same decision reaches PayPal with the same `PayPal-Request-Id`. | "a release decided again after an unanswered attempt is the same PayPal request, so it can never capture twice" |
| Only an adult of that household decides. | `holdDecision` and the route table in `server/access/policy.mjs`. | "only an adult of the owning household decides, for a valid amount, after explicit confirmation" |
| No AI is in the payment path. | Nothing under `server/payments/` loads a model library. An AI-proposed schedule is stored only if `validateAiPlan` in `server/planner/validate.mjs` finds it equal to the server's own arithmetic. | "an AI plan that claims an impossible goal is reachable is rejected" |
| The ledger equals what PayPal took, in orders nobody wrote down. | All of the above together. | The 200 [seeded random hold histories](PAYMENT-HOLDS.md#random-histories) |

The tests are in `test/unit/payment-holds.test.mjs`, `paypal-sdk-transport.test.mjs`, `planner.test.mjs` and `payment-holds-random.test.mjs`.

**Try breaking one.** In `server/payments/contributions.mjs`, change `const released = hold.released_cents + amountCents;` to `const released = amountCents;`, so a later release forgets the earlier ones. Then run:

```sh
node --test test/unit/payment-holds-random.test.mjs
```

It fails with "the released total is the counted captures", and prints the seed and every step of the history that exposed it.

### Built features and release evidence

Review [current main](https://github.com/alejandro-publius/our-castle/tree/main) and state the commit you inspected. Nine woodland districts, a chosen campsite/garden/schoolhouse that develops with the goal, one household journal, Merchant, Treasury, APIMatic context, the Studio Agent Framework and saved explicit receipt checks are implemented. Opt-in [shared families](FAMILY-ACCESS.md) add passkeys, invitations, server-enforced adult/child permissions and live page updates. [Family-planning integration](FAMILY-PLAN-REVIEW.md) adds read-only amount/date checks and protection against using stale plans.

This source also includes:
- [family choices](FAMILY-CHOICES.md), with their saved schedules and family-fit shopping;
- a [kit list](KIT-LIST.md) from typed text or a photo, and [complete-kit planning](KIT-PLANNER.md);
- a [shared village fund](VILLAGE-DEMO.md) with its square, recipient-bound sandbox orders, devnet watcher and read-only MCP bridge;
- [hold-first contributions](PAYMENT-HOLDS.md): hold, extend once, release in up to three steps, or return;
- the knight-and-dragon [loading scene](DRAGON-LOADING.md), Snow weather and outer-meadow miniatures;
- Moss's optional [tour](KEEPER-GUIDE.md);
- opt-in music;
- payment recovery fixes.

[Release status](RELEASE-READINESS.md) records actual runtime evidence and remaining recording/submission gaps. This is not a submitted entry.

The reviewed scene lifecycle, Treasury stalled-asset recovery and [credential-free CI](VALIDATION.md#release-checks-workflow--november-7-2026) remain in the source. The journal release [PR #66](https://github.com/alejandro-publius/our-castle/pull/66) passed all six jobs in [run 42750968924](https://github.com/alejandro-publius/our-castle/actions/runs/42750968924):
- 590 unit passes and one existing skip on each of Node 22.16.0, 24 and 26, plus nine Rust tests per build;
- 27 desktop and 24 phone release-browser passes, with three designed phone skips;
- 18 native-solver browser passes.

The checked merge and source release `e757071` have the same implementation tree. These counts describe that release; this handoff revision changes documentation only. [Validation](VALIDATION.md) records exact scopes and corrections.

These source suites use fake providers. Both saved Mac apps now run `a56170a` at schema 18; that local upgrade and one live synthetic OpenAI photo check are recorded separately in [validation](VALIDATION.md#saved-mac-runtime-upgrade--november-10-2026).

Identify the commit you actually inspected, read [release readiness](RELEASE-READINESS.md) and [validation](VALIDATION.md), then follow the relevant implementation. Report inaccessible files explicitly. These are source-review entry points, not claims that every execution path has live-provider proof.

| Review question | Implementation | Focused evidence |
| --- | --- | --- |
| Does checkout stay off the initial world path and preserve one approval attempt? | [SDK wrapper](../src/app/paypal-checkout.js), Contribute in [main.js](../src/app/main.js) | [Readiness/load/retry/race cases](../test/e2e/checkout-readiness.spec.mjs), [previous callback cases](../test/e2e/paypal-callbacks.spec.mjs); 22 desktop/phone fake-provider passes, no new real popup claim |
| Can progress credit or reverse twice? | [Contribution service](../server/payments/contributions.mjs), [SDK adapter](../server/payments/paypal-sdk-client.mjs) | [Payment cases](../test/unit/payments.test.mjs), [uncertain outcomes](../test/unit/paypal-unknown-outcome.test.mjs), [reconciliation](../test/unit/paypal-reconciliation.test.mjs) |
| Does a receipt remember an honest check without rechecking on load? | [Migration 4](../server/db.mjs), contribution service, [receipt/error rendering](../src/app/main.js) | [Saved-check unit cases](../test/unit/receipt-checks.test.mjs), [browser recheck cases](../test/e2e/payment-recheck.spec.mjs) |
| Can AI verify from prose or move money? | [Steward/reconciliation](../server/steward/index.mjs), [read-tool wrapper](../server/steward/paypal-tools.mjs), [planner validation](../server/planner/validate.mjs) | [Steward cases](../test/unit/steward.test.mjs), [injection cases](../test/unit/prompt-injection.test.mjs), separate [actual runtime result](IN-APP-SANDBOX-VERIFICATION.md) |
| Can a family try an affordable schedule without changing the plan in use? | [Plan check](../src/app/plan-check.js), [server facts](../server/planner/facts.mjs), [remaining calculation](../server/planner/remaining.mjs) | [Planning regressions](../test/unit/planning-revision.test.mjs), [actual Plan UI cases](../test/e2e/plan-check.spec.mjs), [review evidence](FAMILY-PLAN-REVIEW.md) |
| Does product search become a goal only after confirmation? | [Merchant dialog](../src/app/merchant.js), [Channel3 adapter](../server/merchant/channel3.mjs), [goal save](../server/merchant/goal-item.mjs) | [Merchant browser cases](../test/e2e/channel3-merchant.spec.mjs), [connected journey](../test/e2e/connected-journey.spec.mjs) |
| Is Studio doing meaningful work? | [Treasury widget](../src/app/treasury.js), [agent runner](../src/app/treasury-agent.js), [typed model](../server/treasury.mjs) | [Treasury implementation/evidence](TREASURY.md) |
| What did the PayPal Doctor checklist find? | [Source-guided review and exact upstream reference](PAYPAL-DOCTOR-REVIEW.md) | Late-cancel/error reporting reproduced and fixed with fakes; native slash command and live probes not run; public webhook timing remains a deployment limit |
| Can complete kits be compared without guessing? | [Planner](../server/kit/planner.mjs), [solver bridge](../server/kit/solver.mjs), [Rust solver](../solver/src/lib.rs), [reference](../src/core/kit-plan.js) | [Solver agreement and bridge](../test/unit/kit-solver.test.mjs), [HTTP cases](../test/unit/kit-planner.test.mjs), [journey](../test/e2e/kit-planner.spec.mjs); fake catalog and Cohere |
| Do family choices keep each adult's own offer? | [Family choices](../server/family-choices.mjs), [comparison](../src/core/family-choices.js) | [HTTP cases](../test/unit/family-choices.test.mjs), [schedule cases](../test/unit/family-schedule.test.mjs), [journey](../test/e2e/family-choices.spec.mjs) |
| Does a payment survive a restart or a second server? | [Contribution service](../server/payments/contributions.mjs) | [Restart](../test/unit/payment-restart.test.mjs), [two servers](../test/unit/payment-two-servers.test.mjs), [seeded model](../test/unit/payment-model.test.mjs) |
| What did APIMatic contribute? | [Pinned context and provenance](APIMATIC-CODEX.md), SDK adapter | Documented context use and fake-provider recovery checks; not a runtime money service |
| What is still a limitation? | [Release status](RELEASE-READINESS.md), [dependency review](TOOLKIT-MAINTENANCE.md), [licences](../NOTICE.md) | Unfilmed insert, unpublished video/unsubmitted entry, human playtest notes pending, example personas distinct from the opt-in passkey family runner, no utility provider, remaining dependency advisories |

Suggested independent review request:

> Review the current main branch of alejandro-publius/our-castle. State the commit and files you accessed. Read docs/JUDGE-HANDOFF.md, docs/RELEASE-READINESS.md and docs/VALIDATION.md first. Give at most five actionable findings, with file/line references, the trigger, expected versus actual behavior, severity and a concrete correction. Separate demonstrated defects, untested concerns and known limitations; distinguish example/fake-provider tests from actual sandbox/AI evidence. If you cannot access or run something, say so. Treat the missing video as a presentation gap; do not infer that the already-documented sandbox payment is unverified.
