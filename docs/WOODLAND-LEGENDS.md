# Woodland legends — reference lock

Owner request, November 4, 2026: a wizard tower, a Rapunzel tower and a sword-in-the-stone Easter egg. Direct build in the existing original miniature world. Primary references: the current Rosewind/Keep geometry, woodland rivers, ivory plaques, short deeds and the owner's requested folklore. Keep the newly defined clouds and every earlier estate.

| Decision | Source and role |
| --- | --- |
| Starfall Observatory: stepped stone tower, plum roof with gilt stars/crescent, brass telescope, book stand | Existing tower/course/window vocabulary; owner's wizard tower |
| Rapunzel's Tower: tall ivory stonework, verdigris roof, flower balcony, long visibly braided golden hair | Owner's Rapunzel request; original folklore interpretation and existing botanical estate colours |
| Two eastern clearings connected by narrow tributaries and raised bridges | Owner's connected forest board, not ocean plots |
| Observatory at existing 60% home:keep; Rapunzel at existing 100% home:castle | Cosmetic companions to existing milestones; no extra payment threshold |
| Sword in a small western grove; small keyboard/touch-accessible glint focuses it | Owner's Easter egg; minimal interface and exploration |
| Discovery is camera-only, with no financial reward, server entry or new cast capacity | Existing verified-progress boundary and twenty-person court |

Use original code-native meshes/instancing and the preserved 90-colour renderer. New portraits must be actual renders with source hashes. No downloaded/branded film art, new catalogue, repeated disclaimer, paid tests or video work.

## Flowering tower vines — November 5, 2026

Direct build against the existing [Rapunzel daylight](screenshots/rapunzel-fairy.png) and [night](screenshots/rapunzel-fairy-night.png) renders, with the existing rose beds supplying the botanical colours. Current Refero Wayfinder and MekaVerse references were reviewed again: borrow only organic environmental storytelling and small details inside the world, without their interface or palette.

| Decision | Source / boundary |
| --- | --- |
| Two slender, irregular stems climb the shaft, with short upward forks and tapering leaves | Owner's lightly overgrown upward accents; leave most ivory stone exposed |
| Small pink and ivory flower clusters with gold centres | Existing balcony roses, garden beds and world palette |
| Keep windows, crest, braid, balcony and fairy readable | Existing tower silhouette; static shared mesh parts, no controls or reward changes |

Actual [tower detail](screenshots/rapunzel-vines.png), [390 px phone](screenshots/rapunzel-vines-phone.png) and [source/capture hashes](screenshots/rapunzel-vines-capture.json). Desktop/phone daylight and Night/Rain reviews passed, including rotated detail, original figures/bridges/court/access, unchanged full example household state and zero page errors, writes, outside requests or horizontal overflow. The source/art guard and final syntax/diff checks passed. The first review incorrectly compared GPU-resident geometry counts before and after rain first rendered; its failure and captures are retained in ignored `test-results/rapunzel-vines/`. The corrected final review checks the unchanged scene and household directly. No full suite, provider call, new payment or video was needed.

## Fairy and staff — November 5 reference lock

Owner request: a fairy at Rapunzel's Tower and a wizard with a readable staff carrying a small amount of magic. Direct build against the existing [Observatory](screenshots/wizard-tower.png), [Rapunzel tower](screenshots/rapunzel-tower.png) and shared miniature characters. The current world remains the primary reference. Refero research reviewed [Wayfinder](https://wayfinder.nfb.ca) for environmental storytelling and [MekaVerse](https://themekaverse.com) for tiny accents within a detailed world; borrow only those imagery roles, not their UI, fonts or palettes.

| Decision | Reference / purpose |
| --- | --- |
| Slightly larger plum-robed wizard beside the existing book stand; walnut staff, faceted cool gem and two small orbiting sparks | Existing Observatory figure and roof colours; make the owner's requested staff legible |
| One rose-and-teal fairy beside Rapunzel's balcony, four pale outlined wings, gold hair and a small star wand | Existing balcony roses, verdigris roof and original folklore figure; no branded costume |
| Short fairy swoops near the balcony, longer hovering pauses and a restrained staff spell on the existing ambient tick | Owner's magic/limited flight request; Refero motion guidance on subtlety and reduced motion |
| Keep both figures static under reduced motion, pause with existing world occlusion, rebuild without accumulating figures | Existing world lifecycle and accessibility rules |

Keep original renderer, palette, nine districts, unlock thresholds and financial data. No new panel, label, payment or provider call.

Actual renders: [wizard and staff](screenshots/wizard-staff.png), [fairy at the balcony](screenshots/rapunzel-fairy.png), [night wings](screenshots/rapunzel-fairy-night.png). [Capture source/image hashes](screenshots/tower-figures-capture.json). Both figures use shared code-native geometry/materials; the wings reuse the window glow without a new light or particle system. Find them through **Areas → Starfall Observatory** and **Areas → Rapunzel’s Tower**; View's zoom controls show their small details.

Verification used only fresh in-memory/example states. The existing desktop/phone folklore exploration cases passed, including reachable towers, raised bridges, sword discovery and unchanged progress. Final one-off desktop/phone captures verified reduced-motion stillness, day/night appearance, no horizontal overflow, no writes/outside requests or page errors. A focused normal-motion check at 1000×740 verified moving fairy/staff transforms and a pause behind an open modal. The initial normal-motion screenshot attempt at 1440×1000 timed out on software rendering and is retained separately; it is not reported as passed or a hardware performance benchmark. Evidence: ignored `test-results/fairy-wizard/` and `polished/visual-report.json`. The original-art/palette/renderer/syntax guard passed; final changed-file syntax and diff formatting also passed.

### Short flight follow-up

The fairy now makes a smooth 2.6-second balcony loop every 11 seconds, with a longer hover between loops. Its flight spans at most 3.6 units across and 2.5 units forward, with a small rise/bank; it does not circle the whole realm. The same ambient clock controls it, so reduced motion remains still and open modals pause the flight.

A focused fresh-example Chromium probe observed 44 actual normal-motion poses over about 23 seconds, including 27 poses at the resting horizontal position, multiple flight positions, rendered frames advancing and a successful modal pause. A touch-phone reduced-motion probe observed five identical positions and no ambient timer. Both had unchanged progress/contributions and no page errors, writes or outside requests. The actual in-flight canvas was inspected. Evidence: ignored `test-results/fairy-flight/{report.json,actual-flight-frame.png,reduced-phone.png}`. The 47-asset/palette/renderer/syntax guard passed; no full suite, provider call, payment or video was repeated.
