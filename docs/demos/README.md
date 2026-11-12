# Demo clip provenance

## Scripted capture of the locked shot list — November 11, 2026

[`final-capture/record-demo.mjs`](final-capture/record-demo.mjs) drives the [locked shot list](../SUBMISSION-SHOTLIST.md) end to end in a hidden browser and writes one silent, captioned MP4 of about 2:10 at 1920×1080: the family-trip example (kit chosen, repaired, plan put in use, a $40 hold with $30 released), then the village fund ($200 to $240 of $400, the square, the records), then an end card with the repository address and the commit.

```sh
node docs/demos/final-capture/record-demo.mjs   # writes test-results/final-video/our-castle-demo-captioned.mp4
```

- **What is real:** every press, tick and typed amount goes through the page's own controls, in the two keyless examples. The families and prices are invented and the payments are simulated, as the page and the captions say.
- **What the script adds:** the captions, the pointer ring and the end card. They are drawn over the page for the recording and are not part of the app. There is no narration.
- **Where it goes:** `test-results/final-video/`, which Git ignores. No video file is committed and nothing is uploaded. Joining the two sessions needs `ffmpeg`; without it the raw recordings and their cut points are kept.
- **First run:** recorded at the owner's request from `main` at `2fdce16`, 2:11 long. This is not the submitted video; the owner decides whether to use it, narrate over it or record their own.

## Recorded gameplay demo

[17.60-second gameplay demo](gameplay/README.md), recorded from the actual game at `78033cc`. It shows Explore Royal Citadel, its court, night/rain and Return to your realm. Named destinations and unlock conditions replace the former art-tool wording. The existing example household, financial state and older clips are preserved. This source-pinned recording predates the later removal of the Rewards catalogue and future-tier tour.

## New lighting and rain preview

[18.04-second MP4 and source notes](atmosphere/README.md): actual example-mode UI at `feada574`, switching Day → Afternoon → Night → Rain. Manual weather is clearly labelled; it is not a live forecast or payment demonstration. The 2:51 review below predates district deeds and atmosphere.

## Current woodland and family review

[The new 2:51 review kit](woodland-review/README.md) records the green forest and the clearer family journey in isolated example mode, alongside labelled historical PayPal/AI evidence. The approved sandbox insert remains unfilmed. The older clips below are preserved unchanged and show the earlier island layout.

## `our-castle-connected-realm.mp4`

| | |
| --- | --- |
| What it is | A silent, captioned visual walkthrough of the connected realm in **example mode** |
| Length and format | 36.36 s; 1920×1080 H.264 at 25 fps; no audio stream |
| Size and SHA-256 | 1,932,194 bytes; `33dd65316e28ee6e059cb856deccaaebfe8eb071e00750ab18f4d3b51beb2fc1` |
| Recorded | November 4, 2026, from the app at commit `7468b57`, running on an isolated example database on port 3134. Not the owner's sandbox household |
| Original file | `test-results/realm-promotion/our-castle-connected-realm.mp4` on the owner's Mac. That folder is git-ignored and holds the capture reports (`recording-report.json`, `timeline.json`, `export-manifest.json`). This copy is byte-identical; it was copied, not re-encoded |

**Sections:**
1. 0:00–0:09: six-district overview.
2. 0:09–0:16: inspecting the locked Royal Citadel.
3. 0:16–0:28: a **simulated** $15 contribution takes tracked progress from $60 to $75 and opens the Manor bridge.
4. 0:28–0:36: overview with the village and manor both open.

The talk track and timings are in [DEMO-SCRIPT.md](../DEMO-SCRIPT.md).

**Historical visuals.** Both this clip and the 2:36 judge draft in `judge-review/` were recorded before the November 4, 2026 woodland revision. They show the earlier grey-island revision (six islands in open blue water, locked districts painted grey). The current world is one green forest with narrow rivers under the bridges and colourful locked castles (`docs/screenshots/forest-*.png`). The clips are kept unchanged as a record and must not be described as showing the current art.

**What it is not.**
- It does not show PayPal, the AI planner or the steward, and it is not evidence of any live integration. That evidence is in [VALIDATION.md](../VALIDATION.md).
- It is not the hackathon video. It has not been uploaded, published or submitted.

**Rights.** The clip is a screen capture of this application rendering the owner's original Tiny Castle / Crown & Dust art, fonts and renderer. The scope and restrictions in [NOTICE.md](../../NOTICE.md) apply to it. The root MIT license covers application source, not this artwork. Public distribution is the owner's decision.
