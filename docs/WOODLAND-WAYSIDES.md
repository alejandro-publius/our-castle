# Small discoveries along the wayside

Five restrained additions extend the existing woodland miniature style:

- **Woodcutter’s shelter**, north of Woodland Garden: an open timber store with a slate roof, stacked logs, a handcart and an axe resting in a chopping block.
- **Mounted banner-bearer**, between the shelter and the Sword in the Stone: one armored rider on a bay horse, carrying a small blue-and-gold pennant.
- **Wayfarer’s well**, southwest of Hearth Village: a roofed stone well, bucket, drinking trough and a wooden signpost.
- **Fallen oak**, beside the village’s northern walking route, and **fallen birch**, west of the Keep’s approach: short trunks, cut ends, stumps and fern fronds, with the traveled path left open.

## Outer meadows

Four of the twelve empty frontier meadows now hold one miniature each, built the same way and from the same palette:

- **Tourney field**, front meadow south of Market Town: a tilt rail, red and blue striped pavilions with small pennants, a quintain, a shield rack and two benches.
- **Hay meadow**, front meadow south of Hearth Village: three haystacks, rows of sheaves, a scarecrow and a split-rail fence.
- **Standing stones**, front-right meadow: nine weathered uprights, one pair still carrying its lintel, around a low altar.
- **Border watchtower**, east meadow: the estates' existing round tower with a blue banner inside a ring of stakes.

The other eight meadows, including the Family Campsite's, stayed as they were until November 12.

### More of the border — November 12

The owner asked for more to look at in the outer squares, without any new property to unlock. Six more meadows now hold a miniature, each scenery only:

- **Shepherd's fold**, rear-left meadow: a dry-stone ring with a hurdle gate, a hut, a trough and six sheep.
- **Apple orchard**, rear meadow below the PayPal sign: two rows of trees, a picking ladder, baskets and three straw skeps.
- **Archery range**, rear meadow north of the Citadel: three straw targets, a chalk line, a bow rack and spare bales.
- **Ruined chapel**, rear-right meadow: a standing gable with its window, stepped side walls, one fallen column and ivy.
- **Pond**, west meadow: a stone rim, a jetty and skiff, reeds, lily pads, two ducks and a shade tree.
- **Windmill**, east meadow: a stone tower mill with a red cap and four lattice sails, a millstone and grain sacks.

The mountain slopes between them carry more highland pines and some grey outcrops (thirteen places tried on each peak instead of five; the first five are where they were). The front-left meadow stays empty because Snow puts the decorated tree there, and the Family Campsite keeps its own.

None of these moves: the three pennants are still the only live parts, so the motion and reduced-motion checks are unchanged. Checked with the placement unit test (every footprint on level dry land, clear of paths, bridges and homes), the three desktop woodland browser cases, and by looking at clear and snow renders: [the realm](screenshots/realm-clear-desktop.png), [fold, pond and orchard](screenshots/meadow-north.png), [windmill](screenshots/meadow-windmill.png), [chapel](screenshots/meadow-chapel.png). Not checked on a phone or a slow device.

Actual daytime renders from the example game: [tourney field](screenshots/meadow-tourney.png), [hay meadow](screenshots/meadow-hay.png), [standing stones](screenshots/meadow-stones.png), [watchtower](screenshots/meadow-watchtower.png).

Use the compass to explore near these places. They add no marker, task, district, unlock or financial state. Their locations are deterministic; trees leave a small opening around each miniature. The existing estate roof, well and shield builders and farm-horse proportions anchor the art direction. No imported artwork, texture or palette replacement is involved.

Static geometry shares the existing instance batches. The single pennant uses the existing ambient clock and remains still when motion is reduced, the page is hidden, or the scene is covered; it creates no timer of its own. The scenery is built once with the woodland, independently of household progress.

The affected checks cover dry and level foundations, clearance from routes and bridge approaches, motion preferences, geometry reuse and the scene lifecycle. These are local example/browser checks, not physical-device or performance claims. Raw local visual evidence stays in ignored `test-results/medieval-details/`.
