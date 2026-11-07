# Family access timing review — November 6, 2026

Independent Codex review on `review/family-revocation` / PR #22, stacked on PR #20. The branch now incorporates PR #20 through `f6535f891be4dc97dcb8bf42238312f4ec251090` by a normal merge. No active Claude worktree, owner app, credentials or household records were changed.

## Reproductions

These are local HTTP reproductions with invented families, software passkeys and gated fake providers, not incidents involving the owner's accounts.

1. **Delayed request body** (original review against `1de17ba`). An adult's request was authorized before its body arrived. Removing the adult during the body wait still allowed the household write when the body finished.
2. **Waiting steward** (same snapshot). Removing an adult while the model was answering still allowed its returned tool request, a second model turn and a private answer.
3. **Waiting planner** (follow-up against `dcbe2db`; `f6535f8` changes only the journey test). Removing an adult during a valid model answer still saved a new plan. The focused reproduction failed with one stored proposal instead of zero.
4. **Dispatched capture response** (same follow-up). A fake capture already sent before removal correctly settled and credited once, but its response still returned HTTP 200 with household state to the removed member. The corrected reproduction failed on HTTP 200 versus 401 after verifying the single credit. Its first harness version counted the zero-valued starting-progress row; the retained regression counts capture source references explicitly.

## Changes

- Reauthorize family writes after body parsing, before any route action.
- Pass a trusted server-created access assertion to the steward and planner. It checks the request's original session, member, account, household and goal plus the current route permission. HTTP input cannot supply or replace it.
- Stop subsequent steward tools/model turns after access ends. Drop a late planner answer before validation/storage, including invalid-output and provider-error paths.
- Recheck private responses after route waits, on success and error. An ended request receives the normal authorization error, without its receipt, plan or household state.
- Finish recording an already-dispatched capture or refund before suppressing its response. The remaining owner can recover that result without another capture. Live notifications still run in the handler's existing `finally` block.
- Runtime checks are not user activity and cannot extend idle expiry. They do not clear cookies: an old request's failure must not erase a newer passkey sign-in. Initial invalid-session handling still clears the cookie normally.
- Explicit sign-out intentionally ends its own session and still returns successfully. Public passkey ceremonies, machine webhooks, streamed responses and example mode retain their existing policies. The directly constructed planner/steward default to a no-op assertion.

No schema, dependency, public endpoint or interface was added. The shared HTTP helper retains the integration branch's live-stream cleanup and accepts a request-observer seam only for deterministic delayed-body tests.

## Validation

**139 passed, 1 existing skip, 0 failed** in one integrated targeted run:

```sh
node --test test/unit/family-access.test.mjs test/unit/family-runtime-boundaries.test.mjs test/unit/family-live.test.mjs test/unit/family-sponsor.test.mjs test/unit/planner.test.mjs test/unit/planning-revision.test.mjs test/unit/steward.test.mjs test/unit/channel3-merchant.test.mjs test/unit/server.test.mjs test/unit/payments.test.mjs
```

- All 18 family-access cases pass, including complete bidirectional route-policy enumeration. The older snapshot's missing Merchant policies are fixed on the integrated branch; the policy check is no longer excluded.
- Nine new runtime cases cover planner access removal, idle expiry, sign-out, renewed sign-in, invalid output, provider failure, active-membership control, and already-dispatched capture/refund settlement. Active planner and steward controls also prove that runtime checks do not advance `last_seen_at`; the renewed-sign-in case proves the newer cookie remains usable.
- The existing eight timing cases remain: delayed bodies under removal/sign-out/absolute expiry, steward model waits under those three conditions, removal during an already-dispatched tool read, and an active control.
- Existing live, sponsor, planner, payment and server cases pass. The only skip is the pre-existing SDK OAuth-cache case: the SDK manages its own token.
- `npm run check` passes (47 copied art/runtime files, original 90-colour palette, renderer wiring and syntax). `git diff --check` passes. No full browser suite was repeated for this server-only patch.

Ignored evidence: `test-results/family-boundary-review-{focused,expanded,validation,check}.txt`, `test-results/family-boundary-renewed-session.txt` (failed reproduction before the late-cookie correction), and the detached baseline worktree's `test-results/family-boundary-review/{baseline,capture-baseline}.txt`. Earlier delayed-body/steward evidence remains in `test-results/revocation-review/`.

## Limits

An already-dispatched provider operation cannot be recalled; provider-side work and SDK-internal retries may finish. This patch stops later steward turns and new planner storage, and protects private HTTP responses. It deliberately does not roll back a confirmed financial settlement or an authorized goal edit completed before the wait. Merchant searches already sent may populate their household-bound lookup cache; no later goal save is authorized by that cache alone.

All provider behavior here is fake. Real physical passkeys, provider browser checkout in family mode and real multi-device network conditions were not tested in this review. The owner's preserved sandbox rehearsal is unchanged. This is a bounded implementation review, not a security certification or release activation.

The execution-time authorization approach follows [PayPal's MCP Gateway engineering article](https://developer.paypal.com/community/blog/PayPal_MCP_Gateway/).
