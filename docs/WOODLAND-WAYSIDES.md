# Small discoveries along the wayside

Five restrained additions extend the existing woodland miniature style:

- **Woodcutter’s shelter**, north of Woodland Garden: an open timber store with a slate roof, stacked logs, a handcart and an axe resting in a chopping block.
- **Mounted banner-bearer**, between the shelter and the Sword in the Stone: one armored rider on a bay horse, carrying a small blue-and-gold pennant.
- **Wayfarer’s well**, southwest of Hearth Village: a roofed stone well, bucket, drinking trough and a wooden signpost.
- **Fallen oak**, beside the village’s northern walking route, and **fallen birch**, west of the Keep’s approach: short trunks, cut ends, stumps and fern fronds, with the traveled path left open.

Use the compass to explore near these places. They add no marker, task, district, unlock or financial state. Their locations are deterministic; trees leave a small opening around each miniature. The existing estate roof, well and shield builders and farm-horse proportions anchor the art direction. No imported artwork, texture or palette replacement is involved.

Static geometry shares the existing instance batches. The single pennant uses the existing ambient clock and remains still when motion is reduced, the page is hidden, or the scene is covered; it creates no timer of its own. The scenery is built once with the woodland, independently of household progress.

The affected checks cover dry and level foundations, clearance from routes and bridge approaches, motion preferences, geometry reuse and the scene lifecycle. These are local example/browser checks, not physical-device or performance claims. Raw local visual evidence stays in ignored `test-results/medieval-details/`.
