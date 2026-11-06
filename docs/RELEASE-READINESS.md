# Release readiness — November 5, 2026

The owner asked Codex to finish the remaining integration and release work. The approved sandbox contribution and same-order steward check now pass; recording and entry submission remain separate unfinished steps. [Current runtime evidence](IN-APP-SANDBOX-VERIFICATION.md).

| Item | Current state |
| --- | --- |
| Game and three sponsors | Implemented: Channel3 Merchant, AG Grid/Studio Treasury and Agent Framework, APIMatic context/SDK improvements |
| Latest scenery | Expanded 292×196 realm, empty outer meadows, mountain ridges and official-outline PayPal hillside letters; 10 realm/terrain unit cases, six desktop/phone exploration/unlock cases and final visual review passed. [Evidence](MOUNTAIN-BORDER.md) |
| Current local validation | Rachel PR review: 184 unit passes, one intentional skip, eight desktop/phone browser passes and protected-source guard. Actual Studio expression and explicit missed-refund receipt recovery covered with fake/local transports; no new live-provider proof. Earlier visual/framework checks remain in VALIDATION.md |
| GitHub source release | **Public**, confirmed through anonymous repository metadata and README access. Published using the owner's existing Mac GitHub CLI login |
| Hosted site | Not deployed; repository run instructions satisfy the checked functional-demo route |
| Mac activation | Owner app 3010 and isolated rehearsal 3021 use `~/projects/our-castle-reviewed`; original checkout remains `791e8ae`. Both databases and `.env` are preserved; the owner is now the manual checkout operator |
| Approved sandbox flow | Owner completed one $15 in-app contribution; one credit to $75, village/Manor open, real same-order `get_order` and server `match`; preserve the existing 3021 rehearsal |
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

The owner app is **http://localhost:3010** in `/Users/alexvintera/projects/our-castle-reviewed`. Ignored `.env` and `data` links retain the originals. The original `/Users/alexvintera/projects/our-house` checkout stays clean at `791e8ae`. Do not run a second server on an occupied port or reset either household.

When the owner explicitly requested opening the pages to do checkout manually, the same isolated **3021** rehearsal was brought from its older source to reviewed `c51b6dd`. Its existing database migrated schema 1 to 3 after a consistent backup; every existing column/row, owner database/listener and original environment bytes/mode/mtime matched. The old 67124 listener was replaced by **37171** on 3021; 3010 was not restarted. The owner is now the sole browser checkout operator. Both fixed URLs were dispatched to the Mac's default browser; no automated login, payment click or order creation occurred.

Subsequent gold-fountain changes affect frontend presentation only. They require no backend restart, new provider call or database change. Refresh the game only when no checkout is in progress. Server configuration still comes from the existing private environment; no key is bundled. Private handoff/backup metadata is under `~/projects/our-house/test-results/approved-sandbox-insert/manual-handoff-*/`; `session.json` and `RESUME.md` hold the current operator/PID, superseding the older coordinator handoff.

**Latest activation:** reviewed Rachel PRs #1/#2 are active at `2dc00e0` from the same reviewed worktree, including the latest vines, lanterns and fairy. Both servers restarted after no-active-order checks and consistent private database backups: 3010 PID **41956**, 3021 PID **41966**. Every application/household/financial table, environment bytes/mode/mtime, runtime mode and progress matches before/after. Four served app/world module hashes match. Owner 3010 remains at $60; the verified 3021 rehearsal remains at $75/$300. No provider/payment/AI call was made. Private evidence: `~/projects/our-house/test-results/rachel-pr-activation-20261106T041716Z/report.json`. [Review checks](VALIDATION.md#rachels-pr-review--november-5-pst--november-6-utc-2026). This supersedes older listener/source statements above.

## Current sandbox result and remaining handoff

1. **Runtime verification is complete.** The owner manually contributed once in the existing 3021 rehearsal. It has one completed $15 USD order/capture, one contribution credit and $75/$300 progress; Hearth and Manor are open. Actual selected-order `get_order` plus ledger read returned `match`, `verified` and no warnings. The first steward request exposed an unsupported forced-tool setting; fix `3f72609` passed 10 focused tests and one necessary runtime retry. No replacement payment or refund was made. [Receipt evidence](IN-APP-SANDBOX-VERIFICATION.md).
2. **Keep the verified rehearsal.** Its current server PID is **41966**, on the same database, with the reviewed recovery, refund and prompt fixes active. Both servers restarted after consistent backups, with application rows preserved; owner 3010 retains its separate original $60 state. No further payment or paid suite is needed to repeat this result. Private session metadata records current ownership and exact evidence paths.
3. **Recording remains paused by the owner.** Resume capture/upload/submission only when separately authorized. No continuous checkout recording has been located or confirmed. The [current 2:42 review cut](demos/current-review/README.md) remains unchanged, with its missing insert explicitly marked at **1:08–1:36**. Runtime API evidence does not supply popup, bridge-motion or steward UI footage. No public YouTube URL or authenticated Devpost control exists here. The editable 28-second slot can expand to 40 seconds while keeping the cut at 2:54. No extra product search, planner suite, refund or replacement payment is needed.

Hosting, a production Studio licence, real household sign-in and verified utility-provider connections are separate future scope. No live PayPal endpoints or real financial transactions are supported.
