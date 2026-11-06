# Interface direction — game controls

Build target: Alex's two screenshots identify the surrounding interface to simplify. Preserve the existing pixel realm, original assets, fonts, palette, river flow and collectible deeds. This is a direct rework of the existing interface, not an exploration of a new visual identity.

## Reference lock

Primary: the existing Our Castle game and the owner's explicit “less is more” / one-disclaimer direction. [Wayfinder](https://wayfinder.nfb.ca) (Refero style 168f20ae-b58e-4781-b9b8-46b2d9b81b5f) contributes world-first composition and discreet controls. [MekaVerse](https://themekaverse.com) (f5e5d282-4361-4654-aac2-c8b5cd8214b1) contributes lightweight navigation over a large world, without its crypto palette or fonts. [Haley Park](https://haleys.design) was reviewed for restraint but its oversized editorial typography is not adopted.

Concrete patterns: Refero's [PamPam action sheet](https://refero.design/pages/9090d9cd-342d-4359-b34a-e7c720d0dd5c) and [OneSoil map controls](https://refero.design/pages/068decb6-d789-47de-9eda-f5670e1aa513) put occasional controls into menus and retain the map as the main area. Do not import their dashboard tiles, search fields or colors.

| Decision | Source / role | Reason |
| --- | --- | --- |
| One compact goal display | Owner's repeated-summary screenshot | Show the goal and current progress once |
| Large world beside one collapsible journal | World-first references + existing four actions | Keep the game visible during setup, planning and contributions |
| Settings and district list open on request | Map popover references | Remove rows of permanent controls |
| Quiet Uncial wordmark; Alegreya for fields and amounts | Existing owned fonts | Distinguish names from functional information |
| Existing dark canvas, ivory ink/paper, brass for actions | Owned brand and owner's parchment request | Preserve identity without inventing a new finance theme |
| One general notice in the footer | Owner's explicit instruction | Remove repeated sandbox, persona, model and bank-balance paragraphs |
| Exact-amount approval and source labels on actual records | Existing payment behavior | Keep consent and transaction facts without repeating general notices |
| Schedule visible; arithmetic and secondary records disclose on request | Existing plan and source-traceability requirements | Preserve useful depth without a wall of text |
| “Find an item” beside Goal in Plan | Existing Goal field, text actions and Market Town dialog | Let a family choose a product goal without first finding Market Town; reuse the same draft and confirmation flow |

Reject: slogans, duplicate headings and progress summaries, always-visible six-card district catalogue, repeated mode warnings, technical model IDs in the main header, nested bordered callouts, decorative icon clutter, and a replacement finance dashboard.

Use code-native HTML controls and the existing artwork. No generated assets are needed. Menus must support Escape and focus return; the journal must be reachable by keyboard, and phone layouts must retain readable fields and 44 px controls. Closing the journal never resets data. Real payment approval, example/sandbox distinctions in the single notice and receipts, provider-required rewards and server verification remain intact.

## Verification target

Compare actual desktop and phone captures with the owner screenshots: one visible general notice; the world occupies the main viewport; utility controls are closed until requested; only one active journal surface; all four actions, amount approval, status errors and saved records remain reachable. Test only changed navigation and representative existing flows, with isolated example data. No PayPal order, paid AI call, publication or deployment.
