# Proposed product rules — editable starting point

## Connected district progression (owner correction)

The realm retains the starting village and every later home as separate destinations. The manor opens at 25%, keep at 60% and citadel at 100%; the market district opens with the existing 40% village-quarter reward. The woodland garden is the existing self-reported bill-habit reward, clearly identified as reported by the household. It is not utility-provider verification.

All six districts are visible before unlocking. Locked destinations keep their full colours; their named labels, raised drawbridge leaves and closed gates show the lock. An earned destination lowers its crossing; keepsake destinations remain accessible after a refund while the progress ledger updates truthfully. Inspecting a district only changes the camera. A separately labeled art preview can temporarily show a future district in color and lower its bridge without earning it or writing to the server. Returning restores the real locks.

## Living court rewards

The owner requested more guests and princesses as homes grow. The built home unlocks 2 wandering guests at the cottage, 6 at the manor, 12 at the keep and 20 at the castle. Princesses Elowen, Amara and Sorrel arrive at successive home tiers among musicians, nobles, gardeners, merchants, pages and ceremonial guards. These are original fictional characters and cosmetic scenery. Fixed background hamlet locals are separate from this guest count.

The court follows the already-built home, so a kept home retains its guests after a refund while current progress still falls correctly. A locked-home preview can show its future court without earning it. Guest animations, descriptions and counts cannot confirm a payment or bill, change money, or bypass any existing unlock condition. Reduced motion shows the complete court in still poses.

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

## Rewards and evidence (second version)

World rewards are cosmetic. They never change money, savings totals, captures or the ledger, and none is cash-equivalent.

**Status vocabulary** (shared by the server, the UI and the tests):
- **unlocked:** current tracked goal progress meets the condition.
- **keepsake:** earned earlier and kept after a refund; current progress is below the condition, and the card says so.
- **locked:** not reached yet.
- **connection_required:** needs an authorized provider that is not connected. Nothing in this app can unlock it.

**Evidence sources:**
- **goal_progress:** this app's goal ledger. The label states the exact mix: reported starting progress, PayPal sandbox-confirmed captures, and simulated example payments. Simulated or reported money is never called "confirmed by PayPal".
- **self_reported:** bills and gifts the household records. These grow the habit garden only, are labeled "Recorded by you · not verified by any provider", and never count as savings.
- **provider_required:** a real, authorized bill provider would have to confirm the right household bill, period and payment state. None is connected. The public API ignores any client-sent "verified" or provider fields, and there is no verify route.

**Thresholds** (editable defaults): the home tiers stay at 0/25/60/100% of the goal. Estate additions sit at 10% (porch), 40% (village quarter) and 80% (outer ramparts), rounded up to whole cents like the tiers.
- Additions are earned in the same transaction as the tier awards.
- They are awarded once (unique per goal) and kept as keepsakes after a refund.

**Announcements:** a new addition is announced only when it changes from locked to unlocked between two authoritative server states. A first load, reload, replayed capture, refund, crossing again after a refund, and any preview announce nothing.

**Previews:** previews only redraw the board, with a visible "Art preview" notice. They make no server request and cannot change rewards, achievements or money.

**Bill-provider rewards:** these (lanterns for electricity, a water garden for water) stay locked until a real authorized provider integration exists and is verified. See [BILL-VERIFICATION-RESEARCH.md](BILL-VERIFICATION-RESEARCH.md).
