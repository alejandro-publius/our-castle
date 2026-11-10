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
| Empty fund, adults only: **Start a new neighborhood** and **Join with an invitation code**. Each opens the existing Exchange form for exactly that, already expanded | Owner goal: reach the fund task through visible controls. Ko-fi role in the lock: one clear invitation with plain supporting copy. Existing forms and permissions, no second form |
| Village Exchange opens **over** the fund and shows **Back to the village fund** while it was opened from there. Closing it by any route returns to the fund | Owner goal: a clear return to the originating project. A stacked native dialog needs no new navigation mode, and Escape already means "back one step" |
| On return, focus goes to the next useful control: the sentence draft (opened) when there is a neighborhood and no project yet, otherwise the project | Craft: focus must land somewhere useful and visible; the control that opened the Exchange may no longer exist |
| Families view, founding family's adults only: **Invite a family** opens the existing invitation form. The adult still presses **Create invitation** and shares the code themselves | Owner goal: an obvious invitation handoff. Nothing is created or sent automatically; the existing one-family, 24-hour code and its permission are untouched |
| Status after a draft says it is ready to review and that nothing is created yet. A treasurer answer no longer says "Saved." | A status line must say what happened. Fundraiser-preview role in the lock: one decision, clearly not yet taken |
| The accept button and **Share our castle's appearance** use the paper's existing green and tan button treatments, at least 44 px tall | The lock: controls are brown ink and green/gold on parchment, never system grey. Craft: touch targets |
| After a draft is accepted, its sentence and disclosure are cleared | No stale draft left open beside the project it became |
| The eyebrow reads "No neighborhood yet" before one exists | It said "Private neighborhood" when there was none |
| **My realm** moves focus to the Village fund button | Craft: never leave focus on a control that has just been hidden |

Added after looking at the first rendered results at 390 px, for the same reasons:

| Change | Why |
| --- | --- |
| In Village Exchange, a new invitation code and the join confirmation scroll into view | On the narrow screen both appeared below the fold, so pressing the button seemed to do nothing |
| Reviewing an invitation says nothing is joined yet, where it said "Saved." | The same misleading status, one step earlier |
| The Exchange's plain form buttons (**Create invitation**, **Join this neighborhood**, **Cancel**, **Leave neighborhood**) use the Exchange's own tan button | They were system grey, on this path. One selector added to the existing rule; no new style |
| The fund's three new buttons are worded differently from the Exchange headings they open | An existing release test finds those headings by their text across the whole page. Distinct wording keeps that test untouched |

Deliberately not changed:

- **No wizard, dashboard, new dialog or payment rail.** Every form used is the existing one.
- **Children.** They get none of the new actions. The payment, share, create and draft controls stay hidden from them as before.
- **The draft's wording.** The built-in rules title the example sentence "the class trip", in lower case. That is how the existing rules read it; the title is reviewed before it is accepted and manual creation is still there.
- **Other plain buttons inside closed disclosures** of the fund sheet (review link, local assistant, devnet watch) still use the system style. They are outside this path.
- **Scope rules.** A signed-in scope change still closes the fund and shows nothing until its own state arrives.

## Waits on this path (mapped before the change)

Mapped on the merged first-use and dragon source, desktop and 390 px, by holding each real request for a moment with a local route and then releasing it unchanged. One save was answered with a local failure. Nothing was mocked into success.

| Wait | What was visible | Kept or changed |
| --- | --- | --- |
| Starting the app, the reload after a passkey sign-in, and a review link opened at start | The dragon scene, until the realm is ready or a dialog needs the person | Kept. This is the one place a whole view is waiting on a read |
| Opening the fund while its foreground read is slow | The project, total and controls at once, from the state already held | Kept quiet. Nothing is waiting |
| Visiting the shared square | Immediate | Kept. No pause is added |
| Background refreshes and presence heartbeats | Nothing | Kept quiet |
| Saving a share; drafting a project | "Working…" and the result, in view | Kept |
| One approved contribution | The amount and approval stay; the button dims. "Working…" and then "recorded" were **outside the visible part of the window** | **Changed** |
| A treasurer question | Nothing visible changed; "Working…" was outside the visible part | **Changed** |
| Creating a neighborhood in Village Exchange | Nothing visible changed; "Saving…" was below the fold | **Changed** |
| Reviewing an invitation | "Saving…", although nothing is being saved | **Changed** |
| A member or household change during a request | The old "Working…" stayed in the status line for the next person | **Changed** |

| Change | Why |
| --- | --- |
| Each window's one status line stays inside the visible part of the window while it has something to say: the wait, its result or its error | The existing line already says the right thing; it was simply out of sight. No second indicator, spinner, percentage or cover |
| While a window is busy, its submit buttons dim, as the kit preview and Market Town results already do | The house pattern for "this is being worked on". Nothing is disabled that was not already; the amount, approval and every record stay readable |
| The Exchange marks its own window busy, and says "Checking the invitation…" while it reviews one | Say what is happening, where it is happening |
| A member or household change clears the fund's status line | A wait or result belongs to the person who started it |

Not changed: the dragon is not shown for any of these. It covers the whole view, so it is used only when the whole view is what is waiting. No request is retried, no draft is cleared and no state changes to fill time.

## The path now

1. **Family A** signs in to a fresh household, opens **Village fund**, and chooses **Start a new neighborhood**. Village Exchange opens over the fund at that form. After **Create neighborhood**, **Back to the village fund** (or Escape, or Close) returns to the fund with the sentence draft open.
2. A describes "We need $400 for the class trip by December 12, 2026." The draft is labelled as built-in rules with no AI and as a simulated contribution type. A accepts it explicitly; only then does the project exist. Creating one by hand is still offered.
3. In **Families**, A chooses **Invite a family**, presses **Create invitation** in the Exchange and passes the code on. Opening the form creates no invitation.
4. **Family B**, a separate fresh household, opens **Village fund**, chooses **Join with an invitation code**, reviews the invitation and joins. Back at the fund, B sees the same project. A's open page lists B without a reload.
5. Each family saves its own voluntary share. The recorded total stays $0.00.
6. B approves and adds one simulated $100 contribution. Both open pages show $100.00 of $400.00, the same single receipt, and the schoolhouse moves from survey stakes to under construction, including in the square A already had open. Neither family's private savings or private contributions change.
7. **My realm** restores A's own goal and puts focus on the Village fund button. A reload keeps exactly one receipt.

To try it by hand, run the existing family mode with a new data folder (`npm run family -- --port 3200 --data <a new folder>`) and use two separate browser profiles, one per family, each with its own passkey. That by-hand route was not exercised in this work; the checks below use Chromium's virtual authenticators.

## Evidence and limits

- **The journey:** `test/e2e/village-first-use.spec.mjs`, at 1440 × 1000 and an emulated 390 × 844 phone. A disposable in-memory family-mode server with its real handlers, two browser contexts each with its own virtual authenticator, no seeded neighborhood, fund, share or receipt, and no mocked response. Requests leaving the server's origin are refused and counted (none). It also checks: one payment request, from B only; no invitation or neighborhood made by merely opening a form; 44 px controls; no page or console error; no horizontal overflow.
- **Who is offered what:** a desktop fixture case in `test/e2e/village-square.spec.mjs`. A child gets none of the new actions; only the founding family's adult gets the invitation; without the Exchange there is no action.
- **Both were broken on purpose.** Nine single changes to the production code (five to who is offered an action, four to the return, focus, stacking and draft status) each made the matching case fail at its own step.
- Both run in the existing village CI job. Results and source identifiers are in [validation](VALIDATION.md#fresh-two-family-village-journey--november-10-2026).

Limits: these are automated interaction checks with virtual authenticators and an emulated phone. They are not a playtest with people, a physical device or a screen reader. Contributions are simulated; no provider was called and no sandbox recipient or devnet wallet exists yet. The draft used the built-in rules; the optional AI drafting path was not exercised here.
