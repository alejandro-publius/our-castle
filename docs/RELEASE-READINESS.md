# Release readiness — November 5, 2026

The owner asked Codex to finish the remaining integration and release work. This report separates the reviewed source from the still-unverified live rehearsal and the unsubmitted entry.

| Item | Current state |
| --- | --- |
| Game and three sponsors | Implemented: Channel3 Merchant, AG Grid/Studio Treasury and Agent Framework, APIMatic context/SDK improvements |
| Current local validation | Family/deed follow-up: 30 focused Chromium/WebKit passes, 4 focused unit passes and source/art guard. Earlier Studio-framework 28-case evidence remains below in VALIDATION.md; no new live-provider proof |
| GitHub source release | **Public**, confirmed through anonymous repository metadata and README access. Published using the owner's existing Mac GitHub CLI login |
| Hosted site | Not deployed; repository run instructions satisfy the checked functional-demo route |
| Mac activation | Current app on 3010 uses reviewed code `9d7a126` in `~/projects/our-castle-reviewed`; original checkout stays at `791e8ae` to preserve the 3021 rehearsal's source |
| Approved sandbox flow | Still unverified end to end; existing 3021 rehearsal must be preserved |
| Entry text / current shot plan | Ready in [SUBMISSION-DRAFT.md](SUBMISSION-DRAFT.md) and [SUBMISSION-SHOTLIST.md](SUBMISSION-SHOTLIST.md) |
| Fresh judge session | Anonymous public clone/install/source guard and ten current-build journey/phone checks passed with actual `npm run demo`; no owner keys, data or provider call |
| Video / YouTube / Devpost | New **2:42 current-build review cut** exported and decoded successfully, with editable timeline/narration/captions/provenance. Actual checkout insert remains unfilmed; no final YouTube upload or Devpost submission |

## Source review

- The checked remote history comprised **85 commits**, about 7.26 MB of scanned text. Gitleaks **8.30.1**, downloaded from its official GitHub release and verified against that release's SHA-256 checksums, reported **zero findings**. This is a credential-pattern scan, not a guarantee that every kind of private content is absent.
- Tracked filename review found only `.env.example`, with blank provider settings; no `.env`, database, account file, log, local capture or `node_modules` directory is tracked. Runtime credentials and household records stay on the owner's Mac, not in this cloud checkout or release.
- A separate working-source scan reported zero findings. Media review covered all **108 tracked PNGs** and **555 one-second samples from 11 unique videos** (the 16 tracked MP4 paths include duplicate sources). OCR completed all 663 inputs without errors; Gitleaks and additional Anthropic/private-key/credential-field patterns found zero matches. A four-point contact sheet for every unique video was inspected. This is sampled review, not proof that every frame or historical binary object is free of every possible private detail. Original media bytes remain unchanged.
- The two release implementation/documentation commits also passed a separate history scan with zero findings. Source snapshot `331d864` contains 411 files and excludes runtime keys, databases, logs, local captures and dependencies. A fresh extraction installed 276 packages with `npm ci`, passed the original-art/source guard and started in example-payments/example-planner/merchant-off mode. The app, new runner, actual Studio bundle and bundled font all returned HTTP 200. The smoke script's first attempt used a wrong font filename; the corrected check passed without an application change.
- The source uses the existing MIT code licence and retains original-art, font, Three.js and APIMatic notices. The AG Studio commercial/evaluation notice is explicit; no trial key is included. Public availability does not grant a general Tiny Castle brand/art licence or a Studio production licence.
- Twelve dependency packages remain audit-flagged through other advisories after the scoped LangChain patch. See [TOOLKIT-MAINTENANCE.md](TOOLKIT-MAINTENANCE.md); this is not an audit-clean or production-ready claim.

Ignored audit evidence is under `test-results/release-audit/`; functional evidence is under `test-results/studio-agent/`. Historical live reports and all original media are unchanged.

## GitHub publication result

The reviewed source is now public at https://github.com/alejandro-publius/our-castle . The earlier cloud connection could push but its repository-update request returned **403 `Resource not accessible by integration`**. Once the Mac reconnected, its existing authenticated `gh` CLI completed the owner-authorized visibility change. No token was extracted or copied. GitHub returned `private: false`; separate anonymous metadata and raw README requests both returned HTTP 200.

Existing original-art and third-party notices remain unchanged by publication. Runtime keys, household databases, private backups and local configuration links are excluded. This publishes source; it does not deploy a site, upload the final video or submit Devpost.

## Current Mac app

The latest reviewed implementation `9d7a126` is installed at `/Users/alexvintera/projects/our-castle-reviewed`. It is a detached worktree of the same repository, with an exact dependency install, the original-art/source guard and four focused unit cases passing on Node 26. The configured app on **http://localhost:3010** now runs from it. Its ignored `.env` and `data` links point to the existing original files; `npm start` in this checkout starts the configured persistent app when 3010 is free.

Consistent backups preceded activation. Every application-table row in the owner database and rehearsal matches its pre-activation signature. The original `.env` bytes, permissions and modification time match. Four served entry/module files match the reviewed bytes. The separate **3021** process, database and three checked served source files are unchanged. The original `~/projects/our-house` checkout is deliberately kept clean at `791e8ae` because that rehearsal serves its files; do not pull or reset it while the existing rehearsal is being preserved.

Private activation evidence is in `~/projects/our-house/test-results/mac-activation-20261105T202636Z/`; the local `test-results/CURRENT-APP.md` records the restart path. No new payment order, paid AI call or product search was made. Configured sandbox/live-AI/merchant modes are not a new provider authentication or payment-success test.

## Precise external blockers

1. **Connect supported browser control for the existing rehearsal.** The Mac file/server connection is restored, but this chat still exposes no browser-control tool. Plugin discovery found no suitable tool for its local browser session. The owner already approved the single $15 sandbox rehearsal and necessary same-order steward call. Consent and keys are not missing. The existing coordinator retains checkout ownership; do not create another rehearsal, order or competing browser operator.
2. **Complete that one actual flow.** Last inspected 3021 state: zero orders, one $60 reported starting entry, no plan, no waiter or recording. Recheck before proceeding. A $15 USD capture must credit the $300 goal once to $75, open the Manor while retaining the village, and be matched by real `get_order` for the identical household/goal/order/reference/capture. Current fake-provider tests and historical hosted approval do not establish this.
3. **Replace one insert and upload/submit through authenticated tools.** The [current 2:42 review cut](demos/current-review/README.md) is locally playable and validated, with the missing actual insert explicitly marked at **1:08–1:36**. It uses the current public build, the earlier real Channel3 screenshot and live Claude recording, and historical hosted-link payment evidence. None substitutes for the unfilmed popup/same-order check. No public YouTube URL or authenticated Devpost control exists here. The editable 28-second slot can expand to 40 seconds while keeping the cut at 2:54. No extra product search, planner suite or refund is needed.

Hosting, a production Studio licence, real household sign-in and verified utility-provider connections are separate future scope. No live PayPal endpoints or real financial transactions are supported.
