# Two fresh families, one shared project — November 10, 2026

Two separately signed-in families can now go from an empty Village fund to one shared project through visible controls: start or join a neighborhood, describe the project in a sentence, invite the second family, choose their own shares, and see one approved simulated contribution on both open pages. Nothing is seeded for them and nothing new was built to do it. The fund, the neighborhood invitation, the reviewed sentence draft, voluntary shares and simulated contributions already existed; this change connects them.

This stacks on the unmerged shared-fund integration ([PR #79](https://github.com/alejandro-publius/our-castle/pull/79), head `1f76ba6`). [The five-family example](VILLAGE-DEMO.md) and [the fund sheet and square](VILLAGE-SQUARE.md) describe what it connects.

## The path as it was (mapped before any edit)

Mapped at `1f76ba6` on a disposable family-mode server with two browser contexts, each with its own virtual authenticator, using only visible controls, at 1440 × 1000 and 390 × 844. No neighborhood, fund, share or receipt was seeded and no response was mocked.

| Step | What happened | Kept or changed |
| --- | --- | --- |
| Fresh family opens **Village fund** | One sentence naming Village Exchange and a single control, Close | **Changed.** A dead end |
| Start a neighborhood | Close the fund, open Village Exchange from the map, open **Your sharing & requests**, then **Start a neighborhood** | Flow kept. **Entry and return added** |
| After creating or joining | "Saved." and nothing that leads back to the fund | **Changed** |
| Describe the project in one sentence | The draft, its "built-in rules; no AI" label, the simulated label and the explicit accept all worked. A draft survived closing and reopening the fund | Kept |
| …its status line | "Saved." after a draft, although nothing is saved until it is accepted. The same after a read-only treasurer question | **Changed.** Misleading |
| …its accept button | A grey system button on the parchment | **Changed** |
| Invite the second family | Only in Village Exchange. The fund's Families view had no way there | **Entry and return added** |
| Second family joins and opens the fund | The same project appeared | Kept |
| Each family's own share | Saved. No paid progress from a promise | Kept |
| One approved simulated contribution | The other family's open page showed the new total about 0.1 s later, without a reload. One receipt, the same on both. Private savings and private contributions unchanged | Kept |
| Shared square, then **My realm** | Square and ribbon were right. Focus was left on the page body | **Changed** (focus only) |
| Escape or Close on the fund | Focus returned to the Village fund button | Kept |

## Decision ledger (written before the UI edits)

The design lock is unchanged: the existing painted parchment, forest ink, gold trim, Uncial headings and native controls ([the square's reference lock](VILLAGE-SQUARE.md#design-reference-lock), [the painted parchment revision](JOURNAL-DESIGN.md#painted-parchment-revision)). No new reference was consulted; the recorded lock and the task's craft checklist were enough for navigation links inside an existing system. No new artwork, font, colour or panel.

| Change | Why |
| --- | --- |
| Empty fund, adults only: **Start a neighborhood** and **Join with an invitation**. Each opens the existing Exchange form for exactly that, already expanded | Owner goal: reach the fund task through visible controls. Ko-fi role in the lock: one clear invitation with plain supporting copy. Existing forms and permissions, no second form |
| Village Exchange opens **over** the fund and shows **Back to the village fund** while it was opened from there. Closing it by any route returns to the fund | Owner goal: a clear return to the originating project. A stacked native dialog needs no new navigation mode, and Escape already means "back one step" |
| On return, focus goes to the next useful control: the sentence draft (opened) when there is a neighborhood and no project yet, otherwise the project | Craft: focus must land somewhere useful and visible; the control that opened the Exchange may no longer exist |
| Families view, founding family's adults only: **Invite another family** opens the existing invitation form. The adult still presses **Create invitation** and shares the code themselves | Owner goal: an obvious invitation handoff. Nothing is created or sent automatically; the existing one-family, 24-hour code and its permission are untouched |
| Status after a draft says it is ready to review and that nothing is created yet. A treasurer answer no longer says "Saved." | A status line must say what happened. Fundraiser-preview role in the lock: one decision, clearly not yet taken |
| The accept button and **Share our castle's appearance** use the paper's existing green and tan button treatments, at least 44 px tall | The lock: controls are brown ink and green/gold on parchment, never system grey. Craft: touch targets |
| After a draft is accepted, its sentence and disclosure are cleared | No stale draft left open beside the project it became |
| The eyebrow reads "No neighborhood yet" before one exists | It said "Private neighborhood" when there was none |
| **My realm** moves focus to the Village fund button | Craft: never leave focus on a control that has just been hidden |

Deliberately not changed:

- **No wizard, dashboard, new dialog or payment rail.** Every form used is the existing one.
- **Children.** They get none of the new actions. The payment, share, create and draft controls stay hidden from them as before.
- **The draft's wording.** The built-in rules title the example sentence "the class trip", in lower case. That is how the existing rules read it; the title is reviewed before it is accepted and manual creation is still there.
- **Other plain buttons inside closed disclosures** of the fund sheet (review link, local assistant, devnet watch) still use the system style. They are outside this path.
- **Scope rules.** A signed-in scope change still closes the fund and shows nothing until its own state arrives.
