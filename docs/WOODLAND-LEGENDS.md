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

## Fairy and staff — November 5 reference lock

Owner request: a fairy at Rapunzel's Tower and a wizard with a readable staff carrying a small amount of magic. Direct build against the existing [Observatory](screenshots/wizard-tower.png), [Rapunzel tower](screenshots/rapunzel-tower.png) and shared miniature characters. The current world remains the primary reference. Refero research reviewed [Wayfinder](https://wayfinder.nfb.ca) for environmental storytelling and [MekaVerse](https://themekaverse.com) for tiny accents within a detailed world; borrow only those imagery roles, not their UI, fonts or palettes.

| Decision | Reference / purpose |
| --- | --- |
| Slightly larger plum-robed wizard beside the existing book stand; walnut staff, faceted cool gem and two small orbiting sparks | Existing Observatory figure and roof colours; make the owner's requested staff legible |
| One rose-and-teal fairy beside Rapunzel's balcony, four pale outlined wings, gold hair and a small star wand | Existing balcony roses, verdigris roof and original folklore figure; no branded costume |
| Gentle hover/wing motion and a restrained staff spell on the existing ambient tick | Owner's magic request; Refero motion guidance on subtlety and reduced motion |
| Keep both figures static under reduced motion, pause with existing world occlusion, rebuild without accumulating figures | Existing world lifecycle and accessibility rules |

Keep original renderer, palette, nine districts, unlock thresholds and financial data. No new panel, label, payment or provider call.

Actual renders: [wizard and staff](screenshots/wizard-staff.png), [fairy at the balcony](screenshots/rapunzel-fairy.png), [night wings](screenshots/rapunzel-fairy-night.png). [Capture source/image hashes](screenshots/tower-figures-capture.json). Both figures use shared code-native geometry/materials; the wings reuse the window glow without a new light or particle system. Find them through **Areas → Starfall Observatory** and **Areas → Rapunzel’s Tower**; View's zoom controls show their small details.

Verification used only fresh in-memory/example states. The existing desktop/phone folklore exploration cases passed, including reachable towers, raised bridges, sword discovery and unchanged progress. Final one-off desktop/phone captures verified reduced-motion stillness, day/night appearance, no horizontal overflow, no writes/outside requests or page errors. A focused normal-motion check at 1000×740 verified moving fairy/staff transforms and a pause behind an open modal. The initial normal-motion screenshot attempt at 1440×1000 timed out on software rendering and is retained separately; it is not reported as passed or a hardware performance benchmark. Evidence: ignored `test-results/fairy-wizard/` and `polished/visual-report.json`. The original-art/palette/renderer/syntax guard passed; final changed-file syntax and diff formatting also passed.
