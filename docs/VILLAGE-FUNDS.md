# Village funds

A neighborhood may agree on a schoolhouse project and voluntary family shares. A share is a promise, not debt or confirmed money. The fund has its own receipt history and never adds village contributions to a household's private savings ledger.

Each fund has exactly one payment rail: simulated USD cents, PayPal sandbox USD cents, or PYUSD devnet micro-units. A test token has no monetary value. Values from different rails are never added together. The recipient is fixed when the fund is created; another recipient requires another fund.

The founding family's adults create, publish or close a fund. Every adult changes only their own family's commitment. Members of that invited neighborhood can read agreed shares and fund receipts. The public-by-link projection is an explicit adult opt-in and contains only the project, aggregate progress and organizer alias. It omits family shares, receipts, recipient account details and private household records. Castle tier and crest sharing is a separate opt-in, off by default.

## Service contract

`villageView(db, scope)` and `villageFund(db, scope, fundId)` recheck current neighborhood membership. The HTTP or MCP caller must also enforce a current session. `villageAction(db, {scope, actor, action, input}, clock)` rechecks the acting adult from the database; mutable actions require explicit confirmation and the current fund revision. Actions are `create`, `share`, `publish`, `close` and `share-castle`.

`villagePaymentContext(db, scope, fundId, {allowSettled})` supplies the server's exact rail, recipient, target, revision and remaining amount. The default refuses new contributions to closed or complete funds. `allowSettled` permits reading existing payment truth while preserving adult and membership checks; it never reopens the fund.

A signed-in adult outside the neighborhood may support an explicitly published fund. `villageReview` gives that visitor public project totals and the recipient to review, with empty shares and receipts. The visitor does not join the circle. Their payment intent remains private to them, while the shared receipt has no family attribution. `attributionHouseholdId` is therefore null for an outside supporter and must be frozen in the payment intent. An arbitrary sending wallet never proves a family identity.

Unpublishing immediately removes new outside support. The only exception is checking a payment the same adult already owns: `allowSettled` requires an actual matching stored intent before an unpublished fund's context is returned. The payment adapter must still refuse a new create/capture dispatch after publication ends, while retaining already-confirmed provider truth. This is an internal context callback, not an anonymous authorization route.

Only a trusted server payment adapter calls `recordVillageReceipt`. Its event binds `fundId`, `source`, `eventRef`, `eventIndex`, `kind`, `amountMinor`, `recipient` and optional server-proven `familyHouseholdId`. Refunds/reversals additionally bind `parentRef` and `parentIndex`. Event indices are instruction paths such as `3.1`, so several transfers in one transaction stay distinct. Capture/transfer amounts and refund/reversal amounts are positive integers; the event kind determines their effect.

Source-event identity is globally unique across funds. An identical replay is harmless; changing its fund, recipient, amount, family or meaning is rejected. A refund can arrive before its capture and is applied before project progress is derived. Effective refunds are capped at the original capture; overlapping provider facts cannot create negative progress. Unmatched transfers remain unattributed and are counted separately in `progress.unmatchedMinor` and `unmatchedCount`.

Project stages reuse the existing schoolhouse thresholds, 0%, 25%, 60% and 100%. They follow current net receipts, so refunds can move the project back. Promised shares do not build the project. The service returns household IDs only to trusted server code for existing revision-only live notifications; the public DTO uses opaque family references.

## Storage and evidence

Schema 15 appends `village_funds`, `village_shares`, `village_receipts` and `village_presentations`. Existing records are preserved. `assertVillageLeaveAllowed` keeps the organizing neighborhood's fund history and requires an adult to withdraw an open voluntary commitment before leaving. HTTP integration calls it before Exchange leave. Closed funds retain their receipts.

`clearExampleVillage` is restricted to an in-memory database whose entire neighborhood consists of authored example households. It exists only for the separate demo's Reset. It refuses saved database files and real-family fixtures.

Focused tests cover authorization, private defaults, optional public projection, commitments, exact recipient/source binding, replay and cross-fund conflicts, out-of-order refunds, unattributed deposits, late settlement, restart/two-handle deduplication and reset restrictions. All data is synthetic; these are source/service tests, not evidence of a live payment, wallet ownership, merchant eligibility or a deployed multi-family service.
