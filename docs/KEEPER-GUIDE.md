# The castle keeper

Moss, the castle keeper, gives an optional eight-step tour of the example demo in a dialogue box at the bottom of the screen. The order is Welcome, then House and crest, Plan, adult-approved Contribute, Treasury receipts, the compass and the optional Sound button, and finally a close.

There are two ways in: a small **Meet the Keeper** link at the top of Journal → House, or `?tour=1` on a fresh demo. Both appear only while payments are simulated, so the real sandbox flow never shows the tour.

Moss is an original character, with no characters, text or assets from any existing game. The portrait is the bundled original `assets/member-avatars/wizard.png`, shown unchanged; its provenance is in `assets/member-avatars/provenance.json`.

**Reference lock.** The owner's reference is a top-down handheld RPG with a wide, two-line NPC dialogue box at the bottom. Over the existing woodland and parchment system, the tour keeps:
- the existing tokens: `--paper` `#ecdfbd`, `--ink` `#382f25` and `--brass` `#e3ba72`;
- Uncial for the speaker's name and Alegreya for the text;
- thin, squared trim.

Codex's bounded Refero research supplied these pattern references, and no paid visual tools were used:
- [Duolingo](https://refero.design/pages/a6439332-6945-4ca3-ad43-f4cedabd80a2): a named, friendly speaker, a short greeting and one continue action. None of its palette or type was used.
- [Tango](https://refero.design/pages/8a3b9459-7662-42c7-b8e1-2f03b96dd21c): one relevant cue at a time, with no dark backdrop.
- [Brilliant](https://refero.design/flows/4352): an optional short explanation, Next or Done, and a clear way out. It adds no XP, leaderboard or spending pressure.
- [Wayfinder](https://wayfinder.nfb.ca): restrained story-over-scene chrome, without its colours.

| Decision | Source | Boundary |
| --- | --- | --- |
| A bottom dialogue box with one small portrait, the speaker's name, the step text, Back/Next and Skip; Done on the last step | Owner's handheld-RPG reference; Duolingo and Brilliant patterns | An authored script, not an AI chat box. No model, prompt or agent tool |
| Over the map on desktop, lifted above the map's footer and clear of the journal. Docked to the bottom of the screen on phones, with its measured height reserved below the page | The existing layout: a world column plus journal on desktop; one scrolling column on phones | Never covers a field, approval or contribute control. No hard-coded spacer, no sideways scrolling |
| `wizard.png` rather than `merlin.png` | Inspected both. The 96×96 pixel head-and-shoulders portrait reads at 96 px on desktop and 48 px on phones (whole-number scales) and matches the pixel UI. `merlin.png` is a full-body 480×560 render that becomes too small | Bytes unchanged. A family member can also choose the wizard avatar, so the box names the speaker: "Moss, castle keeper" |
| Next shows a journal tab through the page's own navigation; one dashed cue marks the control a step is about | Tango's one cue at a time; existing `selectTab` and `setJournalOpen` | Never presses, fills or ticks a control. No server or provider call, record change or saved preference. Drafts, the selected receipt and an amount approval stay as they were |
| Native `type="button"` controls; only Escape, inside the keeper, is its own key; focus returns to the opener | Existing dialog and journal patterns | Enter and Space stay with the focused control, so a form is never submitted through the keeper |
| Pauses while any existing modal `<dialog>` card is open (a deed, the merchant, family sign-in), and comes back without taking focus | Existing modal cards; tested with a deed | No dimming, new screen, currency, celebration, reward, or progress that looks like financial progress |
| A short fade only when motion is welcome | Existing reduced-motion handling | No typewriter, so no character-by-character announcements. The step text is a polite live region |

**What the keeper may do.** `src/app/keeper.js` receives five callbacks from `main.js`:
- **three readers:** whether payments are simulated, the current tab, and whether the journal is open;
- **two navigation callbacks:** show a tab, and close the journal. Neither moves focus or saves a preference.

`test/unit/keeper-guide.test.mjs` is a narrow source guard. It finds no direct fetch, API, click, submit, checkbox or value assignment, event-dispatch or storage call in the module's source, and checks that its three buttons are `type="button"`. A pattern check like this cannot prove every possible behavior. It complements the browser evidence, which records the actual zero writes and outside requests across the real tour. `test/e2e/keeper.spec.mjs` drives the real page on desktop and a 390 px phone and checks:
- the whole tour over a pre-approved Contribute form, with no write or outside request, and with drafts, amount, approval and progress unchanged;
- keys and reduced motion;
- `?tour=1`, Skip and replay;
- a deed card putting the keeper aside;
- the layout and overlap.

**Screenshots** (actual captures with their source and image hashes in [keeper-sources.json](screenshots/keeper-sources.json)):
- [desktop, step 1](screenshots/keeper-desktop-welcome.png);
- [desktop, Contribute](screenshots/keeper-desktop-contribute.png);
- [phone, step 1](screenshots/keeper-phone-welcome.png);
- [phone, Contribute](screenshots/keeper-phone-contribute.png).

**Limits.**
- **No real people or devices:** these are automated Chromium checks with phone emulation. There has been no human playtest, physical phone, Safari or screen-reader session. Long step text wraps to four lines on a 390 px phone, and the reserved space follows it.
- **Menus:** the keeper pauses only for modal cards. On desktop the HUD menus open above it; on phones the docked keeper stays on top and the menus scroll within the map. Only the deed card's pause was exercised; the merchant and sign-in cards use the same `<dialog>` mechanism.
- **Example demo only:** in sandbox mode the entry is hidden and `?tour=1` does nothing.
