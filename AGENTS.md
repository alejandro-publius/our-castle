# Scope

Work only in this repository. Keep `../crown-and-dust`, the older Tiny Castle project, and the separate SPECS project unchanged. The owner initially requested private development, then reviewed main updates, and on November 5 asked Codex to finish the remaining integration and release work directly. Read docs/RELEASE-READINESS.md for the actual publication/connection state. The visual and integration handoffs remain useful boundaries; preserve the current woodland rather than start a replacement build. Use focused branches and normal merges, and never force push.

The user-defined concept and assistant-proposed defaults are separated in `docs/CONCEPT.md`. The defaults provide a buildable starting point, not claims about the user's real finances. No real financial information or keys are bundled.

Use original bundled art and rendering code; preserve notices and provenance. Treat `references/source` as reference material with historical imports, not as a ready application module graph. The current game is the root page, src/app/main.js and src/world/board-scene.js. The old art-preview page is historical reference.

Do not use live PayPal endpoints or move real money. The latest reviewed source-release request supersedes the older private-only preference; it does not permit uploading owner keys/data, broadening the original-art licence, or claiming the incomplete video/entry is submitted. No hosted application is deployed. Do not run paid AI/payment checks merely for sync or visual work. Only the previously approved isolated $15 sandbox checkout and necessary same-order steward check are authorized; preserve its existing 3021 rehearsal and inspect current order state before proceeding. Do not commit `.env` files, account data or credentials. Payment logic needs server verification, idempotency and explicit amount approval. Every mock/example state must be labeled honestly.

Do not claim the PayPal/AI prototype is complete because the art preview works. Use meaningful tests for ledger, payment confirmation, AI-output validation and progression when those parts exist. Preserve the board/world as the main product view.

## PayPal context for Codex

Before PayPal SDK work, read `.agents/skills/typescript-getting-started/SKILL.md`, then its relevant companion skills. These are the SDK-specific APIMatic/PayPal context files pinned in `.agents/apimatic-paypal/provenance.json`; verify examples against the installed `@paypal/paypal-server-sdk` 2.5.0 source. Preserve the exact dependency pin and the existing payment safeguards. See `docs/APIMATIC-CODEX.md` for installation and discovery evidence.
