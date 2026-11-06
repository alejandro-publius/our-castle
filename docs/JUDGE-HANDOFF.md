# Run and review Our Castle

Current build: **November 5, 2026**. Nine connected woodland districts, one household journal, Merchant, Treasury, APIMatic context and the Studio Agent Framework are implemented. [Release status](RELEASE-READINESS.md) records publication and the remaining live-proof/video blockers. This is not a submitted entry.

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
2. **Areas → Market Town → Merchant:** with Channel3 configured, search within a budget. **Use as goal** drafts the Plan; confirm **Save as our goal** explicitly. Without a key the merchant shows it is disconnected.
3. **Journal → Plan:** edit the goal, reported starting progress and weekly contribution. The AI planner is live only with a runtime key; otherwise the rules planner is labelled accordingly.
4. **Contribute:** choose Rowan (adult), approve the exact amount and contribute. A $15 simulated contribution from the synthetic $60/$300 starting state opens the Manor at $75. It is labelled simulated.
5. Dismiss the short deed, inspect the Manor and confirm the village remains. **View deed** reopens an earned area's card.
6. **Ledger:** the Studio milestone points to the next area, AG Grid filters/search affect only the list, and a selected contribution opens its receipt. **Visit…** returns to the earned district. The existing steward stays closed until requested.
7. Refresh. Goal, contribution, receipt and earned areas persist. Explore night/rain, the palace, towers and sword without changing any finances.

Searching does not buy a product. Bills/gifts do not count toward savings. No verified utility provider is connected.

New unlock cards briefly welcome the household's selected pixel characters beside the crest. The parallel banner is suppressed for the same event; reopening a deed uses the original compact face. [Reference lock](UNLOCK-CELEBRATION.md). For observed usability sessions, use the [three-person playtest sheet](PLAYTEST.md); no participant results have been invented.

## 3. Evidence, without mixing modes

| Feature | Actual evidence | Limit |
| --- | --- | --- |
| Current in-app sandbox / steward | [Owner-completed $15 contribution and exact-order verification](IN-APP-SANDBOX-VERIFICATION.md): one credit to $75, village/Manor open, real `get_order`, deterministic `match` | Subsequent steward request used the local API; continuous popup/bridge/steward UI footage is unconfirmed |
| PayPal Server SDK | [Historical sandbox run](LIVE-VERIFICATION.md): hosted buyer approval, $15 capture, single credit, replay/mismatch checks, matching order and refund | Not an in-app popup recording |
| AI planner/steward | [Historical live AI run](LIVE-VERIFICATION-AI.md): exact plan arithmetic, impossible target, ledger and transaction listing | No same-household-order `get_order` in that run |
| Channel3 Merchant | One real desktop search; local fake-provider phone/save/journey tests | No new credit or live phone/save retest |
| AG Grid / Studio | Actual installed widget, theme, harness/custom runner, cancellation, cleanup and fallback in browser checks | Provider responses in framework tests are fake; production licence not included |
| APIMatic | [Eight SDK-specific Codex skills](APIMATIC-CODEX.md), discovery/hash evidence and tested payment fixes | Developer context, not another runtime money service |
| World and family journey | Focused desktop/touch-phone Chromium and Linux WebKit checks | Browser emulation, not physical devices/macOS Safari |

[VALIDATION.md](VALIDATION.md) gives exact runs and versions. [AWARD-STRATEGY.md](AWARD-STRATEGY.md) maps the implementations to official sponsor briefs without guaranteeing a prize.

## 4. What remains, by who has to act

**Current Mac apps:** the owner household stays at **http://localhost:3010** and the isolated rehearsal at **http://localhost:3021**, both from `~/projects/our-castle-reviewed`. The original checkout stays clean at `791e8ae`; private keys and both existing databases remain. The current listeners are 3010 **41956** and 3021 **41966**, after the backed-up activation of reviewed Rachel PRs at `2dc00e0`. Application rows and environment are preserved, including 3010's separate original $60 state. The steward fix remains active. [Current activation/handoff](RELEASE-READINESS.md#current-sandbox-result-and-remaining-handoff).

**Completed manual checkout:** the owner was the sole browser operator and completed the approved $15 contribution. This worker inspected the saved capture/credit, fixed the provider's forced-tool incompatibility, and made one necessary same-order steward retry through the local API. It genuinely called `get_order`; the server returned `match`, selected-order `verified`, and no warnings. Do not create another payment or repeat paid suites.

The rehearsal now has **one completed order, one completed capture, two ledger entries ($60 reported plus one $15 sandbox credit), no plan and no payment waiter**. Progress is $75/$300; Hearth and Manor are open. Private `approved-sandbox-insert/session.json` and the linked verification report supersede earlier zero-order statuses.

**Remaining recording handoff:** locate/confirm any continuous owner recording. None is presently established. The actual bridge movement and steward UI have not been independently filmed; do not imply the API proof supplies that footage. Keep the current review cut and all original sources unchanged until the edit has genuine source material. No final YouTube upload or Devpost submission is claimed.

**Submission:** current entry copy is [SUBMISSION-DRAFT.md](SUBMISSION-DRAFT.md). The current three-minute shot plan is [SUBMISSION-SHOTLIST.md](SUBMISSION-SHOTLIST.md). A public YouTube video is not uploaded, and no authenticated Devpost submission control is available here. Hosting is optional under the checked rules. The deadline is **November 12, 2026, noon PST**.

**Production follow-up, not a claim of current support:** real family sign-in, multi-device access, live webhooks, physical-device/screen-reader passes, suitable AG commercial terms and remaining dependency advisories. Utility rewards require genuine authorized provider evidence; there is no such connection.

## 5. Current review cut and preserved media

The owner's November 5 request to finish the release authorized video work again. The new [2:42 current-build review cut](demos/current-review/our-castle-current-review-cut.mp4) is exported with narration, captions, an editable timeline and exact provenance. Its explicit unfilmed checkout insert is at **1:08–1:36**; [kit and recording instructions](demos/current-review/README.md). It has not been uploaded to YouTube or submitted. Historical live sources are labelled separately from the current example game.

All older sources and captions remain unchanged:

| Material | Path and status |
| --- | --- |
| Woodland/family review, 2:51 | [MP4](demos/woodland-review/our-castle-family-woodland-review-draft.mp4), [editable kit](demos/woodland-review/README.md); historical UI, unfilmed sandbox insert at 2:17–2:41 |
| Earlier judge review, 2:36.36 | [Kit](demos/judge-review/README.md); older visuals, unfilmed insert at 2:00.36–2:24.36 |
| Gameplay, 17.60 s | [MP4](demos/gameplay/our-castle-gameplay-demo.mp4), [sources](demos/gameplay/README.md); example mode, older Rewards catalogue |
| Time/weather, 18.04 s | [MP4](demos/atmosphere/our-castle-time-weather-preview.mp4), [sources](demos/atmosphere/README.md); example UI, no live-weather/payment proof |
| Original world clip, 36.36 s | [MP4](demos/our-castle-connected-realm.mp4), [provenance](demos/README.md); historical six-island example-mode world, not the current forest |

All footage shows its recorded version. No missing checkout or tool outcome has been reconstructed.
