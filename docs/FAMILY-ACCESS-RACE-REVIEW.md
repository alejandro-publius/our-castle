# Family access timing review — November 6, 2026

Independent Codex review against PR #20 snapshot `1de17ba61c7ced1be9522fd992c58063e7242112`. Claude continues the shared-live integration in its separate Mac worktree. These changes are prepared on `review/family-revocation`; no active worktree, owner app, credentials or household records were changed.

## Two reproduced gaps

1. **Delayed request body.** A signed-in adult sends the first byte of a request. The server authorizes it, then waits for the body. While it waits, the owner removes the adult. Completing the body still returned HTTP 200 and ran the household-entry route. Rechecking only when the headers arrive leaves a gap before the action starts.
2. **Waiting steward.** A valid adult starts a steward question against a gated fake model. The owner then removes the adult before the model returns a tool request. The old code executed the tool, made a second model turn and returned HTTP 200. The new-request session checks correctly refused later requests; the missing boundary was inside this already-running request.

Both regressions failed on the snapshot and passed after the fix. These are local, deterministic HTTP reproductions with invented families and software passkeys, not incidents involving the owner's accounts. An initial harness assertion incorrectly expected a `data` listener; the actual async body reader uses `readable`. The corrected reproduction is retained separately.

## Focused changes

- Family writes reauthorize after the body has arrived and been parsed, before the route executes. Public passkey ceremonies and signed machine webhooks retain their existing policies.
- The steward receives a trusted server-side access assertion. It checks the current session, membership, route permission and original session/member/account/household/goal scope before model turns, after model waits, before tools and before returning the answer.
- Access failures stay outside the tool-error catch: they return the normal authorization error and are not fed back into another model turn. They never become a fabricated provider result or payment verification.
- The example-mode and directly constructed steward retain a no-op assertion; no browser field can supply this callback. No schema, dependency, money-moving service, new public endpoint or UI is added.

An already-started model/provider operation can still finish; this change prevents later steward turns and suppresses the answer/checks once access has ended. It does not recall a dispatched request, promise cancellation of SDK-internal retries or change unrelated asynchronous planner/merchant operation semantics. Those should be reviewed separately if the shared-family provider modes are enabled.

## Evidence and limits

**27 distinct targeted cases passed across focused runs:** nine existing family-access cases, ten steward cases, and eight new timing/control cases. New coverage includes delayed-body writes under revocation, sign-out and absolute expiry; model waits under those three conditions; revocation during a fake PayPal read; and an unchanged active-membership control that still completes normally. The live-read case permits only the read already in progress and starts no subsequent model turn. There are no sleeps or network races in these gates. Real HTTP, the pinned WebAuthn verifier/software authenticator and real Anthropic SDK with fake fetch are used; there are no actual provider calls.

The route-enumeration case was explicitly excluded from this snapshot run because its two newly merged Merchant routes still lack policy entries in `1de17ba`. Claude independently fixed those in local commit `944457f`; the complete policy check belongs in the final integrated review after that commit is pushed. No permanent test skip was added. This branch is not a standalone release of the unfinished integration.

The original 47-file/palette/renderer/syntax guard and diff checks passed. No full suite or browser suite was repeated for these server-only changes. Ignored evidence: `test-results/revocation-review/{reproduced.log,after.log,focused.log,active-control.log,check.log}`. Earlier harness failures remain in `before*.log`.

This follows the distinction in [PayPal's MCP Gateway engineering article](https://developer.paypal.com/community/blog/PayPal_MCP_Gateway/) between initial discovery/access and authorization at execution. It is a bounded implementation review, not a security certification.
