# Notices and asset scope

The MIT license at the repository root covers the application source authored for this project. Three.js 0.170.0 retains the MIT notice in `vendor/three/LICENSE`. Uncial Antiqua and Alegreya Sans remain under their bundled SIL Open Font License notices in `assets/fonts/`.

Tiny Castle brand artwork is the repository owner's existing material, supplied for this project at the owner's request. Original miniatures, portraits, renderer, palette and reference screenshots were created for the owner's Crown & Dust project. Their precise copies/source commit/hashes are recorded in `assets/manifest.json`; original brand provenance is retained unchanged. Their inclusion does not grant a general license to use the Tiny Castle name or brand artwork for unrelated products. The owner should settle any broader original-art licensing before public distribution.

Hollybrook Open and Nightshoal are inspiration links/descriptions only. Their source, screenshots, models, music and other art are not bundled. The owner later supplied a written description of Hollybrook Open's code structure; only general principles from it were applied (an event bus between systems, logic testable without the renderer, deterministic test hooks, pixel-snapped orthographic rendering). No Hollybrook code was copied. No Monopoly artwork, branding or source is included.

## Dependencies added for the application

- `@anthropic-ai/sdk` 1.4.0 (MIT), installed from npm as the runtime AI client. Not vendored.
- `@playwright/test` 1.64.1 (Apache-2.0), development-only end-to-end test runner. Not vendored.
- The PayPal JavaScript SDK v6 is loaded at runtime from PayPal's sandbox host only when sandbox credentials are configured. It is not bundled in this repository.

The board scene (`src/world/board-scene.js`), crest SVG (`src/app/crest.js`) and application code are new source written for Our House under the root MIT license. The crest's crown and leaf charges adapt the owner's original sigil paths from `references/source/heraldry.reference.js`.
