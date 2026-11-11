# Critique brief: read this source, change nothing

For the owner's other AI agents. You are asked to take Our Castle apart critically. You are not asked to fix it.

## Rules

- **Read only.** No code edits, commits, pushes, branches or pull requests. No comments on GitHub unless the owner asks for them.
- **No provider calls.** Do not contact PayPal, Anthropic, OpenAI, Cohere, Channel3 or any Solana RPC, and do not supply keys.
- **No saved data or running apps.** Do not open, copy or migrate any household database or `.env`, and do not start, stop or reconfigure the owner's apps. If you must run something, `npm run demo` and its flags start a disposable in-memory example that reads no key and no saved record.
- **Evidence with every finding.** Give the file and line (or the test, or the document section) at the exact commit you were pointed to, what you expected, what the source does, and how sure you are. Say when something is a guess. A finding without a source location is an opinion.
- **Pin the commit.** Critique the commit the owner gave you. If you were given a branch, record the commit it resolved to.

## Where to look first

| Question | Start here |
| --- | --- |
| What is this, and what is claimed? | `README.md`, then [release readiness](RELEASE-READINESS.md) for what is and is not live |
| How is it put together? | [architecture](ARCHITECTURE.md); `server/app.mjs` composes everything |
| The one-minute route | [shared project, five families](VILLAGE-DEMO.md): `npm run demo -- --village-fund` |
| Two fresh families from nothing | [first use](VILLAGE-FIRST-USE.md); `test/e2e/village-first-use.spec.mjs` |
| What was actually checked, and what was not | [validation](VALIDATION.md), newest first |

## Boundaries worth attacking

Each of these is a claim the source makes. Try to break it by reading.

- **The server owns the money facts.** Amount, currency, recipient and household come from the server, never the page. `server/payments/contributions.mjs` (household contributions), `server/payments/village-payments.mjs` and `server/village/index.mjs` (shared funds; `recordVillageReceipt` is the only way a receipt is written).
- **One credit per capture.** Idempotency by request id, reconciliation before credit, refunds reverse progress. Same files, plus their tests under `test/unit/`.
- **A promise is not a payment.** Voluntary shares never add progress: `villageAction` and `accounting` in `server/village/index.mjs`.
- **Private stays private.** A shared fund never shows a household's own savings; an outside reviewer of a published fund gets no family list: `villageView`, `villageReview`, `publicVillageFund`.
- **Adults approve, children cannot.** Server side `adult()` in `server/village/index.mjs`; page side `src/app/village-fund.js`. Sign-in is a passkey (`server/access/`); a passkey sign-in is not a signature over a payment.
- **AI proposes, the server checks.** Planner output is validated (`server/planner/validate.mjs`); the steward and the village treasurer only read (`server/steward/`); the sentence draft is rules by default (`server/planner/village-draft.mjs`). No model can move money.
- **The MCP bridge only reads.** One adult-selected fund, short-lived and revocable: `server/mcp/capabilities.mjs`, `scripts/mcp.mjs`, [its note](CASTLE-MCP.md).
- **The devnet watcher only watches.** `server/vault/`; [money adapters](VILLAGE-MONEY.md).
- **Scope changes.** A member or household change must never show the previous one's fund: `render()` in `src/app/village-fund.js`, cases in `test/e2e/village-square.spec.mjs`.
- **Loading feedback.** The dragon covers the page only while the whole page is waiting (`src/app/realm-loader.js`); every other wait keeps its window and says what it is doing.

## Evidence gaps the project already admits

Check that these are stated honestly wherever a claim depends on them, and look for places where a document claims more.

- Almost everything is checked against fake providers on disposable data. The only live payment evidence is one historical $15 sandbox capture on an older release.
- No sandbox recipient account and no devnet wallet exist. Cross-account capture and refund, and a real devnet transfer, have never been exercised.
- Recurring agreements are tracked, not collected: no charge or refund is ingested.
- Browser checks use Chromium, virtual authenticators and an emulated phone. No person, physical device or screen reader was involved.
- The world is rendered in software in CI; nothing here is a performance claim.
- Twelve dependency packages remain audit-flagged ([toolkit maintenance](TOOLKIT-MAINTENANCE.md)).
- The merged source is not what the owner's saved apps run.

## What a useful report looks like

Lead with the most serious finding. For each: severity, the claim it breaks, the exact location, a short reproduction by reading or by the disposable demo, and what you did not verify. Keep praise out; list what you checked and found sound in one line each so the owner knows the coverage.
