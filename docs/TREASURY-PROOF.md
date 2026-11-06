# Treasury visibility review

This branch is for review only. The owner's instruction is to push a focused PR and **not merge it**. Owner 3010, the preserved 3021 household, their environment/data and prior real sandbox evidence are not test fixtures and remain untouched.

## Result

- A contribution with a saved check shows **Last checked with PayPal: [status] · [date]** inside the existing Entry cell. No new column or panel. The source line remains separate; the full timestamp and check note remain on the selected receipt.
- The status comes from the latest saved result and the existing status projection. Pending, not-paid, failed, mismatched, partial/full refund and pre-refund checks remain distinct from a completed match. Simulated records never gain PayPal check claims. No historical check is invented or backfilled.
- Clicking a record, including the selected row, or pressing Enter opens/focuses its existing receipt. Programmatic selection does not steal focus or call PayPal.
- Check metadata refreshes even when the entry text is unchanged. A newly saved result also invalidates an older steward answer, including a failed lookup that leaves every financial row untouched.
- **Can you pay or refund?** in the existing steward panel produces a deterministic server-policy refusal. It is available without an AI key, displays the actual PayPal allow-list and makes no model/provider call. Its response is explicitly `local-policy`, with no verification or fabricated tool trace. The runtime wrapper and this reply share the frozen `get_order`, `list_transactions` list; the runtime still rejects every other tool independently of the example question.
- The one existing footer stays visible and states that adults approve every contribution and the steward never spends. Its sandbox/example, demo-profile, unverified-reporting and bank-balance distinctions remain. There is no second general banner or new wizard.

## Scope and references

The build target is the existing [interface direction](INTERFACE-DIRECTION.md), the owner's current parchment journal and this explicit visibility request. Existing desktop/390 px Treasury captures were inspected before editing. Keep Alegreya/Uncial, four grid columns, quiet text, the world, original art/palette and the selected receipt. A status is read-only metadata; the payment's server verification/idempotency, saved-check schema, timestamps and explicit recovery action remain authoritative.

The existing **Check with PayPal** button uses the contribution service's Orders `getOrder` read and saves the server's reconciliation in `order_checks`. It is distinct from the runtime steward's Agent Toolkit `get_order`. The review fixture does not turn a fake transport into evidence that either provider was newly contacted.

All screenshot records come from a separate in-memory household and stateful fake PayPal, with an on-screen **ISOLATED FIXTURE** label. A fake $15 capture starts with $60 reported progress; explicit checks save the match, survive reload without another lookup, and recover a fake completed refund without a webhook. The real 3021 order is neither checked nor modified. The screenshots demonstrate the interface and local behavior; no real popup, new sandbox payment, paid model/search call, provider result or recording is claimed.

## Validation

**21 named unit cases passed**, covering the new policy response/shared allow-list/summary plus existing check-status and steward safeguards. **16 focused browser cases passed**: 12 Treasury cases and four existing journal/notice/draft checks, across desktop and 390 px touch-phone Chromium. No full suite or paid checks were repeated. The original 47-file, 90-colour palette, renderer and syntax guard passed; final syntax/diff checks passed.

The first Treasury run caught stale AG Grid cells after a check (two failures, eight passes). A separate desktop reproduction caught an older saved-confirmation answer remaining visible after a failed check. Both were corrected before the final 12-case run. Visual inspection also found that a bottom-sticky footer disappeared during mobile scrolling; the existing footer is now fixed, with measured content space and scroll padding. Its visibility is checked at the top, at the grid and at the selected receipt. Screenshots were inspected at both sizes. The final refusal images were regenerated after a copy edit; repeated runs are not counted as additional unique scenarios.

Commands actually run:

```sh
node --test --test-isolation=none --test-reporter=spec test/unit/treasury-proof.test.mjs test/unit/check-status.test.mjs test/unit/steward.test.mjs
npx playwright test test/e2e/treasury-proof.spec.mjs test/e2e/treasury-status.spec.mjs --reporter=line
npx playwright test test/e2e/game-shell.spec.mjs --grep 'one general notice|closing and reopening' --reporter=line
npm run check
```

The explicit in-process unit run supplies individual named-case evidence. An auxiliary planning HTTP control initially hit the execution sandbox's localhost-binding restriction and passed once loopback access was granted; no planning code was changed. Ignored detailed logs are `test-results/treasury-proof-{unit-final,complete,shell,source-check-final,stale-before,stale-after,captures-final}.log`.

## Review screenshots

Every image is labeled as a fake-provider fixture. [Capture provenance and hashes](reviews/treasury-proof/provenance.json).

| View | Desktop | 390 px phone |
| --- | --- | --- |
| Saved check and selected receipt | [PNG](reviews/treasury-proof/desktop-status.png) | [PNG](reviews/treasury-proof/phone-status.png) |
| One-click server-policy refusal | [PNG](reviews/treasury-proof/desktop-refusal.png) | [PNG](reviews/treasury-proof/phone-refusal.png) |

No credential is needed for this branch's isolated checks. A new real provider lookup, backfilling the 3021 receipt, replaying a PayPal popup and activating the changes in the owner's running app are outside this PR. It stays unmerged as requested.
