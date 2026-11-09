# Clear an answer after a newer saved check

A failed explicit PayPal check can save new check history without changing the payment or ledger. Previously, an already displayed “Saved confirmation” answer could remain beside the newer failed check because the Treasury's answer scope included payment status and update time, but not saved-check metadata.

The scope now includes each contribution's latest saved check. The existing invalidation clears the older answer when that check changes. This changes neither financial records nor provider calls and adds no new interface.

On base `e0f88167d168339a3ce3807d9365c5923f9345a6`, the new `@release` regression in `test/e2e/treasury-status.spec.mjs` failed on desktop specifically because the older answer remained visible after the failed check. With the one-line scope correction, the same case passed on desktop and 390 px phone (2 passed, 30.9 seconds). The source/art/palette/syntax guard and `git diff --check` passed.

The regression uses the real app with an in-memory invented household and fake PayPal. It checks that payment and ledger rows stay unchanged, one failed lookup creates the second saved-check record, and no model or external browser request occurs. Runs used Node 26.0.0, a minimal environment, explicit IPv4 loopback, and the corrected Node transport preload (SHA-256 `dcaf05bd9de88b7457bd68f76c50aa33a361e94adc3abf6ac7eb2da5889164ec`); no denied attempts were recorded. This preload is not an operating-system sandbox.

Ignored evidence: `test-results/stale-confirmation/before.log`, `before-artifacts/`, `after.log`, and `guard.log`. No actual provider call, saved household access, payment, physical-device test or human playtest was performed.
