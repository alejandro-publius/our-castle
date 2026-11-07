# Keyboard focus and reconnect regression review

Independent follow-up to PR #20 at `7bd4bd92712d1d7d5afda2cec334847b2715a4f5`, November 6, 2026 (Pacific). Work ran in a separate checkout; Claude's Mac worktree and the owner apps were not changed.

## Product fix: a delayed close event stole focus

The existing desktop completed-goal test failed before the fix. Instrumentation recorded the exact sequence: **Visit your castle** focused the castle marker, then `deedClosed()` ran a few milliseconds later and focused the Journal button. The dialog's native `close` event had been delayed while the page rendered.

The close handler still restores focus when it belongs to that close, but respects an outside control the family has deliberately focused in the meantime. Normal Escape, Close and Visit behavior retain their existing destinations. No layout, artwork or payment logic changes.

The new browser regression closes a deed and selects the map or member selector in the same JavaScript task, then waits for the native close event. This exercises delayed-event ordering independent of rendering speed, without replacing the application's handlers or making another contribution.

## Reconnect check: automatic recovery beat the test's click

Claude's recorded desktop trace showed Playwright waiting for `#live-retry` to become visible until the 240-second test deadline. The device had come online and automatic recovery hid the button before the test clicked it. The unchanged test passed in the cloud baseline, confirming the failure was timing dependent.

The manual-recovery part now gates stream requests until after the button click. It then releases the connection and checks live state, catch-up and the hidden connection control. The second drop tests automatic recovery with no gate, followed by idle expiry, passkey sign-in and stream cleanup. No production retry or session rule was changed to satisfy the test.

## Existing test maintenance

- The multi-area deed test now waits for the board's actual animation state before expecting the queued cards, as the completed-goal test already did. A cloud run demonstrated that the previous 15-second card expectation could expire while the normal route walk was still running. The queued cards, milestone text, Visit, focus, visibility and no-write assertions remain.
- The cancellation journey expected two labels removed by earlier payment-recovery work. It now checks **Checkout closed** and the canonical status, progress and credited-capture count after cancellation, decline and pending. Completion still must produce exactly one credit; selecting failed attempts must not change the total or expose completion/refund actions. The trace showed ambient rendering consuming the software browser's action budget, so this money/status case now uses the supported reduced-motion preference, as the Merchant and shared-family cases already do. Normal animation checks remain separate. These are test corrections, with no change to payment outcomes.

## Evidence and scope

**14 distinct viewport cases passed: seven desktop and seven phone.** The original desktop focus check failed in `before.log`; the unchanged reconnect check passed there, while Claude's earlier trace establishes its click/automatic-recovery race. `focus-diagnostic.log` records the delayed close handler taking focus from the castle.

Final passes are in `after-focused.log` (3 desktop), `desktop-regressions.log` (2 desktop passes, with 2 further timing failures subsequently corrected), `desktop-final.log` (those 2 desktop cases passed), `phone-final.log` (5 phone passes, 2 startup failures) and `phone-map-isolated.log` / `phone-close-isolated.log` (each remaining phone case passed unchanged in a fresh process). These logs are under ignored `test-results/live-review/`.

The phone batch's startup failures were a page-ready timeout and a browser-context setup protocol error (`Browser.setDownloadBehavior`: context not found). Their cause was not established; no automatic retry, skip or application change was introduced for them. The individual fresh-process passes verify those checks, rather than turning the original batch into a green run. [VALIDATION.md](VALIDATION.md) retains the earlier full-suite results and these limits. The full suite and unchanged unit tests were not repeated for this UI/test-only patch.

The two Reconnect screenshots were refreshed from passing checks and visually inspected. The other three shared-family screenshots remain unchanged from the base commit, with all five image hashes verified. [The provenance file](screenshots/shared-live-sources.json) distinguishes the new captures from the retained images and records the relevant source hashes.

Source/art/palette/syntax checks passed. Browser checks use headless Chromium with SwiftShader, emulated desktop/phone viewports, virtual passkeys, temporary databases and simulated payments. They establish no physical-device or live-provider result. There were no PayPal orders, paid model/catalog calls, real transactions, owner-data changes, video, deployment or submission.

Review this patch with PR #20 before activation. PRs #21 (SDK loading), #22 (request/session revocation) and #23 (Merchant freshness) remain separate review items.
