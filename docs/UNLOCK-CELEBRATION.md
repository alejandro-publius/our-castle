# A family moment on the existing deed

Designing the newly earned district card for families on the existing browser game. The goal is to recognize the household without adding another screen, explanation or reward rule. Direct build against the owner's compact deed and avatar references: [current card](screenshots/deed-manor-simple.png) and [owned portraits](screenshots/family-avatars.png).

## Reference lock and decisions

Primary direction: the existing Our Castle deed, ink/paper/brass tokens, bundled Uncial/Alegreya and original pixel portraits. Keep its dimensions, artwork, crest, one milestone line and actions. New-family portraits sit at the lower-left of the picture, balancing the existing crest at lower-right; no extra visible copy.

| Decision | Evidence and bounded role | Purpose |
| --- | --- | --- |
| Keep the world visible behind one earned card | Existing game; Refero [Wayfinder](https://wayfinder.nfb.ca), style `168f20ae-b58e-4781-b9b8-46b2d9b81b5f`; [MekaVerse](https://themekaverse.com), style `f5e5d282-4361-4654-aac2-c8b5cd8214b1` | Use world-first hierarchy only; import no fonts, crypto colours or dashboard chrome |
| One reward illustration with a clear way onward | Refero [Duolingo completion](https://refero.design/pages/e3237b8a-f3db-4873-bcd1-ec93452ebfc3) and [Quizlet achievement](https://refero.design/pages/e2034945-abff-49c5-992a-3678e4c26fbd) | Keep Visit/Close; omit reward paragraphs, share prompts and extra buttons |
| Chosen member portraits on a new unlock only | Owner's crest/avatar direction and supplied Our Castle art | Personal recognition, without claiming each member paid. Accessible labels identify members and selected characters |
| Suppress the parallel banner when a district deed will open | Owner's “less is more” direction; existing duplicate toast/deed behavior | One celebration for the same event |
| Short pixel-step arrival, static reduced-motion version | Refero motion craft: brief state feedback, interruptible, no repeated animation | Small acknowledgement; no particles, looping bounce, autoplay or new audio |
| Map reopens retain the original compact card | Owner's collectible-card direction | Viewing an earned deed is not another unlock or transaction |
| Pause idle rendering behind an open deed/merchant | Measured normal-motion trace and Refero motion craft's functional hierarchy | Avoid spending frames behind the modal; resume the ambient phase on close. Server-driven bridge/traveler transitions still run |

No asset generation or dependency is needed. Existing server progress, unlock thresholds, queued deeds, refunds, receipts and payment consent remain authoritative. Check actual desktop/phone cards, keyboard/focus return, reduced motion, pending/refund/re-crossing and absence of extra writes before handoff.

## Implemented and checked

The new portrait strip uses the saved member choices and adds no visible copy or height. [Current Manor card](screenshots/deed-manor-family.png) is a 388×406 capture from a fresh example household, the same dimensions as the earlier reference. It shows invented test-household choices (Wizard/Royal), not owner financial data. Map reopens keep the original face. One queued new deed still waits for the actual board transition; the duplicate banner is suppressed.

Opening a deed or merchant now pauses only ambient rendering. The visual clock excludes that covered interval on resume. Essential server-driven bridge/traveler transitions still run, including an unlock arriving while another card is open. No geometry, original renderer, palette, access rule or financial state was changed.

Recorded checks: 14 reduced-motion Chromium passes and 8 Linux WebKit passes, with two deliberately desktop-skipped phone layout variants in each run. After the idle-rendering fix, 6 normal-motion Chromium and 2 normal-motion WebKit cases passed. The pause/resume regression failed before the fix. Earlier normal-motion timeouts and the slow screenshot trace are retained in ignored `test-results/unlock-finish/`; they are not relabelled as passes. These are software-rendered browser checks, not physical-device benchmarks. Exact scope is at the top of [VALIDATION.md](VALIDATION.md).
