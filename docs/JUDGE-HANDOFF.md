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
| PayPal Server SDK | [Historical sandbox run](LIVE-VERIFICATION.md): hosted buyer approval, $15 capture, single credit, replay/mismatch checks, matching order and refund | Not an in-app popup recording |
| AI planner/steward | [Historical live AI run](LIVE-VERIFICATION-AI.md): exact plan arithmetic, impossible target, ledger and transaction listing | No same-household-order `get_order` in that run |
| Channel3 Merchant | One real desktop search; local fake-provider phone/save/journey tests | No new credit or live phone/save retest |
| AG Grid / Studio | Actual installed widget, theme, harness/custom runner, cancellation, cleanup and fallback in browser checks | Provider responses in framework tests are fake; production licence not included |
| APIMatic | [Eight SDK-specific Codex skills](APIMATIC-CODEX.md), discovery/hash evidence and tested payment fixes | Developer context, not another runtime money service |
| World and family journey | Focused desktop/touch-phone Chromium and Linux WebKit checks | Browser emulation, not physical devices/macOS Safari |

[VALIDATION.md](VALIDATION.md) gives exact runs and versions. [AWARD-STRATEGY.md](AWARD-STRATEGY.md) maps the implementations to official sponsor briefs without guaranteeing a prize.

## 4. What remains, by who has to act

**Current Mac app:** **http://localhost:3010** now runs reviewed implementation `9d7a126` from `~/projects/our-castle-reviewed`. Its ignored environment/data links use the existing originals. Exact dependency install, source guard and four focused unit cases passed on the Mac. All owner rows, original environment bytes/mode/mtime and rehearsal records/source/PID were preserved. Restart from that reviewed checkout with `npm start` only when 3010 is free. The original `~/projects/our-house` remains clean at `791e8ae` because the existing **3021** rehearsal serves its files; do not pull/reset/restart it or start another operator. [Activation evidence](RELEASE-READINESS.md#current-mac-app).

**Prepared, approved rehearsal — browser still required:** Desktop Commander can manage the Mac's files and servers, but this chat still has no supported browser-control tool. Browser login/approval cannot be inferred from the pasted app credentials. Do not start a replacement server or order.

The rehearsal's last read-only state was **zero payment orders, one self-reported starting entry, no plan**. There is no order ID, payment waiter, steward call or recording to resume. The owner already approved one $15 sandbox in-app payment and its necessary same-order steward check. Existing keys are configured; no new key or repeated consent is needed when control returns. Verify the current state before proceeding.

The required result is actual in-app approval, a server-confirmed $15 USD receipt tied to the correct household/goal, $60→$75 exactly once, the Manor bridge with the village retained, and real `get_order` proof for that exact order. Do not substitute `list_transactions`, a ledger read or model prose.

**Submission:** current entry copy is [SUBMISSION-DRAFT.md](SUBMISSION-DRAFT.md). The current three-minute shot plan is [SUBMISSION-SHOTLIST.md](SUBMISSION-SHOTLIST.md). A public YouTube video is not uploaded, and no authenticated Devpost submission control is available here. Hosting is optional under the checked rules. The deadline is **November 12, 2026, noon PST**.

**Production follow-up, not a claim of current support:** real family sign-in, multi-device access, live webhooks, physical-device/screen-reader passes, suitable AG commercial terms and remaining dependency advisories. Utility rewards require genuine authorized provider evidence; there is no such connection.

## 5. Preserved media

No new video was made for this pass. The owner asked to keep building. Existing sources and captions remain unchanged:

| Material | Path and status |
| --- | --- |
| Woodland/family review, 2:51 | [MP4](demos/woodland-review/our-castle-family-woodland-review-draft.mp4), [editable kit](demos/woodland-review/README.md); historical UI, unfilmed sandbox insert at 2:17–2:41 |
| Earlier judge review, 2:36.36 | [Kit](demos/judge-review/README.md); older visuals, unfilmed insert at 2:00.36–2:24.36 |
| Gameplay, 17.60 s | [MP4](demos/gameplay/our-castle-gameplay-demo.mp4), [sources](demos/gameplay/README.md); example mode, older Rewards catalogue |
| Time/weather, 18.04 s | [MP4](demos/atmosphere/our-castle-time-weather-preview.mp4), [sources](demos/atmosphere/README.md); example UI, no live-weather/payment proof |
| Original world clip, 36.36 s | [MP4](demos/our-castle-connected-realm.mp4), [provenance](demos/README.md); historical six-island example-mode world, not the current forest |

All footage shows its recorded version. No missing checkout or tool outcome has been reconstructed.
