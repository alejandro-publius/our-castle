# Refund evidence and delivery order

Follow-up to [review scenario R1](https://github.com/alejandro-publius/our-castle/blob/d572e3d4e77749a80236c75260e59971c277f5b6/docs/REVIEW-RESEARCH.md). A generated event-order experiment and an independent small fake-provider reproduction exposed two reconciliation defects in the production code shared by main 579b4f6 and reviewed PR43 ce3ec65.

1. A pending capture completed at the fake provider and was refunded. Its verified refund arrived before its older completion. The app remembered the refund but later credited the full contribution without applying that known reversal: $60 became $75 despite a full $15 refund. The same gross credit could award a false Manor milestone.
2. An explicit order check first encountered a partially refunded capture and valid completed refund details. It withheld all progress instead of recording the confirmed remainder: a $15 capture with a $5 refund left $60 instead of $70.

PayPal defines PARTIALLY_REFUNDED as a captured payment with less than the captured amount returned. The [official Orders v2 purchase-unit definition](https://developer.paypal.com/api/orders/v2/definitions/purchase_unit) supplies the status and payment/refund fields; this change does not infer a remainder from the status alone.

## Change

On the first credit, replay previously verified completed refund records for that capture before awarding milestones, inside the same SQLite transaction. Preserve the existing per-capture/per-refund deduplication and validation.

When an explicit order result is first seen as partially refunded, recover its remainder only after the ordinary order/capture checks and usable completed refund records establish a positive amount below the original capture. Missing, pending, wrong-currency, foreign-capture, excessive or mixed-invalid refund evidence does not authorize this recovery. A fully refunded capture first seen without a completion event continues to add no progress.

This performs local ledger reconciliation. It adds no payment/refund request, provider read, startup job, endpoint, dependency, schema or UI control. Existing already-recorded anomalies still have the explicit Check with PayPal recovery path; no database migration or owner-data repair is run.

## Regression and experiment evidence

Local artifacts: test-results/refund-ordering-20261108/ in the isolated worktree.

- before-final-test.log: the final eight early-refund/rollback tests fail against the original contribution service. The fixed service was restored byte-for-byte afterwards.
- partial-before.log: first-partial-confirmation cases fail on both adapters; the evidence-refusal cases already pass.
- after-both-fixes.log: all 12 permanent regression cases pass on Node26.0.0. These cover full, partial and split refunds arriving early; same/new event-ID duplicates; later explicit checks and capture retries; no false tier award; unusable refund details; and rollback of the credit plus the first reversal if writing the second reversal fails.
- model-seed-2.log and model-seed-21.log: the two widened failing seeds from Task009 pass on both REST and SDK-adapter paths against this fix. Each command also runs its checker-sensitivity test. This is a snapshot of the still-developing model file, archived with its hash; it is not a claim about a later published model head.
- affected-node26-final.log: 103 affected cases, 102 passed and one existing skip, zero failures on Node26.0.0. source-guard.log and git diff --check passed. Hosted minimum/current-runtime checks are tracked on the exact pushed PR head.

The first post-fix run exposed two test-fixture mistakes: the webhook method returns only an outcome, and a legitimate porch achievement can be awarded from the existing starting amount. The corrected tests read the contribution view and check tier awards; those mistakes were not additional application defects.

All examples use in-memory or test-owned SQLite data and fake providers. The SDK-adapter cases use fake controllers, not generated SDK serialization; existing transport/crash tests remain separate. No owner process, credentials, database, completed sandbox order or real provider was used. This is not a live-refund or hardware power-loss demonstration.
