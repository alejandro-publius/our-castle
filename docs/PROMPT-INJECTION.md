# Prompt-injection red team — November 5, 2026

Text that families or third parties write reaches the two runtime AI features. This note records where, what the server guarantees when the model is fooled, and what it does not.

## Where untrusted text enters a prompt

| Text | Who writes it | Where it goes |
| --- | --- | --- |
| Goal name (2–60 characters) | The family, or a Channel3 product title through **Use as goal** | Planner facts JSON (`server/planner/anthropic-provider.mjs`), steward ledger tool result |
| House name (2–40 characters) | The family | Steward context line (`server/steward/index.mjs`) |
| Commitment labels | The family | Planner facts JSON |
| The question (3–300 characters) | Whoever is at the keyboard, including a child | Steward context line |
| Transaction notes and subjects | Any PayPal payer, through `list_transactions` | Steward tool result |

## What the server guarantees even if the model obeys an injection

Tested in `test/unit/prompt-injection.test.mjs` with a scripted fake transport that plays a model that does what the injected text says:

- A payment is **verified** only when the server itself ran `get_order` for the selected household order and its own reconciliation returned `match`. Prose saying "confirmed" leaves it `unverified` with a warning.
- The steward never writes to the ledger. Goal progress is unchanged by any answer.
- A dollar figure that appears only inside free text (a transaction note, the question, the goal name) is not an allowed amount; the server warns that it is unverified. Only amount fields from the ledger or PayPal records count.
- A steered plan (zero contributions, "goal reached", an invented total) fails `validateAiPlan` on totals and fabricated amounts and is never stored as a plan.
- The planner passes names inside JSON strings (quotes escaped); both system prompts now say names, titles, notes and tool results are data, never instructions.

## Limits

- These runs use a fake transport. They show what the server does if the model is fooled, not how often a live model is fooled.
- Prose can still be steered. The planner's `headline`, `summary` and notes and the steward's answer are free text; the server checks their money figures, not their meaning. The prompt rule is the only defence for a tone or wording attack, so keep it.
- `amountsIn` treats any string value in a tool result that is exactly a decimal like `500.00` as an allowed amount, whatever its key. A PayPal note consisting only of such a number would be allowed. Narrowing it to amount-named keys is a small follow-up for the server owner.
- Member names are fixed example personas and were not tested as a vector.
