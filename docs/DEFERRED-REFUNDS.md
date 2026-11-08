# Verified refunds arriving before their capture

Task009's final deterministic probe found an ordering that its 200-seed scan had not exercised: a server-owned capture completed at the fake provider, but both its answer and the following read were lost. The refund's verified webhook arrived before any local capture row existed. The server marked that event handled and discarded its amount. A later completion credited the gross amount and could award the Manor even after a full refund; replaying the already-handled refund did not repair it.

This extends the known-capture fixes in PR46. Four full/partial, REST/SDK-adapter cases fail against eefae41 with $75 tracked instead of $60/$70.

## Durable evidence, then ownership

Schema8 adds deferred_refunds: refund id, capture id, cents, currency and receipt time. Only a verified completed refund with valid typed fields reaches this private holding record. It has no household attribution, ledger effect, milestone, buyer details, raw body or family-facing query.

When the ordinary capture validation establishes the server-owned order, matching evidence enters the existing refund pipeline. Credit, reversal, removal of the held receipt and milestone decisions join the same SQLite transaction. A pending capture can bind the receipt without crediting anything, retaining it for a later completion. Duplicate events and refund IDs do not create another credit or reversal. Invalid signatures are not retained.

No new provider request, payment/refund operation, endpoint, dependency, startup reconciliation or UI control is added. Opening the database migrates the local schema only; reopening dispatches no provider call. Owner/rehearsal data and applications were not opened or migrated during this work.

## Migration and snapshot checks

The migration is additive. The existing repair rule remains specific to the historical ambiguous schema5/6 branches; a valid integrated schema7 advances directly to8. Migration tests include the actual seven-step predecessor and the new current schema, preserve existing rows and require the same schema as a fresh database. Snapshot tests now express current/future versions from MIGRATIONS.length; the backup command's behavior is unchanged.

The example reset also clears this private evidence table. No owner reset or restore was run.

## Evidence

Local artifacts: test-results/refund-before-capture-20261108/.

- before.log: all four cash-balance reproductions fail on the reviewed PR46 source.
- affected-node22.log and affected-node26.log: 130 affected cases, 129 pass and one existing skip, no failures on Node22.16.0/26.0.0.
- Twelve new regressions cover full/partial refunds before any capture, persistence through close/reopen, duplicate deliveries, a later pending observation, signature rejection, wrong-order rejection and rollback that retains the receipt if writing the reversal fails.
- Existing refund-ordering, payment, reconciliation, unknown-outcome, dispatch/access, crash-restart, ledger, migration and snapshot tests were included.
- schema-expectations-node22.log and schema-expectations-node26.log: all 46 cases in the four affected older test files pass after updating their schema expectations.
- guard.log: source/art/palette/syntax guard passed. git diff --check passed.

The first affected run exposed three stale snapshot assertions about schema7; these now check the current version and its future successor. Hosted full-unit checks then found five assertions in older Merchant, avatar, access and saved-receipt cases that also assumed schema7 or its exact table list. A local full-suite reproduction confirmed those five failures (390 passes, one existing skip); the version assertions now use MIGRATIONS.length and the exact additive-table list includes deferred_refunds. No payment or backup implementation change was needed for these stale expectations.

All data and providers are fake and disposable. Reopening is not hardware power-loss evidence; SDK-adapter tests use fake controllers. The existing real-SDK transport and SIGKILL tests remain separate. No actual payment, refund, owner database, credential, video or deployment was used.
