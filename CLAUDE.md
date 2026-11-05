# Claude project instructions

The owner assigned **Claude the visuals** and **Astra the sponsor/integration engineering**, and authorized syncing the working game to private GitHub main. Read AGENTS.md and docs/CLAUDE-VISUAL-HANDOFF.md before edits. Astra's scope and integration evidence are in docs/ASTRA-INTEGRATION-HANDOFF.md.

The complete game is the root page, driven by src/app/main.js and src/world/board-scene.js. The original /art-preview.html is historical reference. Do not replace the current game with the starter, a generic finance dashboard or a flat board.

Current world: nine clearings in one 228×132 forest, nine raised/lowered bridges, six flowing river channels, retained earlier homes, the ivory Citadel stag, Starfall Observatory, Rosewind Palace, Rapunzel's Tower and a camera-only hidden sword grove. The new cloud shader has recognizable white cumulus crowns, overlapping continuously with varied contours and thin wisps; no flat grey gaps or murky noise wash. Inspect the PNGs named in the visual handoff.

Preserve the copied PixelRenderer, original 90-colour palette, assets/fonts/notices and all portrait provenance. New art must stay in that family. The earned court remains twenty; small tower figures are scenery. New towers share existing 60%/100% milestones. The secret never credits money or grants a district reward.

Interface: the world leads. One collapsible journal contains House, Plan, Contribute, Ledger. Keep ivory/ink Uncial plaques, compact Areas/View/World settings, one general footer notice, sparse non-overlapping overview labels, a map-height-limited scrolling Areas menu, and the accessible discovery glint. No Rewards catalogue, slogans, repeated notices, architecture paragraphs or “preview/prototype” product headings. Short deeds contain only name, pixel art/crest, a milestone line and Visit/Next/Close. Exact approval/errors and actual source/status remain attached to actions/receipts.

Astra owns server/payment/AI code, dependency upgrades and ledger/provider semantics. Coordinate src/app/main.js, src/core/realm.js, src/core/deeds.js and index.html edits. Visual changes must not weaken amount-specific adult approval, server capture verification, idempotency, same-order reconciliation or access conditions. Utility bills remain reported/connection-required unless genuine authorized provider evidence exists.

Work on a focused visual branch from updated main. The owner authorizes reviewed pushes to the existing private repository; use normal merges and never force push. Keep .env/account/household records untracked. No repository visibility change, site deployment, hackathon submission, real financial transaction, new order or paid AI/provider test for this visual pass.

The owner's configured app remains on 3010; the separate 3021 rehearsal belongs to its existing sole browser operator. Neither is an example-test fixture. Use a separate unused port and no-credentials temporary example database. Do not ask for another API key based on old session memory. If an existing Claude session is open, continue it rather than starting another.

Read docs/VALIDATION.md for evidence and limits. Source/47-asset/palette guards and focused no-provider checks are useful; do not claim a live checkout or get_order flow from fake transports. Run only checks relevant to new changes. The owner paused all further videos: preserve existing cuts/raw/unfinished source and do not resume recording or exports.
