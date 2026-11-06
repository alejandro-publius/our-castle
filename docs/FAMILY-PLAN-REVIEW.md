# Family planning: remaining work and interface lock

Current parallel work, November 6, 2026:

| Owner | Work | Finish line |
| --- | --- | --- |
| Rachel, PR #8 | Living campsite, its Plan entry and phone access | A family can find the project and see its stages follow existing progress; current Treasury stays working |
| Existing owner Claude, `claude/remaining-plan-revision` | Stale-proposal protection and affordable remaining-plan arithmetic | Fresh server facts, read-only calculation, explicit review, scoped fake-provider regressions and a pushed PR |
| Codex, `feature/family-plan-review` | Compact planning controls and integration review | Try an amount/date before saving, inspect the result, deliberately choose a later date, and recover stale records without losing those choices |

The product journey is one shared goal: choose an item if useful, review an affordable plan, approve each contribution, see the project develop, and find its receipt. Each piece must work together in the existing journal. None of the work authorizes another payment, paid model/search call, recording, deployment or submission. Preserve the owner household and completed 3021 rehearsal.

## Reference lock, before implementation

Primary target: the current Our Castle Plan form, existing Uncial/Alegreya typography, parchment, brass actions, 44 px controls and the owner's repeated request for less text. Retain all nine districts, original rendering and the world beside the journal. [Existing interface decisions](INTERFACE-DIRECTION.md).

Live Refero research rechecked the established [Wayfinder style](https://wayfinder.nfb.ca) (`168f20ae-b58e-4781-b9b8-46b2d9b81b5f`) and [MekaVerse style](https://themekaverse.com) (`f5e5d282-4361-4654-aac2-c8b5cd8214b1`). Borrow only their lightweight secondary controls; keep Our Castle's own colors, fonts and artwork. The [Monarch target form](https://refero.design/pages/f569071e-30ac-4704-b2c3-0d592335ecf2) and [allocation form](https://refero.design/pages/549c57af-76c9-4fd9-914d-83228756cf46) place editable amounts beside the goal and make continuing an explicit choice. Borrow that relationship, without their onboarding wizard, account connections, orange branding or dashboard.

| Decision | Source and purpose |
| --- | --- |
| Reuse the existing weekly/date fields | Current Plan + Monarch's direct amount editing; avoid duplicate inputs |
| One quiet **Check schedule** action | Our Castle text actions + world-first references; calculate without saving or calling AI |
| One outcome sentence; dates open on request | Owner's restraint + existing Plan details; leave the accepted schedule visible and unchanged |
| **Try [later date]** only when supported by the calculation | Explicit choice; fill the form without saving, increasing the weekly amount or moving money |
| Fresh local state after a stale response, retaining the chosen weekly amount/date | Existing Merchant recovery pattern; do not silently discard a family's choices |
| Errors beside the action, no repeated general notice | Existing form statuses and the owner's single-footer-notice rule |

No new artwork, typography, theme, financial dashboard or standalone planning screen. Family-facing copy does not use backend labels such as “preview” or display model names. Actual integration and checks are recorded when the combined slice is tested.
