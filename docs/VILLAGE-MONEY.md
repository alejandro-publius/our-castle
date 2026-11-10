# Village contributions and a watched devnet address

The shared project has one immutable settlement type: simulated USD, PayPal sandbox USD, or PYUSD devnet test tokens. They do not add together. The household savings ledger is unchanged. A village receipt can advance the village project, but never adds fictional cash to a family's own goal.

## Direct recipient, explicit approval

`server/payments/village-payments.mjs` receives the fund and recipient from the server's village domain. The payer cannot submit an alternate recipient. An adult reviews an exact amount and current fund revision before an intent is saved. The intent freezes the fund, amount, currency, recipient and its revision. Later share edits or other contributions can advance the fund's ordinary revision without invalidating that approval.

The PayPal adapters include the organizer's merchant ID in `purchase_units[].payee`. Seller-scoped reads and capture carry `PayPal-Auth-Assertion`; the existing household payment path omits these optional fields and retains its behavior. The SDK remains pinned to 2.5.0 and endpoints remain sandbox-only. The optional client is instantiated by the application only when configured; these modules do not load `.env` or discover credentials.

Before capture, the service re-reads the order and compares its recipient, fund reference, amount and currency. After capture, it reads that same order again before creating any receipt. Provider capture IDs are deduplicated globally by the village domain. Durable creation and capture request IDs survive retries; unresolved intents reserve their amount so concurrent requests cannot immediately overcommit the remaining goal. A timeout remains an unknown outcome until a same-order check resolves it.

An authenticated outside adult can approve a contribution only while the organizer publishes the fund. The private intent retains the payer for ownership checks, but its village receipt has no family attribution. That choice is frozen at approval and does not change if the payer subsequently joins the neighborhood. Unpublishing blocks new outside creation or capture dispatch, including after an asynchronous authentication wait. The original adult can still reconcile an existing provider order after publication ends.

After a reload, the original adult can resume a saved intent without resubmitting its amount or destination. A missing order ID remains an unknown creation outcome: retries reuse the saved provider request ID only within six hours of the original approval, matching [PayPal Orders' default idempotency retention](https://developer.paypal.com/docs/api/orders/v2/#orders_create). Beyond that window, the service requires manual reconciliation and keeps the reserved amount; it never invents a new payment or silently releases uncertain money. A known provider order remains available for same-order checking after that window.

Refunds already confirmed by PayPal are reconciled before a delayed capture credit, so a refunded contribution cannot briefly build a project. This feature does **not** send cross-recipient refunds. The organizer must manage those in PayPal; actual account permissions remain a separate acceptance check.

PayPal documents a different payee on its [direct-merchant order path](https://developer.paypal.com/v5/checkout/pay-another-account). Its [platform product](https://developer.paypal.com/platforms/get-started) additionally requires approval and seller onboarding for production; sandbox testing can precede approval. [Immediate capture](https://developer.paypal.com/platforms/checkout/immediate-capture) describes seller-scoped authorization. Adding a payee field does not prove our particular account can capture/refund for another merchant, establish production approval, or remove every legal obligation.

## PYUSD devnet observations

The optional watcher in `server/vault` holds no wallet keys and has no outgoing transaction method. Its only network endpoint is `https://api.devnet.solana.com`; redirects and other hosts, including mainnet, are refused. Construction makes no request. The application must explicitly supply the RPC and start a scan.

Pinned constants, checked against issuer/network documentation on November 10, 2026:

- Mint: `CXk2AMBfi3TwaEL2468s6zP8xq9NxTXjp9gjMgzeUynM`.
- Program: Token-2022, `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`.
- Precision: six decimal places, stored as integer micro-units. No rounding into USD cents.
- Label: **PYUSD devnet test tokens · no monetary value**.

Sources: [Paxos test-network addresses](https://docs.paxos.com/guides/stablecoin/pyusd/testnet), [Solana PYUSD](https://solana.com/pyusd), [Paxos test-token faucet guidance](https://docs.paxos.com/guides/developer/fund-sandbox-with-test-crypto). Requesting faucet tokens is an owner action; no faucet request or wallet transfer was made for these checks.

Enrollment saves a finalized baseline slot. Earlier transfers are not credited to a newly created fund. Each complete scan checks the mint, destination token account owner and program, finalized successful transaction and instruction amounts. One transaction may contain several transfers; its signature and instruction path identify each independently. All pages and transaction reads must succeed before receipts and the cursor commit together. A missing response, repeated page or oversized backlog leaves the cursor unchanged. Previously discovered token accounts stay in the scan set even if subsequently closed.

Unknown senders stay unmatched. A public sender address is not proof that a family controls that wallet. Transfers involving unsupported fees, net balance changes or a closed destination are retained as review issues rather than overstated as credited receipts. These are deliberate bounds of this prototype, not complete coverage of every Solana transaction shape. A large backlog needs an operator-reviewed follow-up; the watcher does not silently skip it.

Watching an address does not prevent its keyholder spending the tokens. This is not escrow, a multisignature wallet, or vote-enforced spending. The app records confirmed incoming transfers, not a guarantee that their recipient still holds the funds. No actual devnet latency or live-wallet acceptance result is claimed.

## Application integration

Schema initializers are `ensureVillagePaymentsSchema(db)` and `ensureVaultSchema(db)`. The root migration calls them after the village schema. They append tables; saved owner databases are not migrated by the test suite. Their fund foreign keys cascade only when a fund is explicitly deleted, including the existing disposable-example reset path.

`createVillagePayments({db, clock, paypal, contextFor, recordReceipt})` exposes:

- `create({scope, fundId, amountMinor, approvalConfirmed, expectedRevision, requestId, assertAccess})`.
- `resume({scope, orderId, assertAccess})`, using only the original adult's saved approval and request reference.
- `capture({scope, orderId, assertAccess})` and `check({scope, orderId, assertAccess})`, where `orderId` is the saved local `vpay_…` ID.
- `list({scope, fundId})`, limited to the current adult's own intentions.

`contextFor(scope, fundId, options)` delegates to `villagePaymentContext(db, scope, fundId, options)`. `recordReceipt(event)` delegates to `recordVillageReceipt(db, event, clock)`. Both are server callbacks, not browser inputs. The application authenticates and preserves session lifetime; the service additionally re-reads the adult and fund scope. Existing-intent checks use `allowSettled: true` to permit safe retries after a fully funded or closed project.

`createVaultWatcher({db, clock, rpc, contextFor, recordReceipt})` exposes `enroll`, `status` and `scan`, each receiving `{scope, fundId}`. `enroll` and `scan` also take `assertAccess`; the application supplies an organizer/session check. That check and a fresh fund context run before transactional persistence after RPC waits. A caller joining an existing scan must still have access when its result arrives. `createDevnetRpc()` supplies the optional read-only transport. The app controls scheduling; nothing starts simply because the module was imported.

A QR code should encode an application fund-review link. Scanning must not create or approve a payment. A localhost QR is useful only on a device that can reach that app; worldwide access needs a separately configured hosted origin and access flow. It is not demonstrated by generating the QR image.

## Checks and remaining evidence

Focused fake-provider tests cover exact recipient wire serialization through both REST and the real pinned SDK, approval and ownership refusals, amount/revision replay conflicts, same-recipient progress changes, pending-amount reservations, restart recovery, expired creation-replay refusal, timeout reconciliation and refund-before-completion ordering. Outside-contributor cases cover private payer ownership, frozen null attribution, publication changes during asynchronous dispatch and readback after unpublishing. Vault fixtures cover finalized-only parsing, other-token rejection, micro-unit precision, multiple instructions, incomplete pagination, atomic rollback, account/mint mismatch, unmatched senders and unsupported net-change review.

All those checks use disposable databases and fake transports; they read no saved household data and contact no payment, AI, faucet or RPC provider. Before claiming live integration, the owner still needs a configured sandbox recipient and successful same-recipient read-back, and a devnet wallet transfer checked by the watcher. No private key should enter this app.

## Bounded competitor check

Public descriptions were checked on November 10, 2026; these are not independent code executions or scores.

- [CreditRoll Live](https://devpost.com/software/paypal-credit-roll-live) describes film-credit reconciliation, Orders, invoice QR and payouts.
- [PayPal AgentOps](https://devpost.com/software/paypal-agentops-control-plane-for-trusted-ai-commerce) explicitly limits its current flow to order creation. Its page says it does not capture or transfer funds, approvals are simulated and audit history is session-local. Describing it as completed payment execution would overstate its own claims.
- [dareskro's creator](https://devpost.com/jlncgn) lists the project and claims seven measured sandbox scenarios with a read-only Claude assistant.
- A bounded search did not establish the supplied exact "Kitty: Autonomous Rotating Savings on PayPal" title. Its existence and details remain unverified here.

The useful product comparison is the continuity of the actual family contribution and shared-building experience, not a count of APIs or an assumed contest ranking.
