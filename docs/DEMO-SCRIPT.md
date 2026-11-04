# Demo script (under 3 minutes)

Record only after the live checks in [VALIDATION.md](VALIDATION.md) pass with real sandbox and AI credentials, so the video shows the real integrations, not example mode. Use the sandbox app and a sandbox buyer account. Never show the `.env` file, client secret or API key. Use no third-party music or trademarks beyond the PayPal sandbox checkout the product integrates. Turn on the app's **Sound** toggle: every sound is synthesized live in the browser, so the video's audio is original. Publishing, uploading and submitting are the repository owner's decisions.

| Time | Screen | Say |
| --- | --- | --- |
| 0:00–0:15 | Board with the first cottage, deer and brook | "Saving as a family is hard to see and easy to abandon. Our House turns one shared goal into a journey: a woodland board where your cottage grows into a castle as you hit real milestones." |
| 0:15–0:30 | House tab: choose Family, name the house, pick a crest | "Solo or family — one crest, one home. These are example personas; this prototype doesn't claim real sign-in." |
| 0:30–1:00 | Plan tab: $300 goal, $60 set aside, date, $30 a week, internet bill; ask the AI planner | "Claude turns our own numbers into a weekly plan and shows its arithmetic. The server re-checks every cent: dates, totals, feasibility, and that every dollar it mentions came from our inputs. Bills stay separate — never counted as savings." Briefly lower the weekly amount to show the shortfall, then restore and use the plan. |
| 1:00–1:35 | Contribute tab: $15 "Raises the Manor", adult approval, PayPal sandbox button, approve as the sandbox buyer | "An adult approves a specific amount, and PayPal handles the payment. Our server creates and captures the order with PayPal's Server SDK, and progress moves only after it confirms the amount, currency and goal with PayPal." |
| 1:35–1:55 | Receipt with PayPal order and capture ids; travelers walk to Manor Gate; the Manor rises | "Here's the receipt, and the board answers: the family walks to Manor Gate and the house grows." |
| 1:55–2:25 | Ledger tab: tap "Did PayPal confirm our last contribution?"; show "What it checked" and "PayPal and the ledger agree" | "Anyone in the family can ask the house steward. It reads our ledger and checks PayPal itself through PayPal's Agent Toolkit — read-only, so it can look but never pay or refund. The checks it lists come from the server, not from the AI's words." |
| 2:25–2:45 | AG Grid ledger with the Bills filter; refresh the page | "One ledger keeps savings, bills and gifts apart. Refresh — it's durable, and replaying a capture can't double-count it. It's goal progress, not a bank balance." |
| 2:45–2:58 | Board close-up | "Our House: PayPal for the trusted payment, AI for a plan a family can follow and a steward that checks the facts, and a world worth coming back to." |

Fallback if live credentials are unavailable: do not present example mode as the PayPal or AI integration. Its badges and receipts say "simulated" and "no AI" on purpose, and the steward says it is off.
