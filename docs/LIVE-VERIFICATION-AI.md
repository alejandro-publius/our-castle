# Live verification (AI only) — 2026-11-04T07:11:30.403Z

.env loaded: yes · payments: sandbox · AI: live (claude-opus-5-5)
Sandbox only. Temporary database; the app's own data files were not touched. No secrets are printed.

## AI planner
- PASS — AI plan for the demo goal passed server validation: claude-opus-5-5, 13614 ms, planned $240.00, shortfall $0.00
  Headline: "Eight steady weeks to your camping trip castle"
  Summary: "You have $60.00 of tracked progress toward your $300.00 camping trip goal, so $240.00 is left to go. Eight weekly contributions of $30.00 each close that gap exactly by December 29. Each one happens only when an adult approves it in PayPal."
- PASS — AI plan for an impossible target states the shortfall: 13691 ms, shortfall $160.00; "A steady start, but more time or weekly savings needed"

## PayPal sandbox (Server SDK)
Not run (--ai-only): no PayPal order was created and nothing needed approval. The buyer-approved payment is verified separately (see VALIDATION.md).

## AI house steward (PayPal Agent Toolkit, read-only)
- PASS — Steward answered with live AI: claude-opus-5-5, 7692 ms
- PASS — Steward read the household ledger: Read the ledger: $60.00 tracked, 0 contributions.
- PASS — Steward listed PayPal transactions through the Agent Toolkit (read-only): Listed PayPal sandbox transactions (last 7 days, status S): 1 found.
- PASS — Steward answer had no unverified figures
  Question: "How close are we to the Manor? Please also check PayPal for any sandbox transactions in the last 7 days."
  Answer: "You're very close, Wren! The House of Alder has $60.00 toward the Camping trip fund, and the Manor opens at $75.00, so you need just $15.00 more. I checked PayPal's sandbox for successful transactions in the last 7 days and found only one, labeled "Initial balance." That's the sandbox account's starting setup, not money the family saved, so it doesn't count toward your goal. Your ledger doesn't have any contributions recorded yet. When you're ready to add one, a grown-up can do it in the app with PayPal approval."
- SKIPPED — Steward reconciles a real household order with PayPal (get_order): needs a household PayPal order; check it in the app after the next in-page payment (Ledger tab → "Did PayPal confirm our last contribution?")

**6 passed, 0 failed, 1 skipped.** Still manual: the browser PayPal button (JS SDK v6), the steward's get_order reconciliation after a real in-app payment and webhooks through a tunnel.
