# Art direction — preserve this visual family

## Overlapping cloud surround (November 5, 2026)

The owner clarified that separate clouds over grey gaps were the wrong target. Larger crowns now overlap in tightly layered rows, filling the surround continuously with pale cloud light and soft underside seams. Keep recognizable puffs and thin wisps; no exposed grey sheet between them. The forest-edge mask, world, buildings, farms, tavern, avatars, original renderer/palette and controls remain unchanged.

[Current reference lock](DEFINED-CLOUDS.md) · [Day](screenshots/cloud-overlap-day.png) · [Night/Rain](screenshots/cloud-overlap-night-rain.png) · [Phone](screenshots/cloud-overlap-phone.png). This supersedes earlier open-gap/separated-bank directions.


## Market Town tavern (November 5, 2026)

The existing market house gains a small striped porch, hanging tankard sign and an outdoor table with two seated neighbors and an innkeeper. Bread, mugs, barrels and a warm lantern make the gathering readable without extra interface. Occasional head/mug gestures use the existing ambient clock; reduced motion and hidden-tab pause remain. The market, well, stalls, windmill, earlier houses, farms and twenty-person court stay intact.

[Reference lock and boundaries](TAVERN.md) · [Tavern detail](screenshots/market-tavern-detail.png) · [Actual Night/Rain](screenshots/market-tavern-night-rain.png).


## Stables and small farms (November 5, 2026)

The Citadel and Rosewind each have a detailed stable and two horses. The village gains one henhouse, three hens and a goat; the Manor gains two sheep. Roofs, heraldry, hay, timber framing, warm lanterns and animal anatomy use the original miniature palette. Buildings and guests remain; farm plots sit clear of their routes and the river banks. Grazing/pecking/tail motion uses the existing clock and respects reduced motion and hidden tabs. No extra controls or text.

[Reference lock, placement and boundaries](FARM-LIFE.md) · [Royal stable](screenshots/royal-stables.png) · [Village henhouse](screenshots/village-henhouse.png). The two detail captures use original geometry in an isolated stage; source art, renderer and palette are unchanged.


## Individual family avatars (November 5, 2026)

Named portraits in Journal → House open one compact chooser with eight original pixel characters. Portraits and travelers use the same model and colours; hats, hair, skin, trim and clothing distinguish each person. The header and nine-district world stay uncluttered. Choices save per existing member and remain cosmetic; the twenty-person reward court is unchanged. A tall hat raises the route marker enough to stay clear.

[Reference lock and boundaries](FAMILY-AVATARS.md) · [Actual example-data chooser](screenshots/family-avatars.png). The portraits' generator and exact source/image hashes live in assets/member-avatars/. Keep the original renderer and palette.


## Folklore towers and a hidden sword (November 4, 2026)

Starfall Observatory and Rapunzel's Tower occupy two new eastern forest clearings, with narrow tributaries under their raised bridges. The board remains 228x132; all seven earlier estates, the Citadel stag and the defined cumulus clouds remain. The map now has nine districts, nine bridges and six connected river channels.

The Observatory has a stepped stone shaft, plum star-inlaid roof, crescent finial, brass telescope, book stand, herb beds and a small original background wizard. Rapunzel's Tower has ivory stone courses, a verdigris cap, rose balcony, original folklore figure and a visibly braided golden rope of hair. These original figures are scenery, separate from the unchanged twenty-person reward court. The sword sits in a small grove with a carved mossy stone and tiny glint; investigation frames it and displays only its name.

[Reference lock](WOODLAND-LEGENDS.md) · [Observatory](screenshots/wizard-tower.png) · [Rapunzel](screenshots/rapunzel-tower.png) · [Nine-district map](screenshots/legends-realm.png). Internal discovery still: screenshots/sword-in-stone.png.

The two tower cards use actual new model renders, with separate source/image hashes and a reproducible no-credentials generator in assets/area-cards/generate-legends.mjs. Existing portraits/provenance remain unchanged. Roof appliques follow the sloping roof so their gold stays visible; the braid uses overlapping thicker strands so pixel outlines do not swallow it. Do not return to thin black-looking star or hair details.

Keep labels sparse: overview plaques that would overlap are hidden while Areas retains every destination. Phone overviews keep only the current home name and the quiet discovery glint. Menus scroll within the measured map height, including the phone CSS rule, so the final area stays reachable. Video work remains paused.

## Clearly defined cloud banks (November 4, 2026)

The owner rejected the previous murky grey blur. Replace the fog field with distinct cumulus silhouettes, white rounded crowns, lightly shaded undersides, open light gaps and translucent trailing wisps. Vary width, height, crown shape, orientation and position to avoid identical clouds in rows. Preserve only subtle overlap at the outer forest edge. Day, Afternoon, Night and Rain retain readable contours.

[Reference lock and bounded research](DEFINED-CLOUDS.md). [Day](screenshots/cloud-defined-day.png) · [Night/rain](screenshots/cloud-defined-night-rain.png). This supersedes the diffuse cloud appearance below. The world, palace, interface and original renderer/palette remain unchanged.

## Rosewind Palace and the eastern woodland (November 4, 2026)

The board is now 228x132 (61% more ground), centred at (32, 0), with seven separate clearings. The earlier six keep their positions, buildings, colour and the Citadel stag. Rosewind Palace adds original ivory masonry, rose-and-wine roofs, five gilt-tipped spires, illuminated arched windows, a balcony, fountain and four rose parterres. A new tributary flows below its raised bridge; the main river, forest, rain and cloud edge extend to the new bounds.

[Reference lock and decision ledger](ROSEWIND-DIRECTION.md). [Palace](screenshots/rosewind-palace.png) · [Expanded realm](screenshots/rosewind-expanded-realm.png) · [Night/rain](screenshots/rosewind-night-rain.png).

Rosewind shares the existing 100% home:castle achievement and receives a separate short rose-banded deed. Princess Sorrel, Lyra, Alma and Lark move here from the existing final-tier cast; the total stays twenty. The Citadel remains the final financial-route destination. The flag carries household heraldry, with no assumed sponsor endorsement. Phone overviews name only the current home; Areas retains every destination and focused views show its full parchment plaque.

The new 320x176 portrait is actual code-native geometry. Its separate generator and source/image hashes are in assets/area-cards/generate-palace.mjs and palace-provenance.json. The older six portraits/provenance remain unchanged. Video work stays paused.

## Clouds around the woodland (November 4, 2026)

The owner rejected the flat blue empty space and requested mixed fluffy/transparent clouds around the greenery, barely seeping into the map. This is the primary reference lock: the existing woodland, pixel palette and that explicit cloud brief. Bounded secondary research: Adaline (https://www.adaline.ai, Refero 6096b7ca-a126-444b-81c6-8943f0fbec98) supplies misty depth around natural scenery; Air (https://air.inc, c8a666d9-56a3-4aa6-b373-e62a2b07d3cb) supplies layered soft cloud masses. No typography, controls, marketing layout, saturated sky blue or third-party imagery is imported.

Replace empty sky pixels with ivory/sage cloud banks and a thinner mist layer. Anchor the banks in world space so they follow camera movement. Limit foreground haze to a few units at the outer forest edge; keep the map interior, buildings, rivers, labels and financial interactions clear. Afternoon, Night and Rain tint the same cloud shapes. Reuse the ambient clock; keep reduced motion static and cap hidden-tab drift. The art-reference page keeps its original renderer defaults. No new user controls or notices.

The owner paused all further video work. Preserve the captured source and older videos; build and review still images only.

## Record-to-realm journey (November 4, 2026)

Reuse the current owner-approved game frame and the existing Refero reference lock in INTERFACE-DIRECTION.md. The bounded map-selection pattern supplies one selected ledger record, not a new dashboard or reward catalogue. Keep the owned fonts/palette, one general footer notice, source labels on records and all six forest districts.

A newly earned area temporarily frames its river crossing, lowers the bridge, lets the family cross, then focuses the destination for the existing cue and compact deed. Manual camera changes take priority; reduced motion resolves without movement. The ledger selects one receipt, searches source/order/capture text, and links a calculated milestone to the already-earned district. Details about IDs and AI tool checks open on request. Bills/gifts stay separate and pending attempts never imply credit. No sponsor logo strip or extra product disclaimer is added.

## One Citadel lawn sculpture (November 4, 2026)

The owner asked for at least one highly detailed lawn statue on a fancier estate, without overdecorating. Reference lock: the existing Citadel detail capture, the owned stone/cream/brass palette and existing woodland deer are primary. Live Refero review of Eduardo del Fraile (https://www.eduardodelfraile.com, style 36be0546-da09-4d6b-ba8b-27495bb71cda) contributes only one isolated sculptural focal point with breathing room; none of its interface, typography or black gallery canvas is imported.

Build one ivory stag on a carved, stepped plinth, with branching gilt antlers, chiseled facial details, articulated stone legs, cloven hooves and a small household-color shield plaque. Place it on the Royal Citadel front lawn at local (8.5, 15.4), between the two guest lanes, away from the gate and existing flower parterres. Keep its base aligned with the lawn; only the stag turns. No second statue, new interface text, reward rule or financial behavior. Use existing geometry/material batches and no animation loop. [Estate view](screenshots/citadel-statue.png) · [sculpture detail](screenshots/citadel-stag-detail.png).

Minor refinement: retain that same reference lock and single statue. Turn the stag slightly toward the main view, separate the antler branches with widths that survive the pixel outlines, and sharpen brow/hoof cuts. Add only a shallow carved laurel around the existing crest. The base, location, paths and reward rules remain fixed.

## Game interface around the world (November 4, 2026)

The owner rejected the surrounding website chrome, repeated explanations and disclaimers, while keeping the pixel world. The new target is a compact game frame: one header goal, a large realm, one collapsible household journal, and occasional utilities behind Areas, View and World settings. There is one general notice in the footer. Exact-amount consent and the actual source/status of a receipt stay attached to that action or record.

Live Refero research and the decision ledger are in [INTERFACE-DIRECTION.md](INTERFACE-DIRECTION.md). The owned brand remains primary; Wayfinder supplies world-first restraint, MekaVerse light navigation, and PamPam/OneSoil the bounded menu pattern. No third-party art or replacement fonts were imported. The existing Uncial/Alegreya, ivory/ink/brass, deed cards, all six districts and flowing woodland rivers remain.

## Gentle river current (November 4, 2026)

Reference lock: the owner's existing woodland map and request for a “slight flow.” Replace the static river highlights with sparse glints moving slowly along the same three channels. The forest, river widths, buildings and bridges stay fixed. Preserve the original pixel renderer and palette; dim the highlights with Night and Rain.

One instance batch uses the existing ambient clock, without another timer or render loop. Reduced motion keeps the surface still; hidden tabs stop updates and resume without a jump.

## Larger world, quiet contributions, parchment names (November 4, 2026)

Current references: [home close-up](screenshots/home-close-detail.png), [ivory nameplates](screenshots/realm-parchment.png), [castle detail](screenshots/citadel-parchment-detail.png), [contribution step](screenshots/contribution-quiet.png). Captured from isolated example data; no payment or live-weather evidence.

The owner asked for visible architectural detail, less information in the contribution screen, and ivory/parchment property names with better lettering. Reference lock: today's owner screenshots identify the exact deletion/restyle targets; the established Tiny Castle palette, Uncial type, pixel renderer and connected realm remain primary. Refero's copywriting guidance supplies orientation, status and action, without repeated implementation explanations.

| Decision | Source | Role |
| --- | --- | --- |
| Start near the current earned home; Whole realm still shows all six districts | Owner: buildings too small to show detail | Camera only, no shrinking the realm or changing buildings/access |
| Printed ivory plaques, ink text in larger bundled Uncial and a small lock | Owner's parchment/font request | Names on the map; no extra descriptive text |
| Goal and amount/approval/payment action, with errors only when needed | Owner's contribution screenshot and “less is more” | Remove plan recap, suggestion cards, projection essay, repeated next-step explanation and server plumbing |
| One contextual next-step button, hidden when already at that step | Earlier family-journey goal and current simplification | Preserve navigation without duplicate instructions |
| Fresh approval after editing the amount | Existing explicit amount-specific approval | Prevent a prior checkbox from approving a changed amount |

The whole realm, original buildings, night/rain, unlock cards, money validation and records remain. Financial modes stay identified in their badges, checkout note and receipts. No provider/payment/AI action is added.

## Short collectible cards (November 4, 2026)

Current card face: [Manor Gardens](screenshots/deed-manor-simple.png), captured from an isolated example-mode unlock.

The owner asked for Monopoly-like brevity and rejected the dense unlock cards. Reference lock: the owner's card direction, existing coloured deed band, original 320×176 pixel art, crest seal and stepped ink border. Preserve the art and typography. The face now contains only the area name, art/crest and one short status/milestone line; a tiny queue count appears only for several cards. Visit, Next and Close share one row. Descriptions, guest lists, evidence/stamp paragraphs and expandable details are deleted. Payment facts remain in payment records; these are game collectibles, not receipts. Access, queue timing and financial logic are unchanged.

## Less interface, progression in the world (November 4, 2026)

The owner explicitly asked to delete the pictured Rewards catalogue and use less interface. This supersedes the catalogue and future-reward tour decisions below.

**Reference lock:** the owner's supplied deletion target and existing map-first Tiny Castle game. Remove the entire Rewards tab/panel, introductory copy, evidence banner, repeatable architecture-description cards, provider explainer and the catalogue's tour banner/controls. Preserve the world, pixel renderer, palette, typography, financial actions and unlock cards.

| Decision | Source | Role |
| --- | --- | --- |
| Four journey tabs: House, Plan, Contribute, Ledger | Owner: delete this panel, less stuff | Remove a destination, not replace it with another catalogue |
| Unlock cards appear when an area opens; select an earned district to reopen its deed | Owner's earlier request for a card on each new area | One contextual View deed action in the map's existing controls |
| Completed-goal next step visits the castle on the map | Existing family journey; deleted Rewards destination | Keep a valid next action without extra interface |
| Real lock conditions stay with map labels; payment/evidence labels stay with payment records and deeds | Existing product rules; Refero orientation + status + action | Keep relevant facts at their point of use |

No new design system, feature panel, provider connection, money change, model change or art asset.

## Game language for destination exploration (November 4, 2026)

The owner rejected “Previewing a reward”, “Art preview” and “this does not unlock…” in the playable interface. The enterprise demo must present the game confidently.

**Reference lock:** the owner's supplied destination-screen screenshot and current Tiny Castle UI are primary; preserve their world, typography, colors and controls. Refero's copywriting guide supplies only orientation + status + action, concrete action labels and calm payment language. This is a copy edit, not a new visual system.

| Decision | Source | Role |
| --- | --- | --- |
| Destination heading uses its real district name; buttons say Explore or Visit | Owner correction; Refero action + object guidance | Make world exploration a normal game action |
| A short Locked / Open / Keepsake line gives the actual unlock condition | Existing authoritative reward state; Refero status + action | Explain access in the game's vocabulary instead of an art disclaimer |
| Return to your realm | Owner correction; existing keyboard return flow | Keep a clear way back with focus preserved |
| Court text describes guests and princesses directly | Existing court data and owner preference for rich rewards | Keep the reward exciting without a development qualifier |
| Payment sandbox/simulated labels, reported savings and connection-required bill status remain accurate | Existing product rules | Presentation language never changes money, entitlement or evidence |

No changes to models, bridges, palette, financial logic, stored data or internal inspection identifiers. The original art-reference route and historical captures remain preserved; development/provenance notes belong in documentation, not destination banners.

## Current map target: a woodland realm with rivers (November 4, 2026)

The owner corrected the connected-realm captures directly: *"it should be all green the landscape is a forest separated by rivers under the bridge not this big ocean and why are the castles so bland? shouldn't they be embelished with colors and little accent colors?"* This supersedes the grey-island target below. Do not ask for that choice again.

**Brief.** One continuous green wooded realm. The six districts and their earlier buildings stay in their separate locations as clearings in the forest. Narrow winding rivers, connected to each other, run below the six bridges with green banks on both sides; there is no blue sheet around the plots. Every castle, including locked ones, is painted in full colour with accents. Locked means a named label, a raised bridge and a closed gate. It does not mean grey grass, grey trees or a grey castle.

**Reference lock.**

| Source | Role | Not taken |
| --- | --- | --- |
| The owner's Tiny Castle / Crown & Dust art: `references/images/our-house-castle.png`, `color-and-heraldry.png`, `mountain-world.png`, plus the current realm captures | Primary. Orthographic miniature world, rounded and conical trees, soil-sided board, enamel crimson/cobalt/gold heraldry with dark separation, cream stone with dark courses | Nothing replaced: same 90-colour PixelRenderer, Uncial/Alegreya fonts, palette, brand assets and notices |
| [MekaVerse](https://themekaverse.com) (Refero) | Map-first panoramic composition only | Its sci-fi theme, palette, fonts and imagery |
| [Wayfinder](https://wayfinder.nfb.ca) (Refero) | Layered organic woodland density only: groves and glades instead of a tree fence | Its autumn and desaturated palette |
| [Karl](https://karlgonsalves.com) (Refero) | Distinct, colourful architectural silhouettes only | Its page palette and fonts |

No external game art and no generated or screenshot background. The financial UI is not redesigned.

**Decision ledger (woodland revision).**

| Decision | Source | Implementation |
| --- | --- | --- |
| One continuous forest floor across the whole 164×114 realm | Owner: "all green… a forest" | A single heightfield ground mesh with soil sides at the board edge. Districts are lighter meadow clearings in it, not raised islands with rock-cliff shores |
| Layered forest between the clearings | Owner + Wayfinder density principle | Instanced broadleaf trees, conifers, shrubs, ferns, birches and small details (mushrooms, flowers, stones), scattered by a deterministic noise field into groves and glades; no square tree border |
| Narrow connected rivers under every bridge | Owner: "separated by rivers under the bridge not this big ocean" | One east–west river through the garden, keep and royal-procession bridge centres; a west tributary under the manor bridge; an east tributary under the citadel and market bridges. Channels are cut into the ground over a shallow water bed, with banks, reeds and stones |
| Bridges cross the water, raised leaves over the river | Existing open/raised bridge logic | Stone approaches on the banks, bank piers clear of the channel, two wooden leaves that meet over the middle of the river and lift when the crossing is locked; the portcullis barrier stays on locked crossings |
| Locked districts keep their full colours | Owner: castles should be "embelished with colors"; locked areas are no longer greyed | The blanket desaturation of locked regions is removed. Labels, raised leaves and closed gates carry the lock |
| Embellished, distinct architecture | Owner + `color-and-heraldry.png` enamel and gold craft; Karl silhouettes | Crimson and cobalt roofs, gold finials and trim, coloured shutters, long heraldic banners and crest shields, flowering planters, entrance details. The manor is timber and cobalt, the keep is cool stone with crimson roofs, the citadel is warm cream stone with dark courses and mixed crimson/cobalt spires |
| Guests, earned access, milestones and court sizes unchanged | Existing financial rules | Presentation only. No payment, provider or reward rule changes; previews stay art-only and non-mutating |

**Current rendered references:** `docs/screenshots/forest-overview.png`, `forest-locked-citadel.png`, `forest-phone-overview.png`, `forest-citadel-preview.png` and `forest-simulated-manor.png`.

**Notes for later work:**
- **Outlines at a distance:** at phone scale one world unit is about one art pixel, and the outline pass draws every isolated tree silhouette black. The forest therefore uses broad understory mounds under every crown and a near-continuous canopy. Small, separate, tall trees turn the phone overview dark.
- **Forest shading:** the forest and ground use flat Lambert paint in shared instanced batches, built once. The full standard material over that much screen area tripled software-rendered frame time.
- **Locked roads:** roads and route stones on locked legs are pale dust and weathered stone, not grey.

## Family journey: one clear next step (November 4, 2026)

The owner chose "an easier family journey: clearer planning, contributions and next steps." This builds on the existing House → Plan → Contribute → receipt/rewards flow. There is no new planner, no checklist, no tour and no new navigation; the forest stays the main view.

**Reference lock.**

| Source | Role | Not taken |
| --- | --- | --- |
| The current app, `docs/screenshots/forest-*.png` and the Tiny Castle / Crown & Dust art | Primary. Parchment journey cards, dark teal frame, brass actions and focus, Uncial titles, Alegreya Sans for text and amounts | Nothing replaced |
| SavvyCal guided setup (Refero `86bfb0b1-1b19-49ca-92d1-6fbc4964fa7f`) | Only completed, current and unfinished steps told apart, with one unfinished action prioritised and its purpose stated | Its colours, Inter type, sidebar, upgrade prompts and white screens |
| Lemon Squeezy onboarding checklist (Refero `edc09563-82ab-4fd0-8b94-034755f5046d`) | Only a short task, its explanation and an explicit action grouped together; finished setup does not compete with the next action | Its purple palette, generic panels, type and extra navigation |

The root's flow research ([SavvyCal flow](https://refero.design/flows/3346)) confirmed the same pattern: an explicit next action, saved progress and no implicit provider connection. No styling was taken from it. MekaVerse, Wayfinder and Karl keep their narrow composition, woodland and architecture roles above.

**Decision ledger.**

| Decision | Source | Implementation |
| --- | --- | --- |
| One "next step" inside the existing goal card, above the step tabs | SavvyCal priority + Lemon Squeezy grouping | A title, one or two plain sentences on why, and one button naming what it opens. It is derived from saved server state: household, plan, accepted plan, plan week, contributions, progress |
| The step tabs show done and next | SavvyCal step states | The existing tabs keep their done marks; the tab holding the next step gets a gold marker and "next step" for screen readers. No second navigation |
| Opening a step never writes | Product rules | The button only switches tab and moves focus. Making, accepting or paying stay the existing explicit buttons |
| Returning families resume | Owner request | On load, the tab the family last chose in this browser session is restored; otherwise the next step's tab. Refreshes after an action never move the family to another tab or clear unsaved plan or amount input |
| Plan → contribution → milestone in Contribute | Existing quick picks and milestone rules | Under the amount, "if the server confirms it" shows the new total and any milestone it would reach, computed with the shared rules. Nothing is counted until the server confirms it; the receipt appears below |
| Honest money states | Product rules | Pending, canceled, declined and refunded payments never read as credit; keepsakes never imply the money is still there; reported, simulated and PayPal sandbox amounts stay labelled |
| A way back to the saved payment record | Root review: a durable return path after refresh | Under the next step, a small line names the latest payment and its saved status, with a link that opens its record in the Ledger. It reads loaded state only; it is never the primary action |

## District deeds: a card when a new area opens (November 4, 2026)

The owner asked: *"there needs to be a card that indicates when you unlock a new area pixelated like a monopoly card basically."* When the server's state newly opens a district, a portrait deed card appears after the board animation. Every deed earned so far can be reopened from Rewards → District deeds. The forest, rivers, colourful buildings and all six districts are unchanged.

**Reference lock.**

| Source | Role | Not taken |
| --- | --- | --- |
| Our Castle's own parchment, ink and gold, the household crest, Uncial Antiqua titles and Alegreya Sans text | Primary. The deed is parchment on the dark teal frame with ink and gold; the crest is the household's seal | Nothing replaced; no new font or dependency |
| Root's six stills of the actual game districts, `assets/area-cards/*.png`, drawn by the 90-colour renderer | The deed's miniature illustration, shown pixel-sharp at an integer scale where it fits | No generated or external art |
| FRANKY'S (Refero style `d07c7449-98d8-4a89-82f0-de3fe2ec2144`) | Only paper on a dark ground, crisp pixel framing and a compact illustrated card | Its palette, type and layout |
| Cards Against Humanity (Refero style `42bafff0-1938-4fef-a7dc-65c7cb062c79`) | Only a physical rectangular collectible with a strong title hierarchy | Its typography and colours |
| WishWish success screen (Refero `a8fe3af8-13df-41df-8f52-a87b14d788a0`) | Only a centred illustration, an unambiguous "earned" message and one main action | Its rounded glossy gift style |

The deed is an original property-deed shape: no Monopoly logos, characters, wording or board.

**Decision ledger.**

| Decision | Source | Implementation |
| --- | --- | --- |
| A portrait deed, about 370 px wide, as a native modal dialog | Owner: "a card… like a monopoly card"; WishWish one main action | Stepped pixel corners, a double ink rule with small gold corner squares, a title band in the district's heraldic colour, "New area unlocked", the district name in Uncial, the pixel still, and the household crest as a seal. Escape and Close return focus to where it was |
| A compact face, details on request | Root review of the first render (about 780 px tall) | The face shows the exact condition it met, two short lines (main buildings; guest count with any princess), the evidence and a "Realm keepsake" stamp, then Visit and Close: about 630 px tall at 390×844. Full architecture, guest names, estate additions and provider locks are under "Deed details". All text is readable Alegreya Sans, not pixel type |
| Honest evidence | Product rules | Goal districts quote the server's evidence label. The stamp reads "Realm keepsake · Example mode · simulated payments" or "… PayPal sandbox · test money". The Woodland Garden's stamp says it is a self-reported habit, not verified by any bill provider, and its details keep the provider-required water garden locked |
| Shown only for districts the server newly opens, for the same household and goal | Product rules on previews, keepsakes and replays | A page load, a reload, a replayed capture, a refund, re-crossing a keepsake, a pending or canceled payment, and an art preview never produce a deed. Several new districts queue as "Deed 1 of 3" with Next. An open dialog is updated in place rather than closed and reopened, so a late close event cannot clear newer deeds |
| One district colour per deed band, from the existing tokens | Monopoly-like colour bands, in the Our Castle palette | Village emerald, Manor cobalt, Market crimson, Garden leaf, Keep timber, Citadel violet |
| Visit and Close write nothing | Product rules | Visit leaves any art preview, focuses that district on the map and keeps keyboard focus visible. The collection reopens the same deeds from loaded state |

## Realm atmosphere: day, afternoon, night and rain (November 4, 2026)

The owner asked for *"night/day/afternoon/rain mode that enables the homes or castles to change and have lights to illuminate the dark"*, optionally following the person's actual time zone or weather. The woodland, rivers, bridges, colourful architecture, locks and deeds are unchanged; only the light and weather over them change.

**Reference lock.**

| Source | Role | Not taken |
| --- | --- | --- |
| The owner's supplied night screenshot, as interpreted by root | Primary target for night: a cool blue-teal woodland that stays readable, warm golden windows, warm light pools at doors and lamps along paths and bridges, roofs still detailed | Not a flat dark filter over the page |
| Our Castle's own renderer, 90-colour palette, Uncial/Alegreya and parchment/gold/teal UI | Dominant system. Light is real scene light and emissive glass, still drawn through the pixel pass | Nothing replaced |
| MekaVerse (Refero style `f5e5d282-4361-4654-aac2-c8b5cd8214b1`) | World-first composition with minimal controls only | Its type and brand colours |
| Wayfinder (Refero style `168f20ae-b58e-4781-b9b8-46b2d9b81b5f`) | Atmospheric forest and restrained square controls only | Its type, palette and autumn tones |

**Current rendered references:** `docs/screenshots/atmosphere-night-cottage.png` and `atmosphere-night-rain-castle.png`, approved by root.

**Decision ledger.**

| Decision | Source | Implementation |
| --- | --- | --- |
| Light comes from the buildings | Owner: lights "to illuminate the dark" | Window glass and lantern glass have their own material roles, separate from cream stone, and glow at night. A few distance-limited warm point lights at the district homes, plus cheap warm ground pools at doors and bridge gates, brighten nearby walls and paths |
| Day, afternoon, night | Owner + target screenshot | Day keeps the existing light. Afternoon has a lower warm-gold sun with cooler fill. Night has cool blue moonlight bright enough to read the forest, buildings and bridges |
| Rain with any time of day | Owner | Softer, cloudier light, damp ground and wet-looking roofs, darker water, and restrained slanted world-space streaks with small splashes. No lightning |
| Cosmetic only | Product rules | Night light is not the provider-locked lantern festival. Atmosphere never changes previews, rewards, progress or access, and makes no server request |
| Compact controls beside the map | MekaVerse and Wayfinder restraint | Two square selects, Time of day (Auto, Day, Afternoon, Night) and Weather (Clear, Rain, Local weather), with one status line naming the source |
| Auto follows the device clock | Owner: the person's actual time zone | The device's IANA time zone through `Intl` (day 06–15, afternoon 15–19, night 19–06), labelled as the device clock rather than astronomical sunrise. Never a PayPal address or account data |
| Local weather is opt-in | Privacy | Weather is fetched only after the person searches for and selects a town, which is sent to Open-Meteo with attribution. It can be disconnected. Results that are stale or unavailable are labelled so |
| Soft light pools | Root review of the first night render | Each pool is five concentric low-opacity discs in one instanced mesh, warm at the centre and falling off outward, rather than a flat yellow circle |
| Honest weather labels | Root review | The status names Open-Meteo's report time, not an "observation". The setup note says a search sends the typed town name, and credits Open-Meteo and GeoNames. A failed load is retried on schedule at most every 15 minutes |

## Earlier map target: a connected realm (historical)

The grey-island treatment described in this section was superseded by the woodland revision above. Its captures (`docs/screenshots/realm-*.png`) and the demo clips recorded from it are historical.

The owner corrected the small-plot interpretation: larger buildings should be separate, connected destinations, visible in grey across bridges/moats until unlocked. This supersedes the earlier replace-one-building composition and explicitly permits grey treatment for locked **district artwork**. Functional amounts, payment controls and earned progress remain readable and truthful.

Primary visual source remains the actual Tiny Castle/Our Castle native miniature art. Bounded Refero references: [MekaVerse](https://themekaverse.com) supplies only the map-led panoramic composition and lightweight exploration controls; [Wayfinder](https://wayfinder.nfb.ca) supplies only the continuous landscape/journey principle. Their sci-fi themes, fonts, tokens, illustrations and source code are not copied.

Current rendered layout references: `docs/screenshots/realm-overview.png`, `realm-locked-citadel.png`, `realm-citadel-preview.png`, `realm-phone-overview.png` and `realm-phone-locked-citadel.png`. These supersede the single-plot composition of the older captures while preserving their miniature materials and renderer. On phones the overview leaves the landscape unobscured and the six district controls below it provide names and lock conditions; a focused district has its own larger detail view.

| Decision | Source | Role |
| --- | --- | --- |
| Six separate shores across a 164×114 realm | Owner's connected-building correction | Hearth Village, Manor Gardens, Market Town, Woodland Garden, Stone Keep and Royal Citadel all remain visible |
| Larger architecture in later districts, earlier buildings retained | Owner expected connected buildings | Manor, keep and citadel occupy their own grounds rather than replacing the starting cottage |
| Detailed grey locked districts, raised connecting bridges and portcullis barriers | Owner explicitly requested grey future unlocks and moats/bridges | The original geometry is visible before it can be reached; the earned state opens the crossing |
| Full-width world with inspectable district names and a whole-realm view | MekaVerse's map-first composition, adapted to existing art | Overview establishes geography; district focus reveals architectural and character detail |
| Same twenty financial steps cross the shores and bridges | Existing financial rules + owner's board-map brief | Existing 0/25/60/100% thresholds remain unchanged |
| Guests remain in the district that welcomed them | Connected-world clarification + existing court progression | The starting village stays inhabited as later courts open |
| Original renderer, fonts, crest colors and payment panels | Existing visual lock | Grey treatment belongs to locked map regions, not the whole UI |

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
