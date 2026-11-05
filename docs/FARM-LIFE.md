# Stables and small farms

The owner's existing woodland/miniature world is the primary reference: original timber cottages, colour accents, layered deer, tile seams and warm lantern glass. Add horse stables to the two grandest properties and a few farm animals to the smaller homes. The existing Refero Wayfinder reference (168f20ae-b58e-4781-b9b8-46b2d9b81b5f, https://wayfinder.nfb.ca) contributes only restraint around an illustrated landscape. No third-party art, UI, colours or fonts are imported.

| Place | Addition | Placement rule |
| --- | --- | --- |
| Royal Citadel | Cobalt-roof stable, chestnut and dapple-grey horses | East rear mews, clear of the moat, towers, arrival path and guest lane |
| Rosewind Palace | Rose-roof stable, palomino and ivory horses | East side grounds, clear of the palace, pennant and promenade |
| Hearth Village | Timber henhouse, three hens and a small goat paddock | Beside the outlying cottages, outside both traveler and visitor paths |
| Manor Gardens | Two sheep in a modest pasture | West rear lawn, clear of the fountain, flower beds and walking lanes |

Keep all earlier buildings, all nine districts/bridges, rivers, the Citadel stag, towers, clouds and family avatars. Small reserved patches remove trees/shrubs from the new plots; original forest seeds elsewhere remain fixed. Farm scenery stays visible in future districts behind their existing closed crossings. It grants no progress, membership or new rewards. The guest court stays twenty.

The stable has open upper stalls, braced half-doors, hay racks/bales, a trough, small horseshoe sign, household heraldry, slate/rose tile courses and lanterns using the existing night-glass role. Horse models have four separate hooves, tapered neck/muzzle, ears, mane/tail, leather cheek straps, bit rings and individual coat details. The henhouse has a slatted ramp, grain bowl, small egg and contrasting plumage/comb/beak details. Sheep have layered wool; the goat has small horns and a beard.

Heads graze/peck and tails flick through the existing eight-frame-per-second ambient clock. No extra timer or animal pathfinding is added. Reduced motion stays still, hidden tabs pause, and resumed farm time is capped to prevent jumps. Rebuilding clears old animal references before creating the same ten animals. Static geometry joins the existing instance batches. Nothing changes financial/provider logic or adds product text.

[Stable detail](screenshots/royal-stables.png) · [Henhouse](screenshots/village-henhouse.png) · [Actual Palace Night/Rain](screenshots/farm-palace-night-rain.png). The two detail stills render the same original farm geometry in an isolated review stage; the night still is the actual app on synthetic example data. These are visual evidence only. Source: src/world/farm-life.js and farm-locations.js.
