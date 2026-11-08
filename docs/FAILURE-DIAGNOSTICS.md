# Unexpected request failures

An HTTP 500 cannot establish whether a transaction committed. The handler now says “Something went wrong. Check the latest records before trying again.” Payment truth remains in the ledger and the existing explicit provider-check path.

Each unexpected failure gets a server-generated UUID in the JSON error's `requestId` and the `X-Request-Id` response header. The server logs the same reference with only `code`, an allowed HTTP `method`, and the registered `route` template. Static failures use the fixed label `static`; unmatched failures use `unmatched`. Templates contain no actual record ids or query values. An incoming request-id header is not trusted or reflected.

The unexpected-error log no longer receives the arbitrary error object, message, stack, causes, request headers, URL or body. Those can carry private data. Expected domain, validation and access errors keep their existing response behavior; existing PayPal debug-id handling is separate. No new UI, endpoint, provider call or external logging service is added.

## Reproduction and checks

The real example-mode service and SQLite run behind an isolated HTTP server with an in-memory database and no provider credentials. A test-only proxy injects one storage-read failure after the real contribution COMMIT returns; it does not change the transaction.

On base `579b4f6`, the request returned HTTP 500 and “No payment was credited” while the database held one credited contribution and $75.00 tracked progress. A separate injected error with synthetic private fields reached the full error log. Both regressions failed before the handler change.

After the fix:

- The same post-commit failure gives neutral guidance. Reloading state shows $75.00 and retrying the original request returns `already_processed`, with one credit.
- Concurrent unexpected failures get distinct server-generated references matching the response and the bounded log. Synthetic private error/cause/header/query fields are absent.
- An expected 404 keeps its existing status/message and produces no unexpected-error log.

All three cases pass. The affected server, family-access and runtime-boundary files pass with them: **39 passed, zero failed/skipped**. The source/palette/syntax guard and diff check pass. Local evidence stays ignored under `test-results/failure-diagnostics-20261107/`; `before-repro.log` is the corrected baseline fixture, after the initial fixture was given the app's normal household setup.

Run the focused reproduction with `node --test test/unit/failure-diagnostics.test.mjs`.

This is bounded handler coverage using synthetic failures. It is not a live-provider incident, full security audit, production monitoring system or proof of every failure mode.
