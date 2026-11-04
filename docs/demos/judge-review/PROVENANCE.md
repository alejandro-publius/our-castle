# Sources and claim boundaries

The cut is assembled from existing recordings and verifier reports. Its report cards are explanatory graphics quoting those reports, **not screenshots of a new terminal run or recreated app output**. No third-party game art, music, invented PayPal screen or synthetic AI answer was added.

## Original recordings

| Source | Original location in the project | SHA-256 |
| --- | --- | --- |
| Current realm, 36.36 s | `docs/demos/our-castle-connected-realm.mp4` | `33dd65316e28ee6e059cb856deccaaebfe8eb071e00750ab18f4d3b51beb2fc1` |
| Earlier recorded live AI, 123.20 s | `test-results/demo-current/our-castle-current-build.mp4` | `bddeb4a7aaf7defe5184f3d88dc8a4a5175a53c6e280e4bee93ec86cf505ec74` |

The realm clip records an isolated example database and simulated contribution; it is not the owner's sandbox household. Its full original is copied byte-for-byte into `sources/connected-realm.mp4` for editable reproduction. New titles/captions cover its older caption strip; its app scenes are not reconstructed. The closing shot holds its final frame for four seconds.

The earlier AI recording report is timestamped **2026-11-04T07:31:29.695Z**, reports sandbox payments and live Claude Opus 5.5, and records POSTs only to `/api/plans`, plan acceptance and `/api/steward`. Tracked progress remained $60 and no checkout completed. The earlier layout's small world and old “current build” narration are omitted. Included excerpts retain their original order, omit waiting and are cropped to the right-hand UI panel. There is no speed-up. Crop coordinates and original in-points are in `timeline.json` and `sources/manifest.json`.

## Historical reports

- `sources/historical-paypal-verification.md` is a byte-identical copy of `docs/LIVE-VERIFICATION.md`. Original run: **2026-11-04T06:48:46.571Z**, equivalent to Nov 3 local time. Seven passed, zero failed, two AI-related skips. It used a hosted approval link, a temporary database, a verified $15 capture, replay/mismatch checks and a refund. It does not verify the in-app popup path.
- `sources/historical-ai-verification.md` is a byte-identical copy of `docs/LIVE-VERIFICATION-AI.md`. Original run: **2026-11-04T07:11:30.403Z**. Six passed, zero failed, one skipped. Separate cases establish a feasible $240 plan and a $160 shortfall; they are not two values from one plan. The steward read the ledger and listed transactions. Household `get_order` reconciliation remained skipped.
- Corresponding source recording reports are copied without changing their contents. Hashes of every included source/derivative are recorded in `sources/manifest.json`.

## Timeline categories

| Review time | Material | What it establishes |
| --- | --- | --- |
| 0:00–0:16 | Current realm, example-mode recording | Connected districts, grey future areas, raised bridges, inspection |
| 0:16–0:32 | Earlier recorded live planner, cropped | Genuine earlier AI request/result; editable schedule |
| 0:32–0:44 | Historical AI verifier excerpt | Separate feasible/shortfall checks and server arithmetic |
| 0:44–0:56 | Earlier checkout controls, cropped | Controls only; no completed checkout or popup proof |
| 0:56–1:14 | Historical PayPal verifier excerpt | Hosted approval/server capture, replay, household refusal and refund |
| 1:14–1:34.36 | Current realm, example-mode recording | **Simulated** $15 contribution and the Manor bridge animation |
| 1:34.36–1:48.36 | Earlier recorded live steward, cropped | Recorded ledger/history interaction; no household-order reconciliation |
| 1:48.36–2:00.36 | Historical AI verifier excerpt | Verified scope and the explicit `get_order` skip |
| 2:00.36–2:24.36 | Unfilmed owner-insert slate | Missing recording clearly identified; no result implied |
| 2:24.36–2:36.36 | Current realm, example-mode recording/held frame | Closing, provider-connection boundary and private draft status |

## Audio, captions and rights

Narration was generated **offline** with the installed macOS Daniel voice, phrase by phrase, at 172 words/minute. It is synthetic narration, not the owner's voice. No speech service or paid AI call was used. Phrase timings come from decoded audio durations, with explicit silence between phrases; they generate the burned-in captions and editable SRT/WebVTT tracks. The original recording audio is not reused.

The visual lock is the existing project’s dark teal/ivory/brass shell, actual realm footage and bundled Uncial/Alegreya fonts. Font OFL files are bundled. The app’s original art and renderer restrictions in `NOTICE.md` remain applicable to the recordings and derived cut. Keeping this private does not settle public art licensing or submission decisions.

**Outstanding:** actual in-app popup approval, specific household `get_order` reconciliation, optional browser refund check, live webhooks, pending/declined cases, real-device/Safari/Firefox/screen-reader coverage, authorized utility-provider evidence and owner release/submission decisions. No missing result is silently replaced by an example.
