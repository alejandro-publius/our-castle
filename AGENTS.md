# Scope

Work only in this repository. Keep `../crown-and-dust`, the older Tiny Castle project, and the separate SPECS project unchanged. The owner requested a private repository and now authorizes reviewed updates to GitHub main. Claude owns visuals; the Astra workstream owns sponsor/payment/AI integration. Read docs/CLAUDE-VISUAL-HANDOFF.md and docs/ASTRA-INTEGRATION-HANDOFF.md, use focused branches and normal merges, coordinate shared files, and never force push.

The user-defined concept and assistant-proposed defaults are separated in `docs/CONCEPT.md`. The defaults provide a buildable starting point, not claims about the user's real finances. No real financial information or keys are bundled.

Use original bundled art and rendering code; preserve notices and provenance. Treat `references/source` as reference material with historical imports, not as a ready application module graph. The current game is the root page, src/app/main.js and src/world/board-scene.js. The old art-preview page is historical reference.

Do not use live PayPal endpoints, move real money, change repository visibility, deploy/publish a site or submit an entry. A push to the existing private repository is authorized; it does not authorize deployment or submission. Do not run new paid AI/payment checks as part of repository sync or a visual pass. Do not commit `.env` files, account data or credentials. Implemented payment logic needs server verification, idempotency and explicit approval. Every mock/example state must be labeled honestly.

Do not claim the PayPal/AI prototype is complete because the art preview works. Use meaningful tests for ledger, payment confirmation, AI-output validation and progression when those parts exist. Preserve the board/world as the main product view.
