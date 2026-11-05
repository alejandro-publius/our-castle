# Original district card illustrations

These seven 320 × 176 PNGs are original stills of Our Castle's own miniature woodland, rendered through the existing 90-colour pixel pipeline. They are not downloaded game art. The images keep the existing colourful roofs, heraldic accents, trees, rivers and bridges.

The images depict all districts in an art-preview state so each card can show its destination. An illustration never grants access or supplies payment or bill-provider evidence. The UI must independently label locked, earned and commemorative states from the server.

`provenance.json` records the exact source commit, scene-file hashes, rendering settings and final image hashes. Source code and bundled notices retain their existing licenses; see the repository LICENSE and asset manifest.

To reproduce, run `node assets/area-cards/generate.mjs` from a checkout with its existing Playwright dependencies. The script refuses an occupied port 3152, creates its own temporary example database with no credentials, draws the existing models in a fresh browser context and closes its server. It does not control the owner's browser, write household entries or call payment/AI providers. Raw 640 × 352 captures are written under ignored `test-results/area-card-art/`; the delivered images are exact nearest-neighbour 2:1 reductions with no smoothing.

Display with explicit width/height and `image-rendering: pixelated`. The PNGs need no new image-generation service or runtime network dependency.

Rosewind is a later, separately rendered addition. Its exact source/image hashes and Day/Clear/zoom settings are in `palace-provenance.json`. Reproduce only that portrait with `node assets/area-cards/generate-palace.mjs`; it refuses occupied port 3166 and starts its own no-credentials example server. The six older portraits, generator and provenance remain unchanged.
