# Locked demonstration cut: 2:50, one family, then one village — not recorded

Locked November 10, 2026 (Pacific) against `main` at `97c084a`, for the owner's review. This is the plan for the owner's recording. Recording stays paused until the owner resumes it; no media was created or changed for this update. It replaces the earlier 2:55 proposal, which remains in Git history. The preserved 2:42 review cut is unchanged below.

**Corrected November 11.** A browser test now presses session 1 in this order and checks session 2's wording ([#95](https://github.com/alejandro-publius/our-castle/pull/95), `test/e2e/submission-walkthrough.spec.mjs`). It found three errors in the first version of this cut, fixed below: the release in beat 3 is $30.00, not $15.00; the kit labels come from **Preview on map**, which was missing; and the village's Records list holds five receipts, not one.

Keep the [recording checklist](VIDEO-CHECKLIST.md) open during the take.

## Sessions

Both example sessions run current `main`. Do not record the saved apps on 3010 or 3021: they run an older build with no stepped release.

1. **One family** — the [playable family-trip example](FAMILY-TRIP-EXAMPLE.md), `npm run demo -- --family-trip`. Beats 1 to 3 and the first half of beat 5.
2. **One village** — the [five-family shared fund](VILLAGE-DEMO.md), `npm run demo -- --village-fund`. Beat 4 and the second half of beat 5. The cut between the two sessions must be visible and labelled.
3. **Only if it exists** — the screen recording of the [real sandbox hold run](SANDBOX-HOLD-PROOF.md). It replaces the picture of beat 3; see [the sandbox variant](#beat-3-the-sandbox-variant).

**Before pressing record in session 1:** choose **Try a one-off expense**, type `90`, choose **See which complete kits fit**, then **Compare complete kits**. The take starts with the $150 and $180 kits already on screen, and the narration says the comparison was run.

## The cut

| Time | Do, on screen | Must be readable | Boundary |
| --- | --- | --- | --- |
| **1.** 0:00–0:25 | The woodland for a few seconds, then the kit list and the two kits. **Choose this kit** on the $180 kit. **Keep stove as it is**. **Preview on map** on that kit. | The example label; **$150** and **$180**; the map caption **Your chosen kit · $180.00**; the stove marked as kept | Invented family, sample prices, tax and shipping excluded. If the knight-and-dragon loading scene appears, keep it as it happened. |
| **2.** 0:25–1:10 | Change **One-off amount** to `120`. The chosen kit is now $30 short by the date. The map caption becomes **Proposal · smallest change · $150.00**, and the list shows one kit, marked **Smallest change**, that switches only the tent. **Choose this kit** on that repair, **Review this kit**, **Save goal and propose this schedule**, **Use this plan**. | `120`; **$30.00 short by then** under the chosen kit; **Proposal · smallest change · $150.00**; the tent line switched, the stove kept; each save pressed in view; the button ends as **Plan in use ✓** | No catalogue or model call, and no payment. Trying the expense saved nothing; the adult's presses did. |
| **3.** 1:10–1:50 | **Contribute**: amount `40.00`, tick **Hold it first**, tick **I approve holding $40.00 USD (simulated).**, **Simulate approved hold**. Pause on the header: unchanged. **Ledger**: the record reads **Held — not counted**. **Simulate release…**, type `30.00` (with the $150 goal saved, the header reads **Next: Keep · $30.00 to go**), tick **Keep the rest held for a later release**, press **Confirm release of $30.00, keep $10.00 held**. The header moves to $90.00, and the Stone Keep and the Starfall Observatory open. | **(simulated)**; **Held**; the header at **$60.00** before the release and **$90.00** after it; **$10.00 is still held** | Simulated money, no PayPal request. Nothing may be said about PayPal in this beat unless the sandbox variant is used. |
| **4.** 1:50–2:30 | **Visible cut, labelled as a second example.** **Class trip together** at $200 of $400. Enter `40`, tick the approval for that exact amount, contribute. The shared total becomes $240 and the schoolhouse reaches its second stage. **Visit the shared square**, briefly, then **My realm**: the family's own goal is still $60.00 toward $300.00. | **$200** then **$240** of **$400**; the schoolhouse before and after; the private **$60.00 toward $300.00** unchanged | Five invented families, simulated money. The schoolhouse shows funding progress, not a purchased trip or building. No recipient-bound PayPal payment or PYUSD observation is shown; both are fake-transport tested only. Seeded family names are not online visitors. |
| **5.** 2:30–2:50 | Session 1's Ledger record with its money trail (record this at the end of beat 3 and place it here). Then session 2's **Records**: five receipts, the four $50.00 ones the example starts with and the new **+$40.00** one last. End card: the repository address, the two commands and the commit recorded. The repository's own page on GitHub can serve as that card, with no editing: its first screen shows the address, the status badges and the command. | **Held $40.00 → Released $30.00 → $10.00 still held**; the new **+$40.00** village receipt; the simulated tags on both | These are records of goal progress, not a bank balance. |

**For the sponsor judges:** in beat 5 the Ledger is already open. Keep its records table and its next-area plaque in frame for two seconds and name them: the table is AG Grid and the plaque is AG Studio. Channel3 cannot be shown in a keyless example, whose listings are invented and say so; it is described in the entry text.

The time ranges are editing targets, not a measured walkthrough. Hard stop at 2:55. If a take runs long, shorten the square visit in beat 4 before cutting an approval, a confirm press or a label.

### Beat 3, the sandbox variant

Use it only if the [sandbox hold run](SANDBOX-HOLD-PROOF.md) went exactly as written and its screen was recorded. Then beat 3's picture is that recording: steps 3 to 5 of the runbook (hold $25.00, **Held — not counted** at $60.00, release $15.00 keeping $10.00 held, the Manor raised at $75.00), and beat 5 opens with its finished trail, **Held $25.00 → Released $15.00 → Returned $10.00**.

- Label it on screen for its whole length: **PayPal sandbox · test money · separate session, new household**. It is a third session, not the family from beats 1 and 2.
- Trim waiting time only. Never cut the approval tick, the PayPal approval or the confirm press.
- Without that recording, record the simulated beat above and say simulated. A screenshot from the run is not footage of it.

## Narration

A script for the take, not recorded narration. Leave pauses for the controls and their results.

**0:00–0:25:** “An unexpected expense should not mean starting the family trip over. This is an example family with sample prices. With a ninety-dollar expense, two complete kits fit: a hundred fifty dollars, or a hundred eighty for less weight. They choose the lighter kit and keep the stove.”

**0:25–1:10:** “Then the expense grows to a hundred twenty. The chosen kit is now thirty dollars short by the date. Our Castle does not start over. It proposes the smallest change: switch only the tent, keep the stove, and the kit is a hundred fifty again. An adult accepts that repair, reviews it, saves the goal and accepts the schedule. Trying the expense committed the family to nothing.”

**1:10–1:50, simulated:** “Now a contribution. An adult can hold it first. Forty simulated dollars are held, and nothing counts: the goal has not moved. Later an adult releases exactly thirty and keeps ten held. Only now does the goal move, and the world with it.”

**1:10–1:50, sandbox variant:** “Now a contribution, in a separate session against the PayPal sandbox, with test money. An adult holds twenty-five dollars. PayPal authorizes it, and nothing counts. Then the adult releases exactly fifteen and keeps ten held. Only now does the goal move, and the Manor is raised. The last ten dollars are returned.”

**1:50–2:30:** “Some goals are bigger than one household. In this second example, five invented families share a class trip fund, at two hundred of four hundred dollars. An adult approves exactly forty. Those dollars count once, for the shared fund: two hundred forty, and the schoolhouse reaches its next stage. This family's own goal has not moved.”

**2:30–2:50:** “Every step leaves a record. The hold shows its trail: held, released, and what is still held. The village shows the new receipt beside the four it started with. Families decide; the castle makes their progress visible. Our Castle.”

For the sandbox variant, the last beat's second sentence becomes: “The hold shows its trail: held, released, returned.”

## Left out of this cut

These stay in the [entry text](SUBMISSION-DRAFT.md) with their evidence, and are not shown:

- the historical live Claude planner clip from November 3 and the preserved in-app $15 sandbox capture;
- the Treasury and Studio widgets beyond the Ledger record, and the integration roles;
- [two fresh signed-in families](VILLAGE-FIRST-USE.md) starting a neighborhood, which needs passkeys in two browsers;
- photo reading, Cohere ordering, the Village Exchange, PYUSD and the assistant bridge;
- extending a hold, which cannot be reached within one take.

## Reference frames

Existing captures that show what each beat should look like. They are references for framing, not substitute footage.

- **Beats 1 and 2:** [the two kits compared](screenshots/family-trip-desktop-comparison.png) and [the smallest change](screenshots/family-trip-desktop-repair.png), with [the plan on the map](screenshots/kit-preview-desktop-repair.png).
- **Beat 3:** [Hold it first](screenshots/payment-holds-1-hold-it-first.jpg), [partly released](screenshots/payment-holds-2-partly-released.jpg) and [the finished trail](screenshots/payment-holds-3-trail.jpg). These are simulated holds in example mode.
- **Beat 4:** [the fund's sheet](screenshots/village-fund-desktop-sheet.jpg) and [the shared square](screenshots/village-fund-desktop-square.png).
- **Loading scene:** [how it behaves](DRAGON-LOADING.md). It appears only while startup is still pending after 120 ms; a fast machine may never show it. Do not stage, slow or lengthen it.

[Official rules](https://paypalaihackathon.devpost.com/rules), rechecked November 10 UTC, equally weight implementation, design, impact, innovation and presentation. They allow a runnable local build and call for a publicly visible YouTube demonstration under three minutes. The deadline is November 12 at noon Pacific. This plan does not establish a ranking or prize ceiling.

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