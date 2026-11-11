# One shared project, five families

This route is part of the combined village and loading release described at the top of [release readiness](RELEASE-READINESS.md). While the realm starts you may briefly see the knight and dragon; the scene leaves the moment the realm is ready.

Run `npm run demo -- --village-fund` after `npm ci` on Node 22.16 or later. This creates a disposable in-memory village, binds an unused loopback port, ignores `.env` and inherited provider credentials, and leaves saved households and existing servers untouched.

1. The parchment opens **Class trip together**. Four invented neighboring families have each contributed $50; the shared fund starts at $200/$400. Alder's separate private goal remains $60/$300.
2. Enter **40**, approve that exact amount, then contribute. The shared total becomes $240 and the schoolhouse moves from survey stakes to its second construction stage. It represents funding progress, not proof that a trip or physical building was purchased.
3. Open **Records** to inspect the single simulated receipt. **Families** separates voluntary commitments from recorded contributions. A family cannot promise another family's money.
4. **Visit the shared square** shows the shared schoolhouse and up to six original castle miniatures. Every family remains in the accessible list. Actual castle tier and crest appear only after adult opt-in; private amounts do not appear on homes.
5. **Join the square** opts this page into temporary presence. Move with its controls. Seeded family names are not invented online visitors. Leaving, signing out or expiry removes presence.
6. **My realm** restores the private view and its unchanged progress. Refresh keeps one shared contribution while the process runs; closing this demo discards its records.

Starting from nothing instead: [two fresh signed-in families](VILLAGE-FIRST-USE.md) can start a neighborhood, describe a project, invite each other and contribute through the same controls, in the separate family mode.

## What is implemented

| Track | Source behavior | Evidence boundary |
| --- | --- | --- |
| Shared fund | Neighborhood-bound project, voluntary own-family shares, immutable receipt events, refund-aware progress and explicit publication | Disposable multi-family HTTP and persistence tests |
| Money in | Orders freeze a server-validated sandbox recipient and exact adult-approved amount; capture/readback count once; reload resumes the retained approval | Fake REST/real-SDK transports; no new sandbox transaction |
| Outside support | A shared review link/locally generated QR exposes only explicitly published project details; a signed-in outside adult can contribute without joining or revealing their family | Local HTTP checks; localhost QR is not reachable from another device |
| PYUSD | Fixed Solana devnet mint, finalized paginated reads, atomic cursor and signature/instruction deduplication, separate six-decimal test-token accounting | Fake RPC; no wallet, faucet send or real devnet acceptance yet |
| Shared world | Original schoolhouse/home/forest art in the existing renderer; shared ribbon, exact private-view restoration, consented expiring visitors | Desktop and 390 px browser checks; no human or physical-device claim |
| Treasurer | One explicit amount/date becomes a reviewed proposal and suggested shares/schedule; scoped questions use recorded net facts | Built-in rules by default; optional AI phrases the title, with independently checked facts |
| Assistant bridge | Three local stdio MCP read tools, one adult-selected fund, short-lived revocable access | Real SDK protocol/child-process tests; no owner Claude/ChatGPT connection claimed |
| Recurring agreements | Durable exact-term review, seller-bound sandbox adapter, known-ID recovery and checked agreement status | Disabled by default; requires platform eligibility; recurring charge/refund ingestion is not implemented |

Each fund chooses one rail: simulated USD, PayPal sandbox USD, or **PYUSD devnet test tokens with no monetary value**. The totals are never mixed. A watched address is controlled by its wallet owner; observing it does not enforce a vote, restrict spending, prove an expense was paid, or establish that the funds remain available. Unknown senders stay unattributed; pasting a wallet address does not prove ownership. No private keys, outgoing token transfers, payouts or mainnet path are included.

## Before an actual recipient or wallet demonstration

The owner does not yet have the separate sandbox recipient or devnet wallet. Set these up together when needed; keep credentials and recovery phrases out of chat and Git. A documented PayPal `payee` field does not prove this app's account can capture for another seller or handle that seller's refunds. The next acceptance check must establish the exact account capability and recipient behavior before making that claim. Devnet acceptance separately requires the official test mint and a wallet-approved test send. Neither account setup nor a financial transaction was performed by this source change.

Subscription settings are intentionally separate from ordinary checkout. Platform access, seller onboarding, BN code and a seller catalog product must be established before configuring them. An approval link is not an active agreement, and an active agreement is not an imported contribution. The current `CONTINUE` buyer flow does not automatically activate it. The UI does not advertise automatic weekly collection.

Use [funds](VILLAGE-FUNDS.md), [money adapters](VILLAGE-MONEY.md), [the square](VILLAGE-SQUARE.md), [treasurer and recurring limits](VILLAGE-TREASURER.md), and [MCP](CASTLE-MCP.md) for the source contracts. Hosted checks and exact source identifiers belong in [validation](VALIDATION.md). This work does not deploy an app, migrate saved databases, make a video, submit Devpost or supply family playtesting evidence.
