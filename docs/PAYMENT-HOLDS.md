# Hold first, then release or return

A contribution can be **held** before anything is taken. PayPal authorizes the adult-approved amount, nothing is credited and the world does not move. Later an adult either **releases** an exact amount of it to the goal or **returns** it. This sits beside the existing checkout, which is unchanged and is still the default.

Status: implemented and tested source on its own branch. Every check so far uses the fake PayPal sandbox or example mode. **No real sandbox hold, capture or void has been made with it.**

## What happens

| Step | Who | What the server does | Progress |
| --- | --- | --- | --- |
| Hold | An adult ticks **Hold it first** and approves the exact amount | Creates the order with intent `AUTHORIZE`; after the buyer approves in PayPal, authorizes it | None |
| Release | An adult opens the held record in the Ledger, enters an amount up to what is held and confirms it | Records the decision, then captures that amount as the final capture | The released amount, once the capture is confirmed |
| Return | An adult confirms returning the hold | Records the decision, then voids the authorization | None |

What is not released goes back to the payer, because the capture is final. A held record also offers the existing **Check with PayPal**.

## Rules the server keeps

- **The server owns the amounts.** The held amount is the order's own amount. The released amount is recorded by the server before PayPal is asked, is at most what is held, and is never more than the goal still needs.
- **Only a matching capture counts.** A capture is credited only if it matches the recorded release in amount, currency and contribution reference. A capture of a hold that no adult released here is never credited.
- **One credit.** A release is credited through the same single-credit pipeline as every other capture. Repeating the same request is answered from the record; a new request on a decided hold is refused. PayPal is not asked twice.
- **Adults decide.** Releasing and returning are adult-only routes, refused for a child, another household or another goal before PayPal is asked.
- **Unknown is not guessed.** If PayPal does not answer a release or a return, nothing is credited and the record stays recheckable. An explicit check settles it from PayPal's own order, or reopens the hold when PayPal still shows it intact.
- **Webhooks never credit a hold.** Verified authorization events record a hold or a return made elsewhere. Only a capture can add progress.
- **No AI decides anything here.** The gate is an adult's explicit, amount-specific decision.

## Where it lives

- `server/payments/contributions.mjs`: the hold record, `releaseHold`, `returnHold`, hold-aware capture checks and webhooks.
- `server/payments/paypal-client.mjs` and `paypal-sdk-client.mjs`: authorize an order, read an authorization, capture it, void it. The SDK calls were checked against the installed `@paypal/paypal-server-sdk` 2.5.0 signatures; the dependency pin is unchanged.
- `server/db.mjs`: schema 18 adds one table, `payment_holds` (44 application tables). Existing rows are untouched.
- `server/app.mjs`, `server/access/policy.mjs`: `POST /api/contributions/:id/release` and `/return`, adults only.
- `src/app/main.js`, `index.html`: the **Hold it first** option on Contribute and the two decisions on the held Ledger record.
- Example mode has the same hold, labeled as simulated, so the flow can be shown without PayPal.

## Evidence

- `test/unit/payment-holds.test.mjs`: 25 cases. Eleven run against both PayPal adapters: a hold credits nothing; full and partial release credit once; a return never credits; a child, another household, an over-large or over-goal release and a stray capture are refused; an unanswered release is reconciled once or reopened; a definite refusal leaves the hold open; hold webhooks. Three more cover the simulated hold, reconciliation wording and the schema-17 upgrade.
- `test/e2e/payment-holds.spec.mjs`: the page in example mode. Hold $40, release $25, hold and return $15, and a child is offered neither. It passed in the hosted run on the hold pull request; it was never seen fully green on the loaded development Mac.
- Every existing checkout, refund, webhook and access case still passes with the feature present. [The exact local counts and the one unrelated failure under load](VALIDATION.md#hold-first-then-release-or-return--november-10-2026).

## What only the owner can establish

- **A real sandbox hold.** One held order approved in the PayPal sandbox, then one release (ideally partial) and, on another order, one return. The fake sandbox cannot show that the checkout button accepts an `AUTHORIZE` order, that a partial final capture returns the remainder, or how long the sandbox honors a hold.
- **Hold webhooks** need a public webhook endpoint, which this project does not run.
- **Saved apps.** They are not on this source. Schema 18 has been applied only to disposable fixtures.

Not built: re-authorizing an expired hold, more than one capture per hold, payouts and invoicing.
