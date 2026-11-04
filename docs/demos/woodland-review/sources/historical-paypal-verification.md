# Live verification — 2026-11-04T06:48:46.571Z

.env loaded: yes · payments: sandbox · AI: example
Sandbox only. Temporary database; the app's own data files were not touched. No secrets are printed.

> Note added on Nov 4, 2026: this run (Nov 3, 10:48 PM PST) happened before `AI_API_KEY` was configured, so it shows "AI: example".
> - **The AI planner** passed later, in [LIVE-VERIFICATION-AI.md](LIVE-VERIFICATION-AI.md).
> - **The steward** was checked in that run against the ledger and the sandbox transaction list. Reconciling a specific household order with `get_order` is still unverified.
>
> Running `npm run verify:live` again replaces this file and creates a new sandbox order.

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
