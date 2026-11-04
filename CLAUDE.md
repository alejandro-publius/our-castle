# Claude project instructions

This is the Our Castle build handoff requested by the repository owner. Follow AGENTS.md and read the documents in README's order. The visual source is concrete and bundled: inspect the PNGs and run the art preview. Preserve the Tiny Castle miniature family and 90-color renderer. Do not substitute an unrelated design system.

Build the financial board game described here. The previous card battler and Lens Studio projects are outside this repository and must not be modified. This is a browser project; no SPECS/Meta hardware is required for this hackathon.

The browser prototype is implemented. Read README.md and docs/VALIDATION.md for the checks actually performed and the remaining integration gaps; do not infer that every flow is complete. Distinguish example mode from real sandbox mode. Do not let a client callback or redirect alone credit a contribution. Multi-user authentication and automatic utility-bill verification are not implemented.

The current visual target is a connected six-district **woodland** realm. The owner specifically rejected replacing one central home on a small plot: retain the village, manor, keep and citadel in separate locations. The landscape is one continuous green forest with the districts as clearings, separated by narrow winding rivers that pass under the six bridges; there is no ocean around the plots. Castles are embellished in full colour, including locked ones. Locked districts are shown by their named labels, raised bridges and closed gates, never by greying the landscape or the buildings. Inspect `docs/screenshots/forest-*.png` and the woodland section at the top of ART-DIRECTION.md; the older `realm-*.png` captures show the superseded grey-island revision. `src/core/realm.js` defines geography and access; `src/world/realm-models.js` draws it. The original small `/art-preview.html` remains historical art reference, not the current spatial layout.

Run `npm run check` before changing copied reference assets; update provenance deliberately if an authorized new asset replaces one. Preserve `/art-preview.html` as a reference even when the application gets its own home route. Add appropriate dependency manifests, run instructions, tests and server-side secret handling as the application is built. Private visibility must remain unchanged.


Product language: the playable world is a game, never an “art preview” or a “prototype” in user-facing headings, buttons or destination descriptions. Use Explore for future destinations, Visit for earned ones, the actual district name, the real unlock condition, and Return to your realm. Keep truthful sandbox/simulated payment labels, self-reported savings and connection-required bill status. Internal inspection flags and preserved historical references may retain their old names; do not turn copy changes into financial or entitlement changes.


The Rewards catalogue and fifth journey tab were explicitly deleted by the owner. Keep the interface small: House, Plan, Contribute, Ledger, the world map and automatic unlock deeds. Earned deeds reopen from a selected district's View deed button; do not reintroduce a rewards/architecture/evidence catalogue or a future-tier tour banner. Preserve real access conditions and accurate financial records.
