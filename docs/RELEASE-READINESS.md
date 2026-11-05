# Release readiness — November 5, 2026

The owner asked Codex to finish the remaining integration and release work. This report separates the reviewed source from the still-unverified live rehearsal and the unsubmitted entry.

| Item | Current state |
| --- | --- |
| Game and three sponsors | Implemented: Channel3 Merchant, AG Grid/Studio Treasury and Agent Framework, APIMatic context/SDK improvements |
| Current local validation | 28 focused Chromium/WebKit browser passes plus source/art guard; provider responses in this pass are fake |
| GitHub source release | Reviewed build pushed to main; **still private**. GitHub denied the visibility change with HTTP 403, `Resource not accessible by integration` |
| Hosted site | Not deployed; repository run instructions satisfy the checked functional-demo route |
| Mac sync | Blocked: device offline; last inspected local main was clean `791e8ae`. Later cloud changes are not installed there |
| Approved sandbox flow | Still unverified end to end; existing 3021 rehearsal must be preserved |
| Entry text / current shot plan | Ready in [SUBMISSION-DRAFT.md](SUBMISSION-DRAFT.md) and [SUBMISSION-SHOTLIST.md](SUBMISSION-SHOTLIST.md) |
| Final video / YouTube / Devpost | Not completed, uploaded or submitted; older review drafts remain labelled incomplete |

## Source review

- The checked remote history comprised **85 commits**, about 7.26 MB of scanned text. Gitleaks **8.30.1**, downloaded from its official GitHub release and verified against that release's SHA-256 checksums, reported **zero findings**. This is a credential-pattern scan, not a guarantee that every kind of private content is absent.
- Tracked filename review found only `.env.example`, with blank provider settings; no `.env`, database, account file, log, local capture or `node_modules` directory is tracked. Runtime credentials and household records stay on the owner's Mac, not in this cloud checkout or release.
- A separate working-source scan reported zero findings. Media review covered all **108 tracked PNGs** and **555 one-second samples from 11 unique videos** (the 16 tracked MP4 paths include duplicate sources). OCR completed all 663 inputs without errors; Gitleaks and additional Anthropic/private-key/credential-field patterns found zero matches. A four-point contact sheet for every unique video was inspected. This is sampled review, not proof that every frame or historical binary object is free of every possible private detail. Original media bytes remain unchanged.
- The two release implementation/documentation commits also passed a separate history scan with zero findings. Source snapshot `331d864` contains 411 files and excludes runtime keys, databases, logs, local captures and dependencies. A fresh extraction installed 276 packages with `npm ci`, passed the original-art/source guard and started in example-payments/example-planner/merchant-off mode. The app, new runner, actual Studio bundle and bundled font all returned HTTP 200. The smoke script's first attempt used a wrong font filename; the corrected check passed without an application change.
- The source uses the existing MIT code licence and retains original-art, font, Three.js and APIMatic notices. The AG Studio commercial/evaluation notice is explicit; no trial key is included. Public availability does not grant a general Tiny Castle brand/art licence or a Studio production licence.
- Twelve dependency packages remain audit-flagged through other advisories after the scoped LangChain patch. See [TOOLKIT-MAINTENANCE.md](TOOLKIT-MAINTENANCE.md); this is not an audit-clean or production-ready claim.

Ignored audit evidence is under `test-results/release-audit/`; functional evidence is under `test-results/studio-agent/`. Historical live reports and all original media are unchanged.

## GitHub publication result

Normal push to `alejandro-publius/our-castle` main succeeded at `331d864` (the following status commit changes documentation only). The older `gh repo edit` installed here lacks the newer acknowledgement flag, so no mutation occurred through that command. The supported GitHub REST repository-update request then returned **403 `Resource not accessible by integration`**. A fresh read confirmed `private: true`; no visibility change, site deployment or entry submission occurred. No alternate token or unsupported browser path was used.

The existing GitHub connection can push source but lacks repository-administration permission. The remaining owner action is GitHub **Settings → General → Danger Zone → Change repository visibility → Public** at https://github.com/alejandro-publius/our-castle/settings . This is a provider/connection limitation, not missing user consent. Original asset terms remain as written; do not broaden them as part of the visibility change.

## Precise external blockers

1. **Reconnect the existing Mac and supported browser control.** Desktop Commander reports the Mac offline; this chat has no supported browser controller. The owner already approved the single $15 sandbox rehearsal and necessary same-order steward call. Consent and keys are not missing. Do not make another rehearsal or order while reconnecting.
2. **Complete that one actual flow.** Last inspected 3021 state: zero orders, one $60 reported starting entry, no plan, no waiter or recording. Recheck before proceeding. A $15 USD capture must credit the $300 goal once to $75, open the Manor while retaining the village, and be matched by real `get_order` for the identical household/goal/order/reference/capture. Current fake-provider tests and historical hosted approval do not establish this.
3. **Make the reviewed repository public through an owner-capable connection.** See the exact GitHub response/action above. Authenticated clone/push works; anonymous judge access does not yet work.
4. **Finish the reviewed video and entry through authenticated tools.** The missing actual insert is not filmed. No public YouTube URL exists, and no supported authenticated Devpost control is available here. Do not submit the old draft as fully live or reconstruct the missing outcome. Current copy and a 2:45 shot plan are ready; no extra product search, planner call or refund is needed.

Hosting, a production Studio licence, real household sign-in and verified utility-provider connections are separate future scope. No live PayPal endpoints or real financial transactions are supported.
