# Demo script

**Current recording plan — November 10 UTC:** use [SUBMISSION-SHOTLIST.md](SUBMISSION-SHOTLIST.md), a proposed **2:55** family-decision story with separate historical AI and PayPal evidence. It follows the current [journal](JOURNAL-DESIGN.md) and [four-step judge route](JUDGE-HANDOFF.md#2-a-short-review-route). It has not been recorded; recording remains paused.

**Latest existing cut:** the [2:42 current-review kit](demos/current-review/README.md) remains the preserved review export, with an unfilmed insert. The 2:51 woodland cut and the talk tracks below are historical alternatives. They are not current operator instructions or new evidence of checkout, AI, music or the journal.

The historical material below has three pieces:

- **Part A** describes the clip that already exists. It is a silent 36-second world tour recorded in example mode.
- **Part B** preserves an earlier proposed demo. Its readiness labels describe the evidence available when that plan was written; they are not the current integration status.
- **Part C** preserves the [earlier 2:36.36 review draft](demos/judge-review/our-castle-judge-review-draft.mp4): example-world footage of that build, earlier recorded live AI and historical evidence, with an explicit owner-insert slate. It is not the latest cut or a fully live end-to-end recording.

Status and evidence: [JUDGE-HANDOFF.md](JUDGE-HANDOFF.md). Publishing, uploading and submitting are the repository owner's decisions.

## Part A: the finished world clip (36 s, silent)

File: [`docs/demos/our-castle-connected-realm.mp4`](demos/our-castle-connected-realm.mp4), with a [provenance note](demos/README.md). It is a byte-identical copy of the original in the owner's git-ignored `test-results/realm-promotion/`. Preserved in the public source repository; not a submitted video.

- **Format:** 1920×1080 H.264 with burned-in titles and captions and no audio.
- **Source:** an isolated example database on port 3134, not the owner's sandbox household.
- **What it shows:** the world and how progress opens it.
- **Historical visuals:** recorded before the woodland revision, so it shows the earlier grey-island revision (six islands in open blue water, locked districts painted grey). It is kept unchanged. The picture descriptions below describe the clip as recorded, not the current forest.
- **What it does not show:** PayPal, the AI planner or the steward. Never describe it as proof of a live integration or as the submitted video.

The talk track is optional narration for a voiceover. It has not been recorded. Each line fits its section at a calm pace (about two words a second) and keeps the clip's "example mode" and "simulated" wording.

| Clip time | On-screen title | Picture | Optional narration |
| --- | --- | --- | --- |
| 0:00–0:09 | 1/4 One connected realm, six distinct districts | Whole realm: Hearth Village open, five grey districts beyond raised bridges | "Our Castle turns one shared family savings goal into a connected realm: six districts joined by bridges, waiting in grey." |
| 0:09–0:16 | 2/4 Inspect the locked Royal Citadel | Camera focuses on the grey citadel and its 100% lock | "Inspect any locked district, like the Royal Citadel at one hundred percent. Looking never unlocks it." |
| 0:16–0:28 | 3/4 The Manor bridge opens at the 25% milestone | Contribute tab, a simulated $15.00 payment; $60 → $75; "The Manor rises!"; Manor Gardens turn green and the bridge lowers | "Here, in example mode, a simulated fifteen-dollar contribution takes the goal from sixty to seventy-five dollars, and the Manor bridge lowers." |
| 0:28–0:36 | 4/4 The village remains as your realm expands | Overview with village and manor open, 2/6 districts | "The village stays. Each milestone opens a new district, and its guests move in." |

## Part B: judge demo plan (under 3 minutes, proposed)

> Historical plan for the earlier build. Use the current shot list above; these old rehearsal steps do not authorize another order or provider call.

Record this on the real sandbox app with live AI, so that the badges read **PayPal sandbox** and **AI planner · claude-opus-5-5**. Never record example mode for this part.

The plan assumes a household at $60 of a $300 goal. That is the owner's House of Alder on http://localhost:3010, or a fresh rehearsal copy (see [preserved-media handoff](JUDGE-HANDOFF.md#5-historical-review-cut-and-preserved-media)). Every take creates one sandbox order (test money) and makes a few paid Anthropic calls.

**Readiness boundary.**
- Steps marked **Verified** have live evidence.
- Steps marked **Rehearse first** are implemented but unverified live.
- Run one full rehearsal before recording. If a "Rehearse first" step fails, do not record around it or present it as working. Fix it first, or leave the step out and say what is not shown.

| Time | Screen | Say | Readiness |
| --- | --- | --- | --- |
| 0:00–0:15 | Press "Whole realm": the village open in the forest, five colourful locked districts behind raised bridges over the rivers; the header badges | "Saving as a family is hard to see and easy to abandon. Our Castle turns one shared goal into a connected realm. Each real milestone opens a new district." | Working |
| 0:15–0:25 | House tab: Family, house name, crest (found it first on a fresh copy) | "Solo or family: one crest, one house. These are example personas; this prototype doesn't claim real sign-in." | Working |
| 0:25–0:55 | Plan tab: $300 goal, $60 set aside, target date, $30 a week, a bill; "Ask the planner", then "Use this plan" | "Claude turns our own numbers into a weekly plan and shows its arithmetic. The server re-checks every cent, and bills stay separate, never counted as savings." Each live plan takes about 14 seconds: trim the wait in editing, or talk over it. Showing a shortfall needs a second plan request | **Verified** (AI-only run, Nov 3) |
| 0:55–1:35 | Contribute tab: "$15.00 Raises the Manor", tick Rowan's adult approval, press the PayPal button, approve in the popup as the sandbox buyer | "An adult approves a specific amount, and PayPal handles the payment. Our server captures the order with PayPal's Server SDK, and progress moves only after it checks the amount, currency, household and goal with PayPal." | **Rehearse first:** the in-page popup approval is unverified. The server capture was verified through PayPal's hosted approval link |
| 1:35–1:55 | Receipt with the PayPal order and capture ids; the Manor bridge lowers; "The Manor rises!" | "Here's the receipt, and the realm answers: the Manor Gardens open across their bridge, and the village stays." | Verified on the server path; in-app after the rehearsal |
| 1:55–2:25 | Ledger tab: "Did PayPal confirm our last contribution?"; show "What it checked" and "PayPal and the ledger agree." | "Anyone in the family can ask the house steward. It reads our ledger and checks PayPal itself through PayPal's Agent Toolkit. It's read-only, so it can look but never pay or refund. The checks it lists come from the server, not the AI's words." | **Rehearse first:** live ledger reading and transaction listing are verified; `get_order` reconciliation of a household order is not |
| 2:25–2:40 | AG Grid ledger with the Bills filter, then the saved contribution receipt | "One ledger keeps contributions, bills and gifts separate. The receipt identifies the payment and what it counted toward the shared goal." | Working |
| 2:40–2:55 | "Whole realm" again | "Our Castle: PayPal for the trusted payment, AI for a plan a family can follow and a steward that checks the facts, and a realm worth coming back to." | Working |

**Recording rules.**
- Use the sandbox app and a sandbox buyer account. Never show `.env`, the client secret or the API key.
- Use no third-party music, and no trademarks beyond the PayPal sandbox checkout the product integrates.
- That older build used synthesized effects. The current Sound control also plays a [bundled, credited track](../assets/music/README.md). Keep Sound off for the narrated product walkthrough.
- The original Tiny Castle art appears throughout. Its public-distribution terms are an owner decision ([NOTICE.md](../NOTICE.md)).

**If live credentials are unavailable:** do not present example mode as the PayPal or AI integration. Its badges and receipts say "simulated" and "no AI" on purpose, and the steward says it is off.

## Part C: rendered judge review draft (2:36.36)

The [editable kit](demos/judge-review/README.md) includes its [timeline](demos/judge-review/timeline.json), [narration](demos/judge-review/narration.md), [captions](demos/judge-review/captions.srt), render scripts and hashed source excerpts. The [provenance notes](demos/judge-review/PROVENANCE.md) give each source time and claim boundary.

The already-recorded live planner and steward footage comes from the earlier UI; the original small world and obsolete audio are omitted. Historical verifier cards are labelled report excerpts. Current realm progression is labelled simulated. Nothing implies that the historical hosted approval was a newly recorded in-app popup.

**One insert remains, at 2:00.36–2:24.36:** actual in-app sandbox approval, verified receipt/Manor bridge, then the steward checking the same household order with `get_order`. The [shot list](demos/judge-review/OWNER-INSERT.md) specifies the evidence, isolated rehearsal setup, edits and replacement narration. A 40-second insert still keeps the cut below three minutes. If any step fails, keep the visible unfilmed slate and record the failure; do not reconstruct the result.

The original silent 36-second clip is unchanged. No new payment order or paid AI call was made for this review draft. Its offline synthetic voice, caption timings, source hashes, full decode and actual media streams are documented in the kit.
