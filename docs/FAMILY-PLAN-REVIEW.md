# Family planning: remaining work and interface lock

Integrated work, November 6, 2026:

| Owner | Work | Finish line |
| --- | --- | --- |
| Rachel, PR #8 | Living campsite, its Plan entry and phone access | A family can find the project and see its stages follow existing progress; current Treasury stays working |
| Existing owner Claude, merged [PR #9](https://github.com/alejandro-publius/our-castle/pull/9) | Stale-proposal protection and affordable remaining-plan arithmetic | Fresh server facts, read-only calculation, explicit review, scoped fake-provider regressions and a pushed PR |
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


## Implemented behavior

**Check schedule** uses the existing amount/date fields and the server's read-only remaining-plan endpoint. A result is one sentence; its dates open on request. It neither invokes the model nor saves a goal, plan, contribution or achievement. **Try [date]** fills that date, retains the chosen amount and leaves **Make a plan** as the explicit next step. The existing source badge adds **in use** for the accepted schedule so it stays distinct from the calculation above it. A zero budget produces no invented completion date; a horizon beyond 52 weeks reports that limit. The finish shown comes from the returned schedule, not the earliest date theoretically possible at its budget ceiling.

Typing cancels or invalidates an older calculation. When the server's goal/progress no longer matches the displayed records, **Load latest goal** reads local state once and retains the amount/date and optional bill rows currently being tried, including edits made while that read is pending. Untouched goal facts, saved weekly amount and saved date refresh; a newly typed goal name or selected market draft is retained. Stale proposals cannot be used or edited; the UI reads the latest records once and directs the family to make a fresh plan. A newly received contribution can also show its actual unlock deed; closing it returns to the planning action. Accepted plans retain their historical schedule.

Enter in the weekly-amount/date fields runs the same read-only check. Only an explicit Make-plan action can save the settings and invoke the configured planner. Selecting a market draft immediately removes the previous goal's calculation and disables the check until the draft is saved or discarded. A market draft selected while a goal refresh is pending remains intact. Refused schedule edits retain their values and show one error sentence. Enter while a market draft is pending points back to its save/discard decision; that guidance clears when the draft ends.

## Independent review and corrections

The existing owner Claude session reviewed pushed `86dfcac` in a separate clean Mac worktree, without keys or owner-data links. It reproduced three issues on synthetic records: implicit Enter submitted the planner; loading newer facts discarded unsaved bill rows; and a selected market draft retained the old goal's calculation. It also reproduced a repeated invalid-edit message. The corrections above address all four, with focused regressions against the actual local server. Scripted model and Channel3 transports are explicitly fake; checking an amount/date makes no model call and changes no application-table row. The full report and reproduction observations remain ignored at `~/projects/our-castle-plan-ui-review/test-results/codex-ui-review/`.

A follow-up at `dc1a786` reproduced a further case: an untouched saved weekly amount stayed stale through refresh and could overwrite another member's newer choice. The refresh now compares each form value with both its old saved value and the value at request start: untouched fields update, trial values and edits during the read remain. New desktop/phone cases cover both untouched and chosen-amount paths through explicit plan creation. The smaller Enter-during-draft feedback issue is also corrected. Adding that feedback exposed one stale-message-on-discard failure; clearing on both transitions into and out of a draft fixes it. The follow-up report and reproduction remain beside the original report in ignored `FOLLOW-UP.md` and `followup/`.

Claude separately ran the existing normal-motion desktop campsite case once on the Mac: it passed in 44.2 seconds, with smoke/fire coordinate assertions unchanged. This used fresh keyless example data, headless Chromium and software WebGL, not the owner household or a physical-device/performance test. All recorded smoke reads stayed within 0.34 units of their own fire in x/z. Its images, trace and hashes are listed in that report.

Campsite review reproduced smoke drifting around the meadow origin although the fire sits 4.3 units away. Anchoring smoke to the fire fixes it. The isolated native-Three model regression fails with a 4.05-unit offset on the old tick and checks both furnished/gathering rebuilds after the correction. It uses no-op geometry builders, so this is positional-model evidence, not a software WebGL performance claim.

## Inspected interface

[Desktop](screenshots/family-plan-desktop.png) · [390 px touch-phone](screenshots/family-plan-phone.png) · [image provenance and hashes](screenshots/family-plan-sources.json). These are the actual Plan form after a read-only check on synthetic example records, with its accepted built-in plan still in use. The date list is closed. The phone journal scrolls; the page has no horizontal overflow. Neither capture is payment, physical-device or user-research evidence.

## Focused integration results

32 unit cases passed; four date-sensitive backend cases also passed under America/Los_Angeles. Desktop/phone runs passed 22 Plan UI cases, two full connected-family journeys, four campsite stage/visit cases and two native-Three positional cases. The separate Mac normal-motion desktop case passed once. The 47-file/palette/renderer/syntax guard and diff checks passed. No full suite or paid/live provider operation was rerun. [Exact runs, initial failures and limits](VALIDATION.md#family-planning-integration-review--november-6-utc-2026).
