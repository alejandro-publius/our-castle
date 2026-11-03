# Scope

Work only in this repository. Keep `../crown-and-dust`, the older Tiny Castle project, and the separate SPECS project unchanged. The owner explicitly requested a private repository and a Claude handoff.

The user-defined concept and assistant-proposed defaults are separated in `docs/CONCEPT.md`. The defaults provide a buildable starting point, not claims about the user's real finances. No real financial information or keys are bundled.

Use original bundled art and rendering code; preserve notices and provenance. Treat `references/source` as reference material with historical imports, not as a ready application module graph. The runnable scene is `src/art-preview.js`.

Do not use live PayPal endpoints, move real money, change repository visibility, publish a site or submit an entry. Do not commit `.env` files, account data or credentials. Implemented payment logic needs server verification, idempotency and explicit approval. Every mock/example state must be labeled honestly.

Do not claim the PayPal/AI prototype is complete because the art preview works. Use meaningful tests for ledger, payment confirmation, AI-output validation and progression when those parts exist. Preserve the board/world as the main product view.
