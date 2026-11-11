# Recording checklist

One page for the owner to keep open while recording the [locked 2:50 cut](SUBMISSION-SHOTLIST.md). Nothing has been recorded. Written November 10, 2026 (Pacific) against `main` at `97c084a`.

## Set up

- [ ] Record at **1920×1080**, like the existing clips, with one browser window filling the frame.
- [ ] Browser zoom **100%** (Cmd+0). Bookmarks bar hidden, no other tabs, no notifications.
- [ ] A **private window or a clean profile**, so no saved weather, time or music choice and no extension changes the page.
- [ ] **World settings → Time of day: Day**, in both sessions. Auto follows the clock, so an evening take would otherwise be a night scene in one session and not the other.
- [ ] **Weather:** pick one and set it the same way in both sessions.
- [ ] `git rev-parse --short HEAD` in the checkout you record from. Write the commit down; it goes on the end card and in the evidence note.
- [ ] Microphone test, ten seconds, played back.

## Which app

| Beat | Use | Never use |
| --- | --- | --- |
| 1, 2, 3 and the first half of 5 | `npm run demo -- --family-trip` | the saved apps on 3010 or 3021: they run an older build with no stepped release |
| 4 and the second half of 5 | `npm run demo -- --village-fund` | the family-trip session: it has no shared fund |
| 3, sandbox variant only | the recording made during the [sandbox hold run](SANDBOX-HOLD-PROOF.md) | a new sandbox hold placed just for the camera |

Before pressing record in the family-trip session: **Try a one-off expense**, `90`, **See which complete kits fit**, **Compare complete kits**.

## What must be on screen

- [ ] **Beat 1, 0:00–0:25.** The example label. **$150** and **$180**. **Your chosen kit** on the $180 kit. The stove kept.
- [ ] **Beat 2, 0:25–1:10.** `120` in **One-off amount**. The $30 shortfall. **Proposal · smallest change**, **$150**, only the tent switched. **Choose this kit**, **Review this kit**, **Save goal and propose this schedule** and **Use this plan** each pressed in view.
- [ ] **Beat 3, 1:10–1:50.** The amount. **Hold it first** ticked. The approval sentence with the same amount, ending **(simulated)** or **(test money)**. **Held — not counted**. The header amount **before** the release. The confirm button naming the release and what stays held. The header amount **after**. What is still held.
- [ ] **Beat 4, 1:50–2:30.** A visible cut and a label saying this is a second example. **$200** of **$400**, then **$240**. The schoolhouse before and after. **My realm** with the private goal still **$60.00 toward $300.00**.
- [ ] **Beat 5, 2:30–2:50.** The hold's money trail, complete and readable for two full seconds. The village's one receipt. The end card.

## Mistakes to avoid

- [ ] **Saying sandbox over example footage.** If the picture says **(simulated)** or **Simulated payments**, the narration says simulated. The word PayPal belongs only over the sandbox variant.
- [ ] **Cutting before the Ledger trail.** Beat 5 is the evidence. If time is short, shorten the square visit in beat 4.
- [ ] **Running past 2:55.** The limit is three minutes; the target is 2:50.
- [ ] **Cutting an approval.** Every tick and every confirm press stays in, at normal speed. Trim waiting only.
- [ ] **Hiding a label.** The example, simulated and sandbox labels stay readable; do not crop or zoom them out of frame.
- [ ] **Mixing the three goals.** The repaired $150 goal, the village's $400 fund and the sandbox run's $300 goal are separate scenarios. Their totals are not meant to agree, and each needs its label.
- [ ] **Using a screenshot as footage.** The reference frames in the shot list are for framing only.
- [ ] **Recording the saved apps**, or showing a sign-in, an account email, an order identifier you would not publish, or the private configuration file.
- [ ] **Staging the loading scene.** If the knight and dragon appear, keep them as they happened.

## Before upload

- [ ] Watch the whole export once with sound. Length under 2:55.
- [ ] Every sentence of narration is true of the picture under it.
- [ ] Captions, if any, match the narration.

## Afterwards

- [ ] Keep the export and raw takes under `test-results/final-video/` in that checkout. The folder is ignored by Git, so nothing is published by accident.
- [ ] Upload to YouTube yourself, publicly visible. No assistant uploads or submits.
- [ ] If the file is committed, give it its own folder under `docs/demos/` and a provenance entry in [docs/demos/README.md](demos/README.md): length, format, size, SHA-256 (`shasum -a 256 <file>`) and the commit it was recorded from.
- [ ] Add the one-line evidence note to [docs/demos/README.md](demos/README.md), filled in:

  > Final demonstration: __:__ long, recorded November __, 2026 from `main` at `_______` in the two example sessions (`--family-trip`, `--village-fund`); beat 3 is [simulated / the real sandbox hold of November __]. SHA-256 `____`. YouTube: ____.

- [ ] Put the same YouTube address in [the entry copy](SUBMISSION-DRAFT.md#submission-fields-still-to-supply) and in [the Devpost draft](DEVPOST-DRAFT.md).
