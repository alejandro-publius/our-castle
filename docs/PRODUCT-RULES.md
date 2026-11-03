# Proposed product rules — editable starting point

## Data and progress

Use integer cents and an explicit currency, initially USD. A household owns a goal, optional member contributions, a crest and board/castle achievements. The first local demo may use two clearly labeled example members; do not claim that a persona switch is secure multi-user authentication.

Track user-reported starting progress separately from PayPal-confirmed contributions. The goal's current tracked progress is starting progress plus eligible completed captures minus recorded refunds. This is a goal-progress ledger, not a bank balance. Bills, gifts and spending are separate entries and must not inflate saved progress automatically.

For the initial art/game defaults, the route has 20 waypoints; current position follows achieved progress proportion, clamped to the route. Castle milestones are 0%, 25%, 60% and 100%. These thresholds and all financial amounts are proposed defaults. Cosmetic achievements can commemorate prior milestones even after a refund, but current progress must update truthfully and the UI must explain the distinction. No financial or cash-equivalent rewards are attached to the art.

## Payment state

The server creates a sandbox order for an approved goal amount, remembers its household/goal/currency/amount mapping, and captures after user approval. It checks the provider result before crediting the ledger. The client cannot assert successful payment. Redirects, screenshots, failed requests and pending/canceled orders never count as captured funds.

Use durable unique capture IDs and request IDs so retries/replayed callbacks cannot double-credit progress. Check amount, currency, order ownership and status against the server's expected record. Persist orders, captures, ledger entries and milestones together or transactionally. Reject a capture for a different household/goal. If webhooks are used, verify their signatures before acting. Handle a supported refund event once and reverse only its credited amount.

No live endpoints or real transactions. Do not assume PayPal Checkout supplies savings custody, arbitrary peer-to-peer transfers or access to unrelated household bills. This sandbox prototype demonstrates approved payment-triggered goal progress. Verify the appropriate PayPal product/business model before any later real-money use.

## AI role

Ask for the chosen goal, reported starting progress, target date, recurring commitments and a budget amount the person elects to allocate. Produce a structured, editable milestone plan and a plain explanation. Validate schema, nonnegative cents, dates and totals; do not fabricate income, available funds or bill status. If the inputs cannot reach the goal, show the shortfall and let the person revise the plan.

AI never authorizes a payment, changes a confirmed amount, or silently schedules transfers. It proposes, the person reviews, and PayPal sandbox approval remains explicit. Implement a real runtime model provider behind a server endpoint. Claude Code subscription/OAuth is not an application API key.

## Example mode

Missing credentials should still allow the woodland preview and an explicitly labeled example household/quest plan. An example payment event must be labeled simulated. A real sandbox capture needs separate proof; example mode cannot satisfy that acceptance check or the complete hackathon entry by itself.
