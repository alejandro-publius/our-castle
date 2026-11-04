# Claude project instructions

This is the Our Castle build handoff requested by the repository owner. Follow AGENTS.md and read the documents in README's order. The visual source is concrete and bundled: inspect the PNGs and run the art preview. Preserve the Tiny Castle miniature family and 90-color renderer. Do not substitute an unrelated design system.

Build the financial board game described here. The previous card battler and Lens Studio projects are outside this repository and must not be modified. This is a browser project; no SPECS/Meta hardware is required for this hackathon.

The browser prototype is implemented. Read README.md and docs/VALIDATION.md for the checks actually performed and the remaining integration gaps; do not infer that every flow is complete. Distinguish example mode from real sandbox mode. Do not let a client callback or redirect alone credit a contribution. Multi-user authentication and automatic utility-bill verification are not implemented.

The current visual target is a connected six-district realm. The owner specifically rejected replacing one central home on a small plot: retain the village, manor, keep and citadel in separate locations across bridges and waterways. Locked future districts remain visible in grey, with raised bridges. Inspect the current `docs/screenshots/realm-*.png` captures and the connected-realm section of ART-DIRECTION.md. `src/core/realm.js` defines geography and access; `src/world/realm-models.js` draws it. The original small `/art-preview.html` remains historical art reference, not the current spatial layout.

Run `npm run check` before changing copied reference assets; update provenance deliberately if an authorized new asset replaces one. Preserve `/art-preview.html` as a reference even when the application gets its own home route. Add appropriate dependency manifests, run instructions, tests and server-side secret handling as the application is built. Private visibility must remain unchanged.
