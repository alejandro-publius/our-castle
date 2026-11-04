# Art direction — preserve this visual family

This is a direct continuation of the user's original Tiny Castle / Crown & Dust art, adapted to their new woodland household-board concept. Open the files below. Text alone is not an adequate visual reference.

## Primary references

- `references/images/our-house-cottage.png`, `our-house-castle.png` and `our-house-mobile.png`: actual rendered captures of this new starter. These establish the transfer of the art family, not a finished financial UI.
- `references/images/pixel-battlefield.png`: original native 3D island, orthographic scale, terrain edge, trees and stone architecture.
- `references/images/color-and-heraldry.png`: vivid enamel colors, dark contours, gold double frames, heraldic motifs, parchment and lettering. Borrow the craft, not the RPS labels or five-card combat hand.
- `references/images/mountain-world.png`: richer original landscape detail and stone structures.
- `references/images/phone-reference.png`: the existing font/contrast family at phone scale; adapt layout to this new product.
- `references/images/knight-concept.png` and `parchment-concept.png`: the user's original approved miniature/material direction.
- `art-preview.html`: runnable original woodland-board / castle-tier starting scene.
- `references/pixel-rendering-study.html`: original working raw/pixel comparison, outlines/dither and palette renderer. Its older navigation is historical reference only.

## Reference lock

Primary: Tiny Castle's toy-scale native 3D world and heraldic materials. Preserve orthographic depth, chunky silhouettes, readable colored surfaces, dark contour separation, warm gold, parchment control surfaces, and the display/body font pair. Use a scenic board route with a home at its center, little deer, layered trees, plants, water and villages. The board is the hero view, with goal/actions around its edges.

Borrow from Hollybrook Open only the user-described rendering principles: native procedural 3D drawn small, depth outlines, dither and palette quantization. Its source was never supplied or copied. Nightshoal is a reference for layered progression/exploration, not an asset or code source. Monopoly is a high-level board-journey analogy, not a source for its logos, mascots, cards or exact board.

Original bounded craft references from the earlier project: Haley Park (https://haleys.design) supplied manuscript ornament principles; Yellowbird (https://yellowbirdfoods.com) supplied only saturated fills with clear dark separation. Do not import their page layouts or palettes.

## Tokens and roles

| Role | Commitment |
| --- | --- |
| Main shell | Dark teal `#101c22` / `#142c34`, ivory text `#f6eddb` |
| Functional panels | Parchment `#ecdfbd`, ink `#382f25`, fine brass borders |
| Trim and primary actions | Warm brass `#e3ba72`, modeled gold `#DDBA79` |
| Heraldic accents | Crimson `#9D3E46`, cobalt `#355F93`, emerald `#527557`, violet `#777099` |
| Nature | Moss `#425B47`, leaf `#86A56C`, warm timber `#65402E`, cool stone `#7E8E86` |
| Headlines | Actual bundled Uncial Antiqua, used sparingly |
| Amounts, actions and reading | Actual bundled Alegreya Sans; keep amounts as real readable HTML |
| 3D finish | Actual 90-color palette, orthographic camera, 2–3 pixel render scale, depth outlines and mild Bayer dither |

## New world vocabulary

Use the original code-native board/island vocabulary for layered grass, earth/stone sides, rounded tree canopies, conifers, wooden bridges, rocks, flowers, antlered deer and colorful roof tiles. Show real castle silhouette changes: cottage → larger manor → walled keep → multi-tower castle. Gardens and banners reward habits. Crest slots can use crown/leaf/stag/tower motifs; small details should survive the pixel pass.

The original brand kit stays available as reference. Our Castle should use its own wordmark and household crest, not the old "your chat, your army" tagline or opposing army identities. Preserve the crest craftsmanship without making family members enemies.

## Code and assets

`src/graphics/pixel-renderer.js` and `palette.js` are reusable originals. `miniature-style.js` supplies the original bright paint/edge treatment. `references/source/world.reference.js` contains landscape/procedural-model techniques, but historical imports must not be copied blindly. The six GLBs and eight portraits show proportions; Gawain/Merlin are procedural source references, not missing downloadable GLBs. Font and Three.js licenses are bundled.

Do not replace the world with emoji, CSS rectangles or a screenshot background. Do not blur the whole page to imitate pixel art, use a pixel font for financial amounts, desaturate the world for disabled actions, or collapse the product into a generic finance dashboard. A clearly labeled art preview is not a payment demo.

## Decision ledger

| Decision | Source | Why |
| --- | --- | --- |
| Scenic looping board with growing home | User's board/house/wilderness brief | Makes shared progress visible in one place |
| Existing render pipeline and art files | User explicitly requested art carryover | Preserves the actual look across coding agents |
| Legible HTML amounts and approvals | Functional financial interaction | Pixelation belongs to the world, not the payment details |
| Cooperative crest and home tiers | User's family "house" | Shared achievements, not competitive armies |
| No combat or property-brand copying | New concept and owned asset sources | Keeps this new product distinct and implementable |
| Household travelers in crest colors (two figures for family, one for solo) on a gold "you are here" ring | First playable build | The token must read at pixel scale and belong to the family, not to an army |
| Route stones brighten as visited; milestone banners raise in the crest color when reached | First playable build | Shows progress on the board itself, not only in the panel |
| Brook with plank bridge, a second doe and fawn, a two-hut hamlet | First playable build, from the "wooden bridges / water / villages" vocabulary above | More wilderness without leaving the original miniature language |
| The four trees on the route corners step outward | First playable build | The original tree ellipse passes through the corner spaces and hid the travelers |
| At 100% the travelers bound over the walls and stand at the castle gate | First playable build | Home is the finish; the back towers would otherwise hide them |
| Habit gardens beside the home for logged on-time bills | Product rules: "bill habits can award banners/gardens" | Rewards habits visibly without counting bills as savings |
| Raised tiers stay after a refund, labeled as keepsakes; travelers walk back | Product rules on refunds | Truthful current progress without punitive demolition |
| Plan headlines and receipts use Alegreya Sans when they contain amounts | Tokens table: amounts stay readable HTML | Uncial stays for names and titles only |
| The Ledger tab uses AG Grid Community themed with the parchment, ink and brass tokens; the steward card sits above it | PayPal-focused tooling pass (sponsor tool) | A real records view without turning the product into a finance dashboard; the board stays the hero |
| A 42×30 estate: northwest bluff with waterfall, river with mill and footbridge, brook under a plank bridge into a reed pond, orchard, farm plots, well, windmill and hamlet | Owner's second-version request for a more expansive, detailed world | More places to read, built from the same MiniBuilder boxes, cylinders, cones and rocks, instanced per colour and drawn through the original PixelRenderer |
| A continuous road under the route stones; the west side breaks for the plank bridge | Second-version review: scattered stones did not read as one journey | The loop reads as a road at the larger scale |
| A gold pin above the travelers | Second-version review: travelers were hard to find in the wider estate | Keeps the household findable without enlarging the figures |
| Home tiers rebuilt with timber framing, tiled gable roofs, chimneys, mullioned windows, arched doors, towers with string courses and crenellations, a gatehouse, moat and drawbridge | Owner asked for visibly substantial upgrades | Each tier changes silhouette and craft detail, not just size |
| Estate additions at 10/40/80% (porch, village quarter with market stalls, outer ramparts with crest-coloured turrets) | Owner asked for richer intermediate rewards | Rewards between the 0/25/60/100% home tiers, without changing them |
| The default camera fits the whole island in the area not covered by the heading, controls and caption, measured from the live layout. Zoom, turn, pan (Shift-drag, right-drag or two fingers) and reset controls; on phones the controls sit below the board | Larger world on desktop and phone | The route, travelers and every tier stay visible at the default view; detail is one zoom away |
| Labeled art-only previews of locked rewards, including the proposed bill rewards | Owner allowed honest previews | People can see what is possible without the preview touching earned rewards or money |

## A living royal court

The owner clarified that higher rewards mean larger homes **and more guests and princesses roaming the grounds**. The existing Our Castle captures remain the dominant reference: native 3D miniatures, the original palette/post-process, dark outlines, heraldic clothing and readable silhouettes. This is a direct extension of that source.

Refero references reviewed: [TinyFaces](https://nft.tinyfac.es) for toy character silhouettes and personality through accessories, and [Obscura](https://obscura.net) for simple forms that remain readable after pixelation. Their fonts, layouts, button styles and palettes are not carried over. The bundled Refero motion guidance supplies the reduced-motion requirement; slow world simulation expresses the growing household reward rather than animating financial controls.

| Decision | Source and bounded role | Implementation |
| --- | --- | --- |
| 2/6/12/20 wandering guests at cottage/manor/keep/castle | Owner's larger-home/larger-court clarification | Existing home thresholds and keepsakes control the cast |
| Princesses Elowen, Amara and Sorrel join at successive tiers | Owner specifically requested princesses | Gold circlets, gems, long hair, bright gowns and flowers; original invented characters |
| Gardeners, musicians, nobles, pages and ceremonial guards | Owner's guests brief + TinyFaces' distinct accessories | Straw hats, lutes, capes, satchels, plumed helmets and crest shields distinguish roles |
| Strolling, greeting and music on safe lanes | Owner requested roaming; existing living miniature world | Articulated arms and boots, visits between walks; no path through home, moat, walls, market or fountain |
| Shared instanced batches on the existing ambient clock | Existing performance architecture | No extra render loop; reduced motion freezes positions and poses while preserving the cast |
| Guest counts on reward cards and preview title | Existing labeled preview interaction | A castle preview shows twenty guests without earning the castle or changing payments |
