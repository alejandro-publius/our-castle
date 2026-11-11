# Proposed demonstration: one family, then one village — not recorded

Revised November 10, 2026 (Pacific) against the combined village and loading release on `main` (merge commit `3bfe6e1`, the same tree as its reviewed head `795a6e7`; [release readiness](RELEASE-READINESS.md)). This is a plan for a future recording. Recording remains paused; no media was created or changed for this update. The existing 2:42 review cut is preserved below and shows neither the family-planning flow nor the shared village.

The plan uses two separate example sessions, and the cut between them must be visible:

1. **One family** — the [playable family-trip example](FAMILY-TRIP-EXAMPLE.md), `npm run demo -- --family-trip`.
2. **One village** — the [five-family shared fund](VILLAGE-DEMO.md), `npm run demo -- --village-fund`.

Label both sessions' families, catalogue and payments as examples. Neither route makes a live model request or a PayPal request. Separate, dated segments show the existing live AI recording and the preserved sandbox evidence.

| Proposed time | Show | Meaning and boundary |
| --- | --- | --- |
| 0:00–0:12 | Woodland and the family trip; “An expense changed. Can we still go?” | One concrete family outcome. Invented example, not a customer testimonial. If the knight-and-dragon loading scene appears while the realm starts, keep it as it happened; do not stage, slow or lengthen it. |
| 0:12–0:38 | The kit list, two torches already at home, Rowan/Ash's offers; enter a $90 one-off and compare | The actual engine returns distinct $150/$180 kits. Sample prices, tax/shipping excluded. |
| 0:38–1:02 | Choose $180, keep the stove, change the one-off to $120 | Show the computed $150 repair and the tent it switches. No catalogue/model call or payment caused by the trial. |
| 1:02–1:18 | Review the repaired kit, save the goal/schedule explicitly | The family's control remains visible. Do not hide required actions or imply comparison saved anything. |
| 1:18–1:38 | Approve one simulated contribution, see the world change, follow Review the receipt | Clearly label simulated money. The receipt shows its actual local state, never a fabricated PayPal Match. |
| 1:38–2:12 | **Second session, labelled.** Village fund: **Class trip together** at $200/$400. Enter 40, approve that exact amount, contribute: $240 and the schoolhouse's second stage. Open **Records** for the one receipt, **Visit the shared square**, then **My realm** | Five invented families and simulated money. The schoolhouse shows funding progress, not a purchased trip or building. The family's own goal stays $60/$300. Seeded family names are not online visitors. No recipient-bound PayPal payment or PYUSD observation is shown; both are fake-transport tested only. |
| 2:12–2:22 | Existing live Claude planner result, labelled **Historical live AI · earlier interface · November 3** | Use the actual preserved clip linked below. The current examples use rules; do not imply this model produced the kit repair or the village project draft. |
| 2:22–2:38 | Separate dated card for the preserved in-app $15 sandbox capture and same-order check | Historical integration evidence, not a replay of checkout or a new check. Use the in-app verification record, not the older subsequently refunded verifier. It is not evidence for the shared fund. |
| 2:38–2:55 | Treasury/Studio, concise integration roles, repository and the two run commands | Explain that the steward is read-only and adult approval is required. Mention Channel3's configured path separately from sample listings. Call the filmed solver Rust only if the capture used the compiled binary. |

The family segment ends with the existing **Review the receipt** action after the deed. Do not cut out that action and describe Treasury as automatic. The saved $150 repaired goal, the historical $300 sandbox goal and the $400 shared fund are three separate scenarios; their unlocks and totals need not agree.

**Left out on purpose.** [Two fresh signed-in families](VILLAGE-FIRST-USE.md) starting a neighborhood from nothing needs passkeys in two browsers and more time than this cut has; mention it in the entry instead. Hold first, then release or return, is on its own unmerged pull request ([#83](https://github.com/alejandro-publius/our-castle/pull/83)) and is not in this build. If the owner merges it, a simulated hold could replace part of 1:18–1:38, labelled simulated; any PayPal hold claim needs a real sandbox hold first.

### Proposed narration

This is a script for a future take, not recorded narration. Keep the on-screen example and historical labels visible. Leave short pauses for the actual controls and results.

**0:00–0:12:** “An unexpected expense should not mean rebuilding the whole family trip. Our Castle helps a family see what it can afford and decide the next step together.”

**0:12–0:38:** “This is an example family with sample prices. Rowan can offer twenty dollars a week, Ash ten. They already have their torches. With a ninety-dollar expense, the complete kit has two choices: a hundred fifty dollars, or a hundred eighty for lower listed weight.”

**0:38–1:02:** “They choose the lighter kit and keep the stove. Then the expense grows to a hundred twenty. The engine finds the smallest repair: change only the tent, and the kit is back to a hundred fifty.”

**1:02–1:18:** “The family reviews that repair, saves its goal, then accepts the weekly schedule. Trying an expense committed them to nothing.”

**1:18–1:38:** “An adult approves this exact fifteen-dollar simulated contribution. The world responds to recorded progress, and Review the receipt opens that contribution in the Treasury.”

**1:38–2:12:** “Some goals are bigger than one household. In this second example, five invented families share a class trip fund, at two hundred of four hundred dollars. An adult approves exactly forty. The shared total becomes two hundred forty, and the schoolhouse reaches its next stage. One receipt records it. In the shared square, no family's private amounts appear, and this family's own goal has not moved.”

**2:12–2:22:** “This earlier recording shows a real Claude schedule. The server checks its dates and totals before the family can use it.”

**2:22–2:38:** “Separately, our preserved PayPal sandbox record shows one fifteen-dollar capture and a same-order check. This is historical evidence, not footage of the examples you just saw.”

**2:38–2:55:** “The steward can read, but cannot spend. Families make the decisions; the castle makes their progress visible. The public repository includes both examples and their evidence. Our Castle: keep the trip, change the plan together.”

### Existing evidence to use

- **AI:** [the actual planner-result clip](demos/woodland-review/sources/planner-result.mp4), already used by the `live-ai` scene in the [preserved timeline](demos/current-review/timeline.json). The [source manifest](demos/woodland-review/sources/manifest.json) identifies its origin. Its SHA-256 remains `809ca81f712c77e7508888a933a168d262dec61d1d209d59a680f13c7644aef2`. It shows an earlier live schedule result, not live current-kit optimization.
- **PayPal:** [the in-app contribution and same-order verification record](IN-APP-SANDBOX-VERIFICATION.md). The completed $15 record is historical. Opening its receipt is not a fresh verification, and a card made from this report is not missing popup footage.
- **Current interface:** [journal screenshots and provenance](JOURNAL-DESIGN.md), plus the [family-trip route](JUDGE-HANDOFF.md#2-a-short-review-route). Record the actual source SHA when capture resumes. Existing screenshots are not substitute footage.
- **Shared village:** [the five-family route and its evidence boundaries](VILLAGE-DEMO.md) and [what the combined release checked](VALIDATION.md#combined-village-and-loading-release--november-10-2026). Those are fake-provider checks on disposable data. There is no recipient, wallet, connected assistant or real-family evidence to show, so the segment shows the example and says so.
- **Loading scene:** [how it behaves](DRAGON-LOADING.md). It appears only while startup is still pending after 120 ms and leaves when the realm is ready. A fast machine may never show it.

[Official rules](https://paypalaihackathon.devpost.com/rules), rechecked November 10 UTC, equally weight implementation, design, impact, innovation and presentation. They allow a runnable local build and call for a publicly visible YouTube demonstration under three minutes. The deadline is November 12 at noon Pacific. This plan does not establish a ranking or prize ceiling.

The time ranges are editing targets, not a measured walkthrough. The family segments are each a few seconds shorter than in the previous plan to make room for the village; if a take runs long, shorten the village's square visit before cutting a required approval or label. Keep optional photo reading, Cohere, passkey setup, Village Exchange handovers, PYUSD and the assistant bridge out of the main story unless genuine material and the remaining time justify them. Their implementations and evidence remain linked from the entry.

## Preserved material

### Preserved review cut — 2:42

The owner requested the remaining release work on November 5. The [current edit kit](demos/current-review/README.md) contains footage of the build recorded at that time, historical live evidence and an explicit unfilmed insert. It supersedes the older 2:45 shot plan; the original sources remain unchanged.

The [subsequent sandbox contribution and same-order verification](IN-APP-SANDBOX-VERIFICATION.md) now pass at runtime. The video still lacks confirmed source footage for that insert; do not imply this runtime result is already shown or create another payment to recreate it.

| Time | Picture | Source boundary |
| --- | --- | --- |
| 0:00–0:09 | Recorded nine-district forest | Actual fresh public build; example mode |
| 0:09–0:21 | House, crest and family characters | Recorded setup |
| 0:21–0:32 | Three merchant results | Actual earlier Channel3 screenshot, November 4 PST; not a new search or recorded goal save |
| 0:32–0:40 | Weekly schedule | Recorded built-in rules plan, not AI |
| 0:40–0:50 | Real Claude plan result | Unchanged earlier-interface recording, November 3 PST |
| 0:50–0:56 | Exact amount and adult consent | Recorded example contribution controls |
| 0:56–1:08 | Earlier payment verifier | Hosted-link sandbox report from November 3 PST; subsequently refunded |
| **1:08–1:36** | **Unfilmed checkout insert** | **Explicit review slate; no popup or same-order get_order shown** |
| 1:36–1:46 | Personal Manor deed | Recorded simulated $15 unlock; not PayPal evidence |
| 1:46–2:00 | Treasury, next area and receipt | Real AG Grid/Studio UI with labelled example records |
| 2:00–2:10 | APIMatic implementation | Installed-context/SDK facts; documentation slate |
| 2:10–2:22 | Connected castles and towers | Current recorded simulated progression |
| 2:22–2:32 | Night and rain | Current manual scenery controls |
| 2:32–2:42 | Public source and fresh-run route | Actual public repository; no hosted site claimed |

The [revised insert plan](demos/current-review/INSERT.md) preserves the existing rehearsal, owner data and completed order. It proposes a 28-second completed-receipt/realm segment with separately labelled historical verification evidence. It has not been recorded, rendered or inserted. The slot may expand to 40 seconds; the result would be **2:54**, still under three minutes. Missing original footage is the gap; the single checkout and necessary verification have already completed. A new approval → unlock recording would require a separately authorized sandbox checkout. The old checkout-operator assignment does not authorize another payment.

When recording/editing resumes and genuine replacement material exists, replace the slate and instructional narration/captions, record actual source ranges/hashes and update only supported claims. A completed-state segment must be described as that, with the historical same-order check labelled separately. Verify the export before the final public YouTube upload and Devpost submission. No final video has been uploaded and no entry submitted. Do not represent the review cut as completed end-to-end live evidence.