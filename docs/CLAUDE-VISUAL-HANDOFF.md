# Claude: visual handoff

The owner assigned Claude the visuals while Astra handles sponsor/integration engineering. Continue the current Our Castle game from private `main`. The working visual build is `3dd6bf5`; this handoff adds no replacement renderer or new concept.

## Start

Read `AGENTS.md`, `CLAUDE.md`, `docs/ART-DIRECTION.md`, `docs/INTERFACE-DIRECTION.md`, `docs/DEFINED-CLOUDS.md` and `docs/WOODLAND-LEGENDS.md`. Open the actual current PNGs:

- `docs/screenshots/wizard-tower.png`, `rapunzel-tower.png`, `legends-realm.png`.
- `docs/screenshots/cloud-defined-day.png`, `cloud-defined-night-rain.png`.
- `docs/screenshots/rosewind-palace.png`, `citadel-stag-detail.png`.

The running game is `/`, built by `src/app/main.js` and `src/world/board-scene.js`. The old `/art-preview.html` is historical reference.

On the owner's Mac the configured household stays on 3010. The separate approved sandbox rehearsal on 3021 belongs to its existing browser operator: do not touch it, restart it or create orders. If this same Claude session is already open, use it rather than starting a second instance. Do not ask for another AI key based on an older transcript.

For a clean visual checkout, use Node 26 (minimum 22.16), `npm ci`, then an unused port with empty credentials and a separate temporary example database. See the root README. No payment/AI credentials are needed for visual work.

## Preserve

Market tavern: retain the existing market house with striped porch, mug sign and three background townsfolk around its outdoor table. Read docs/TAVERN.md. Preserve bounded gestures, quiet interface, existing market access and the unchanged earned court; do not count the three scenic figures as new financial rewards.

Farm life: retain the two royal stables/four horses, village henhouse/three hens/goat, and two Manor sheep. Read docs/FARM-LIFE.md. Keep reserved plot clearances, night lanterns, bounded grazing clock and cleanup on rebuild; animals remain scenery separate from the twenty-person court.

Family avatars: Journal → House now saves one of eight original portraits per existing member, with matching map travelers. Read docs/FAMILY-AVATARS.md and inspect docs/screenshots/family-avatars.png. Keep those choices and the additive avatar column; avatars do not change roles or the twenty-person reward court.

Nine clearings on one 228×132 green forest: Hearth Village, Manor Gardens, Market Town, Woodland Garden, Stone Keep, Starfall Observatory, Royal Citadel, Rosewind Palace and Rapunzel's Tower. Keep every earlier building, all nine bridges, six winding rivers, gentle current, the ivory stag, golden braid, telescope and sword grove. The sword's glint is mouse/touch/keyboard accessible and camera-only.

Keep the defined white cumulus banks, varied shapes, translucent tails and restrained forest-edge haze. Keep ivory plaques, bundled Uncial/Alegreya fonts, the four-step collapsible journal and one general footer notice. Cards contain only name, pixel art/crest, one milestone line and actions. No catalogue, slogans, repeated disclaimers or “preview” product headings. The phone Areas menu must scroll within the actual map height; keep overview plaque collision handling.

The original `src/graphics/pixel-renderer.js`, `palette.js`, copied references, licenses and provenance stay untouched. New portrait assets must be original code renders with their own provenance.

## Work boundary

Own visual meshes, visual effects, `app.css` and visual-only markup. Coordinate before editing shared `src/app/main.js`, `src/core/realm.js`, `src/core/deeds.js` or `index.html`. Astra owns server/payment/AI logic, integration dependencies, ledger semantics and provider contracts. Do not change financial thresholds, approval, crediting, verified-source wording or entitlement rules as part of styling.

Use a focused visual branch from updated `main`. The owner has authorized reviewed pushes to private `main`; no force push, repository visibility change, site deployment or hackathon submission. Pause before shared-file edits if the other workstream has changed them. Keep commits focused and merge normally.

Choose one visible improvement at a time, compare an actual Day/Night/phone render to the existing references, and report what changed and what was actually checked. `npm run check` protects copied assets; rerun only relevant browser checks after behavior changes. The current baseline has 21 focused unit cases and 17 applicable desktop/phone browser cases passing, plus one intentional phone animation skip.

Video work remains paused. Preserve existing cuts and the untracked unfinished video kit. No paid AI/provider calls or new payment orders for a visual pass.
