# Claude: visual handoff

**Current owner Mac:** the active 3010 app uses `~/projects/our-castle-reviewed`; its ignored environment/data links preserve the originals. Keep `~/projects/our-house` at its existing source while the separate 3021 rehearsal is preserved. Source is public. Read [release readiness](RELEASE-READINESS.md#current-mac-app) before local edits; older activation/workstream notes below are historical.

The owner assigned Claude the visuals while Astra handles sponsor/integration engineering. Continue the current Our Castle game from updated `main`; older baseline commit IDs below are historical. Rachel has write access as `rachelselbrede` and a bounded-task/branch/PR guide at [START-HERE-RACHEL.md](../START-HERE-RACHEL.md). No replacement build is needed.

## Start

Read `AGENTS.md` and `CLAUDE.md`. For Rachel's small task, use START-HERE-RACHEL.md and read only the chosen feature's source/doc/current screenshot beyond these instructions. Broader visual work can consult ART-DIRECTION.md, INTERFACE-DIRECTION.md, DEFINED-CLOUDS.md and WOODLAND-LEGENDS.md as needed. Current PNGs include:

- `docs/screenshots/mountain-room-day.png`, `mountain-room-turned.png`, `mountain-room-phone.png` show the latest wider border; the earlier `mountain-border-*.png` are historical.
- `docs/screenshots/wizard-staff.png`, `rapunzel-fairy.png`, `rapunzel-fairy-night.png`.
- `docs/screenshots/cloud-overlap-day.png`, `cloud-overlap-night-rain.png`.
- `docs/screenshots/rosewind-palace.png`, `citadel-stag-detail.png`.

The running game is `/`, built by `src/app/main.js` and `src/world/board-scene.js`. The old `/art-preview.html` is historical reference.

On the owner's Mac the configured household stays on 3010. The separate approved sandbox rehearsal on 3021 belongs to its existing browser operator: do not touch it, restart it or create orders. If this same Claude session is already open, use it rather than starting a second instance. Do not ask for another AI key based on an older transcript.

For a clean visual checkout, use Node 22.16+, `npm ci` once, then `npm run demo`. The launcher chooses an unused port, uses in-memory example state and ignores credentials/saved data. No payment/AI credentials are needed for visual work.

## Preserve

Market tavern: retain the existing market house with striped porch, mug sign and three background townsfolk around its outdoor table. Read docs/TAVERN.md. Preserve bounded gestures, quiet interface, existing market access and the unchanged earned court; do not count the three scenic figures as new financial rewards.

Farm life: retain the two royal stables/four horses, village henhouse/three hens/goat, and two Manor sheep. Read docs/FARM-LIFE.md. Keep reserved plot clearances, night lanterns, bounded grazing clock and cleanup on rebuild; animals remain scenery separate from the twenty-person court.

Family avatars: Journal → House now saves one of eight original portraits per existing member, with matching map travelers. Read docs/FAMILY-AVATARS.md and inspect docs/screenshots/family-avatars.png. Keep those choices and the additive avatar column; avatars do not change roles or the twenty-person reward court.

Nine districts on a 356×260 forest with a 64-unit unbuilt border around the original 228×132 interior: Hearth Village, Manor Gardens, Market Town, Woodland Garden, Stone Keep, Starfall Observatory, Royal Citadel, Rosewind Palace and Rapunzel's Tower. Keep the mountain rim, the outer meadows (eight empty; four with the miniatures in [waysides](WOODLAND-WAYSIDES.md#outer-meadows), merged at the owner's request) and official-outline PayPal hillside sign, every earlier building, nine bridges, six winding rivers, the ivory stag, golden braid, staff-carrying wizard, balcony fairy, telescope and sword grove. The sword's glint is mouse/touch/keyboard accessible and camera-only. Outer clearings and their scenery add no financial rewards. Snow weather's sleigh, tree and snowman appear only while Snow is chosen.

Keep continuous overlapping white cumulus banks, varied shapes, translucent tails and restrained forest-edge haze. There must be no flat grey gaps between the banks; read docs/DEFINED-CLOUDS.md for the latest correction. Keep ivory plaques, bundled Uncial/Alegreya fonts, the four-step collapsible journal and one general footer notice. Cards contain only name, pixel art/crest, one milestone line and actions. No catalogue, slogans, repeated disclaimers or “preview” product headings. The phone Areas menu must scroll within the actual map height; keep overview plaque collision handling.

The original `src/graphics/pixel-renderer.js`, `palette.js`, copied references, licenses and provenance stay untouched. New portrait assets must be original code renders with their own provenance.

## Work boundary

Own visual meshes, visual effects, `app.css` and visual-only markup. Coordinate before editing shared `src/app/main.js`, `src/core/realm.js`, `src/core/deeds.js` or `index.html`. Astra owns server/payment/AI logic, integration dependencies, ledger semantics and provider contracts. Do not change financial thresholds, approval, crediting, verified-source wording or entitlement rules as part of styling.

Use a focused visual branch from updated `main`. The owner has authorized reviewed pushes to `main`; no force push, repository visibility change, site deployment or hackathon submission. Pause before shared-file edits if the other workstream has changed them. Keep commits focused and merge normally.

Choose one visible improvement at a time, compare an actual render to its existing reference, and report what changed and what was actually checked. `npm run check` protects copied assets; run only relevant browser checks after behavior changes. Current results are in docs/VALIDATION.md; earlier baseline counts are not a reason to repeat the full suite.

Video work remains paused. Preserve existing cuts and the untracked unfinished video kit. No paid AI/provider calls or new payment orders for a visual pass.
