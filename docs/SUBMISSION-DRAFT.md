# Devpost submission draft (not submitted)

Draft text for the owner to edit. Items in **[brackets]** must be confirmed or replaced after the live sandbox and AI checks in [VALIDATION.md](VALIDATION.md). Do not submit until the repository is public by the owner's choice and the video shows the real integrations, not example mode.

## Name and tagline

**Our House** (working name) — save together as a family, and watch your cottage grow into a castle.

## Inspiration

Families and households often save toward one shared thing — a trip, a repair, a first instrument — but progress lives in someone's head or a spreadsheet, and children rarely see it. We wanted saving to feel like a shared journey everyone can follow, without pretending an app is a bank.

## What it does

A household (or one person) founds a "house", chooses a crest, and sets one shared goal. An AI planner turns the household's own numbers — goal, what is already set aside, target date, the weekly amount they choose, and bills they already pay — into an editable weekly plan with the arithmetic shown, and says plainly when a target is out of reach and how to close the gap.

When an adult approves a contribution, it is paid through PayPal (sandbox). The server captures the order and checks it before anything moves. Then the board answers: the family's travelers walk a pixel woodland route past deer and a brook, and at 25%, 60% and 100% the cottage becomes a manor, a keep and a castle. Bills paid on time grow garden beds as a habit reward but are never counted as savings. A refund lowers progress exactly once; the building stays as a keepsake while the travelers walk back.

## How we built it

- **PayPal:** Orders v2 created and captured server-side with idempotency keys; the server credits progress only when a capture is `COMPLETED` and matches its stored amount, currency, household and goal. Payments v2 refunds; Webhooks v1 with signature verification for pending→completed captures and refunds; JavaScript SDK v6 one-time payment session in the browser. Sandbox only. **[Confirm after the first live sandbox run: capture id shown on the receipt matches the sandbox dashboard.]**
- **AI:** Anthropic Claude (`claude-opus-5-5`) via the Messages API with structured JSON output. The model writes the schedule shape, the plain-language explanation and the milestone notes; the server computes the arithmetic independently and rejects any plan with wrong totals, dates, cents, feasibility claims, or a dollar figure not derived from the household's inputs. The household can edit every week, and edits are re-checked. **[Add one real example plan after the live AI check.]**
- **Stack:** Node.js with built-in `node:http` and `node:sqlite`; a framework-free browser app; Three.js rendered through our own 90-color palette pixel pipeline (orthographic camera, depth outlines, Bayer dither), carrying over art from our earlier Tiny Castle project.
- **Tests:** 53 Node unit tests (ledger, payment safety against a fake sandbox, planner validation, HTTP security) and Playwright end-to-end journeys at desktop and phone sizes.

## Tools used (AI disclosure)

- **Runtime AI feature:** Anthropic Claude `claude-opus-5-5` through the official `@anthropic-ai/sdk`, called only by the server with the household's own inputs, to propose the milestone plan described above. It never authorizes, schedules or changes a payment.
- **Development:** **[Owner to state development tools, e.g. that Claude Code assisted with implementation.]** This is separate from the runtime planning feature.

## Challenges

Making payments trustworthy in a game: the browser can never award progress, so pending, canceled, declined, duplicated or mismatched payments never count, and refunds reverse exactly what was credited. Keeping AI arithmetic honest: the server re-derives every number instead of trusting the model.

## What we learned

**[Owner's words.]**

## What's next

Real multi-member sign-in, more goals per household, shared household views for each member, and — only after checking the right PayPal products and rules — any real-money use.

## Honest scope notes for judges

This is a sandbox prototype that tracks progress toward one goal. It is not a bank or savings account, it does not hold funds, and PayPal does not see the household's other bills. The example personas are not secure authentication. An example mode (labeled "simulated" and "no AI") lets anyone preview the experience without keys; the real integrations need a PayPal sandbox app and an Anthropic API key as described in the README.
