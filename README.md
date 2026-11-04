# Our House

A cooperative household savings journey. A family (or one person) founds a house, chooses a crest, and travels a pixel woodland board past deer, a brook and a plank bridge. As real, adult-approved contributions reach shared milestones, their cottage grows into a manor, a keep and finally a castle. **Our House is a working name.**

Built for the PayPal AI Hackathon as a local prototype: an **AI planner** turns the household's own numbers into an editable weekly plan with its arithmetic shown, and a **PayPal sandbox checkout** (Orders v2, created and captured by the server) is the only way progress moves forward.

> Private repository, sandbox only. No real money moves, nothing is deployed, and no hackathon entry has been submitted.

## Status — what works and what is not yet verified

| Area | State |
| --- | --- |
| Board, crest, house tiers, travelers, gardens | Working in the browser on the original 90-color pixel renderer |
| Household / goal / plan / ledger / milestones | Working, stored in SQLite, survives restarts |
| Example mode (no credentials) | Working and labeled everywhere: simulated payments, built-in rules planner |
| AI planner (Anthropic Messages API, structured output, server-side validation) | Implemented and unit-tested against a fake transport. **A live AI call has not been made yet** (no `AI_API_KEY` in this environment) |
| PayPal sandbox order → approval → capture → verified credit | Server path implemented and tested against a fake sandbox API. **No real sandbox transaction has been made yet** (no sandbox credentials here) |
| PayPal JS SDK v6 button in the browser | Implemented; **unverified** until run with a sandbox client id |
| Verified webhooks (capture completed/denied, refunds) | Implemented with PayPal signature verification; **unverified live** (needs a public tunnel and `PAYPAL_WEBHOOK_ID`) |

See [docs/VALIDATION.md](docs/VALIDATION.md) for exactly which tests ran and the remaining credential-dependent checks.

## Run it

Requires **Node.js 22.16 or later** (uses the built-in `node:sqlite`).

```sh
npm install
npm start
# Open http://localhost:3010/
# The original art reference stays at http://localhost:3010/art-preview.html
```

With no `.env` file the app runs in **example mode**: payments are simulated by the server and labeled "simulated" on every badge, receipt and ledger line; plans come from built-in rules and are labeled "no AI". Example mode is for previewing the product, not proof of either integration.

### Real PayPal sandbox and AI planner

1. Copy `.env.example` to `.env` (server-side only; it is git-ignored and never served).
2. PayPal: create a **sandbox** REST app at developer.paypal.com and put its client id and secret in `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`. `PAYPAL_ENV` must be `sandbox`; the code has no live endpoint.
3. AI: set `AI_PROVIDER=anthropic`, `AI_MODEL=claude-opus-5-5` and an application API key from the Anthropic Console in `AI_API_KEY`. The server reads only `AI_API_KEY`; it never uses `ANTHROPIC_API_KEY` or a coding assistant's login.
4. Restart `npm start`. The startup log and the header badges show "PayPal sandbox" and "AI planner". Sandbox data is kept in a separate database file from example data.
5. Pay with a **sandbox personal (buyer) account** from the PayPal developer dashboard.

Optional webhooks: expose the local server through a tunnel, add a webhook in the sandbox app pointing to `https://<tunnel>/api/paypal/webhook` for `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED` and `PAYMENT.CAPTURE.REVERSED`, then set `PAYPAL_WEBHOOK_ID`. Without it, captures still complete synchronously; unverified webhook deliveries are always refused.

Other commands:

```sh
npm test              # integrity check + unit tests + browser end-to-end tests
npm run test:unit     # node --test (ledger, payments, planner, AI provider, HTTP server)
npm run test:e2e      # Playwright, desktop 1440px and phone 390px, example mode
npm run check         # asset hashes, 90-color palette, renderer wiring, JS syntax
npm run reset-demo    # erase the local example household (add --include-sandbox to also erase sandbox records)
npm run art-preview   # the original static art preview server
```

## How it plays

1. **House** — choose solo or family (example personas Rowan, adult; Wren, child), name the house and compose a crest (field color + crown, leaf, stag or tower).
2. **Plan** — enter the goal, what is already set aside (self-reported), a target date, the weekly amount you choose, and bills you already pay (context only). The planner proposes a weekly schedule, shows the arithmetic and projects when the Manor, Keep and Castle are reached. Every week is editable; impossible targets show the exact shortfall and how to close it.
3. **Contribute** — an adult persona ticks an explicit approval for a specific amount, then pays in the PayPal sandbox. The server captures the order, checks amount, currency, goal and household against its own record, and only then credits progress. The receipt shows the PayPal order and capture ids.
4. **The board answers** — the travelers walk to the new space, and when a milestone is crossed the next home tier rises with a celebration banner. Refresh or restart: the same result is there.
5. **Ledger** — goal progress, receipts, bills paid and gifts are kept separate. Bills grow garden beds as a habit reward but never count as savings. A refund lowers progress exactly once and walks the travelers back; the raised building stays as an explained keepsake.

Default demo numbers (editable, synthetic): a $300 goal, $60 already set aside, eight weeks of $30, and a first $15 contribution that reaches the Manor at 25%.

## What keeps it honest

- Integer cents everywhere; amounts are real HTML text in Alegreya Sans, never pixel art.
- The browser cannot credit a payment. Redirects, callbacks, pending, canceled and declined orders never count.
- Unique capture and refund ids plus PayPal-Request-Id idempotency keys mean replays, double clicks and repeated webhooks cannot double-credit.
- A capture for a different household or goal, or with a different amount, currency or `custom_id`, is rejected.
- The database refuses bill or gift entries that would count toward the goal.
- AI output is validated before it is shown or stored: schema, whole nonnegative cents, exact dates, totals, feasibility claims, and every dollar figure in its prose must come from the household's inputs. Failed output is shown with reasons and a labeled rules-based fallback is offered. AI never authorizes or schedules a payment.
- Secrets stay in the server `.env`; tests check that no secret reaches any page or API response. The server binds to `127.0.0.1` and refuses cross-site writes and rebinding hosts.
- The internal ledger is goal progress, not a bank balance, and PayPal does not see the household's other bills.

Architecture, data model and payment states: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Demo script: [docs/DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md).

## Background documents

1. [Concept and decisions](docs/CONCEPT.md)
2. [Art direction and reference lock](docs/ART-DIRECTION.md), with the reference PNGs in `references/images/`
3. [Product rules](docs/PRODUCT-RULES.md)
4. [Build plan and acceptance checks](docs/BUILD-PLAN.md)
5. [PayPal hackathon requirements](docs/HACKATHON.md)

The board uses the original Tiny Castle / Crown & Dust renderer, 90-color palette, fonts and miniature vocabulary. The older card battler and other projects are separate and unchanged.

The MIT license covers application source; asset and third-party notices are in [NOTICE.md](NOTICE.md) and [assets/README.md](assets/README.md).
