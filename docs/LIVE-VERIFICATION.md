# Live verification — 2026-11-04T06:48:46.571Z

.env loaded: yes · payments: sandbox · AI: example
Sandbox only. Temporary database; the app's own data files were not touched. No secrets are printed.

## AI planner
- SKIPPED — AI plan for the demo goal: no AI_API_KEY in .env

## PayPal sandbox (Server SDK)
- PASS — Server-created sandbox order: order 5D424601H2372591L

  ACTION: open this link, log in with a sandbox BUYER account and approve (waiting up to 20 min):
  (approval link printed to the terminal)

- PASS — Buyer approved the order in PayPal: PayPal order status APPROVED
- PASS — Capture verified and credited once: capture 72476659YH700454R, progress $60.00 → $75.00, tiers awarded [1]
- PASS — Replayed capture is not counted twice
- PASS — Mismatched household refused
- PASS — PayPal's own record matches the receipt: PayPal: COMPLETED, 72476659YH700454R, 15.00 USD

## AI house steward (PayPal Agent Toolkit, read-only)
- SKIPPED — Steward verifies the payment with PayPal: needs both AI_API_KEY and PayPal sandbox credentials

## Sandbox refund
- PASS — Refund reverses progress once: refunded, progress $75.00 → $60.00

**7 passed, 0 failed, 2 skipped.** Still manual: the browser PayPal button (JS SDK v6) and webhooks through a tunnel.
