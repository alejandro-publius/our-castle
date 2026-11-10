# Village source checkpoint for Claude — November 10, 2026

The owner asked Codex to stop at a reviewable checkpoint so the existing Claude terminal can take over. This is a source handoff, not a claim that every provider integration is live or that this branch is on main.

## Exact source

- Repository: `alejandro-publius/our-castle`.
- Base main: `84a35b171716c4e32bec4058147287366838ac14` (PR #78).
- Integration branch: `codex/village-integration-20261110`.
- Implementation checkpoint before this handoff document: `b2bb391`.
- Included heads: money `b4c01d5`, fund `7b97cd8`, world `3f978e8`, treasurer `9878574`, MCP `dc9c8f4`; root HTTP/demo wiring `5d2addb`, recurring membership guard `fe7c5d3`.
- Schema 17, 43 application tables. No saved owner database has been opened or migrated.

Read `AGENTS.md`, [release readiness](RELEASE-READINESS.md), [the one-minute route](VILLAGE-DEMO.md) and [validation](VALIDATION.md) first. Create a fresh worktree at the fetched integration head; preserve the existing Claude worktree and its drafts. Do not restart the old tasks or recreate already integrated features.

## What works locally

`npm run demo -- --village-fund` starts a disposable five-family class-trip example. Four invented neighbors have contributed $200 in total. An explicitly approved simulated $40 contribution advances the shared schoolhouse to stage 2 and records one additional receipt. Returning to the private realm still shows $60; reloading retains the same five shared receipts without duplicate credit.

The branch includes neighborhood-bound funds, voluntary own-family commitments, public-minimal review links and QR, recipient-bound PayPal sandbox adapters, a read-only finalized devnet watcher, a shared square using original art, opt-in temporary presence, reviewed sentence-to-fund proposals, scoped record answers, and a revocable local MCP read bridge. See the individual `VILLAGE-*` and `CASTLE-MCP` documents for contracts and limits.

## Actual checks at handoff

- 185 distinct named backend cases passed across focused new and affected existing checks on Node 24.22.1. This is an aggregate of focused runs, not a claim that the entire suite ran locally on the final head.
- Two real-server browser journeys passed: desktop 1440×1000 and emulated phone 390×844, at `fe7c5d3`. Each performed exactly one contribution POST, preserved the private ledger, restored the private scene, and reloaded without duplicate credit. Their portable reports are [desktop](evidence/village-fund-desktop.json) and [phone](evidence/village-fund-phone.json).
- C2 scoped UI checks at `5070756`: five passes and one intentional phone skip of the identical MCP lifecycle case. These use explicit fake API responses, separately from the real-server journey.
- C3 reproduced and fixed zero-share withdrawal, while keeping zero payments disabled. Its focused desktop regression also checks that a delayed old-member grant cannot repopulate another member's UI. One browser case and two presentation units passed. The new regression is selected by the existing village CI job.
- The original-art/palette/renderer/syntax guard and diff whitespace check passed on `b2bb391`.
- Exact-head hosted results belong on the integration PR. They are pending at this checkpoint; do not call them green or merge solely from these local results.

## First bounded task for Claude

1. Reproduce this inspection finding before changing production code: in `src/app/village-fund.js`, `render()` clears `village` on a scope change but retains `stateVillage`. The example persona selector calls `render()` without necessarily replacing `state.village`, so its identity cache may leave the Village fund button hidden until another state update. This is a **suspected** defect, not yet a demonstrated failure.
2. Exercise the real example member selector: adult → child → adult, with the same state projection. The fund must remain discoverable where intended; child approval must remain disabled. Verify that any correction cannot reuse a previous signed-in household's private fund projection after a real access-scope change. Keep the C3 delayed-grant regression intact.
3. If reproduced, make the smallest correction and add a focused regression. If not, record the truthful result. Do not add a new product feature or weaken access boundaries to make the button visible.
4. Review the integration PR's exact-head hosted checks and any raw failure evidence. Fix only concrete failures, preserving assertions and dependency pins. The workflow has three unit/Rust jobs, three release-browser jobs, two kit-planner jobs and two village jobs. Run only affected local checks; run required hosted checks for a changed head.
5. Report exact head, changed files, actual checks and remaining limits. Keep the PR unmerged for final integration review; no saved-runtime activation belongs in this task. This bounded correction is the next stopping point, not an open-ended feature campaign.

## Remaining setup is not implemented proof

The owner has no separate sandbox recipient or Solana devnet wallet yet. Guide their setup later; never ask for a recovery phrase or paste credentials into chat. Fake transports do not establish seller eligibility, cross-account capture/refund behavior, or an actual devnet transfer. A watched wallet neither enforces spending votes nor proves a utility bill was paid.

Recurring agreement support defaults off and requires platform eligibility/onboarding. It retains exact terms, provider identifiers and recovery state, but does not import recurring charges or refunds; the `CONTINUE` flow does not automatically activate the agreement. Do not advertise automatic weekly collection. MCP protocol tests do not establish a real owner Claude/ChatGPT connection. Human playtesting, recording, deployment and submission remain outside this source work.

## Operating boundaries

Use disposable local example/family data, synthetic empty configuration, `.env` disabled and fake providers; deny non-loopback app transports in checks. Do not read/copy/mutate saved databases or private configuration, alter the completed $15 sandbox order, signal existing owner/rehearsal/preview processes, or touch original/final-release checkouts. No real provider calls, wallet sends, credentials, payouts, refunds, account switches, credit purchases, recording, deployment, publication, Devpost submission or messages to people. Public documentation and normal-history focused source branches/PRs are allowed. No force push, reset or rebase.

The existing terminal remains the only Claude worker. The new source worktree belongs to that worker after acceptance; Codex has stopped source edits. Respect any active controller lease before queue/ownership changes. Preserve the compact parchment interface, original art/licences/palette, amount-specific adult approvals, private household boundaries, immutable receipts and idempotency.

The newly supplied Meta winners list is future research input. No claim about those projects was independently verified in this checkpoint, and no winner-inspired feature was added.
