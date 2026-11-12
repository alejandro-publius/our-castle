# Devpost entry: ready-to-paste skeleton — not submitted

Written November 10, 2026 (Pacific) against `main` at `97c084a`. Nothing has been submitted and no form has been filled.

This is the short form, one block per Devpost field. The longer copy, with every claim linked to its evidence, is [SUBMISSION-DRAFT.md](SUBMISSION-DRAFT.md). If the two disagree, that file and [PAYMENT-HOLDS.md](PAYMENT-HOLDS.md) are right and this one is out of date.

Two passages are marked **[swap]**. Each has a sentence for today and a replacement that may be used only after the named thing has really happened.

## Project title

Our Castle

## Tagline

Decide what your family can afford, then build toward it together.

## What it does

Our Castle helps a family plan a shared goal, such as the gear for a camping trip, and keep it when an expense changes.

- **Plan a complete kit.** The family lists what it needs and what it already has. Adults add listings, and the planner compares whole kits against each adult's weekly offer, the date and a one-off expense. If the expense grows, it proposes the smallest change that still fits and keeps every line the family chose to keep.
- **Contribute under an adult's control.** An adult approves one exact amount. It can be paid straight away, or held first: nothing counts until an adult releases an exact part of it, in up to three steps, or returns it. The record shows its trail, for example Held $40 → Released $30 → $10 still held.
- **See progress.** Confirmed contributions open districts of a pixel woodland and develop the family's project.
- **Share a goal with the neighbors.** Families can fund one project together. Each chooses only its own share, the shared total is never mixed with a family's own, and private amounts are never shown to other families.

Two examples run without any key: `npm run demo -- --family-trip` and `npm run demo -- --village-fund`. Their families, shops and prices are invented and their payments are simulated.

Our Castle records goal progress. It is not a bank account or a savings product.

## How we built it

- **PayPal Orders v2.** JavaScript SDK v6 opens sandbox checkout; Server SDK 2.5.0 creates and captures orders. The hold path creates the order with intent `AUTHORIZE`, then captures exact amounts or voids the rest, and can reauthorize once after the three-day honor period.
- **The server owns the amounts.** Every adult decision is recorded before PayPal is asked. A capture counts only if it matches that decision in amount, currency and reference, and it counts once. The database itself refuses a release larger than what is still held.
- **A Rust kit solver.** A bounded native solver searches complete kits in exact integer cents and weights. The server checks every answer, and a JavaScript reference gives the same results where Rust is not built. We make no speed claim.
- **Cohere, optional.** Rerank can order kits that already fit by one fixed preference, from public listing titles and shop names only. Budget, quantities and kept choices stay deterministic.
- **AG Grid and AG Studio.** They power the Treasury: searchable records, the next-area widget and the weekly plan.
- **Also:** Channel3 for product listings, Anthropic Claude for schedules and a read-only steward that cannot move money, an optional OpenAI photo reader for a kit list, APIMatic context for the PayPal SDK work, and Node.js, SQLite, Three.js and original pixel art underneath.

No AI moves money or approves anything, and an AI-proposed schedule is stored only if it equals the server's own arithmetic. Adults decide. Each money rule is listed with the test that fails if it is broken, in the repository's review guide (`docs/JUDGE-HANDOFF.md`).

## Challenges we ran into

Moving from one goal amount to a real plan: quantities, things already owned, personal offers and choices a family wants to keep. The planner separates hard limits from preferences and shows exactly what changes when an expense grows.

Keeping an inviting world honest: reported savings, simulated payments and sandbox captures stay distinct, and a late or repeated payment event can never add progress twice.

## Honest scope

- **A sandbox prototype.** PayPal is sandbox only; the code has no path to live endpoints. Nothing is hosted.
- **No real-family study.** No family playtest, physical-device or screen-reader check has been done.
- **Ordinary checkout:** one owner-completed $15 sandbox capture and a same-order check, on an earlier build.
- **[swap] The hold path.** Today: *Holding, releasing, returning and extending are tested against a fake PayPal and in example mode only. No real sandbox hold has been made.*
  After the owner's [sandbox run](SANDBOX-HOLD-PROOF.md) succeeds, and only then: *On November __ the owner placed one real PayPal sandbox hold of $25, released $15 while keeping the rest held, and returned the remaining $10. Extending a hold and releasing in three steps are still tested against a fake PayPal only.*
- **[swap] Cohere.** Today: *One live request returned an ordering, which shows the connection works. Ranking quality has not been evaluated.*
  After the [measurement](COHERE-MEASUREMENT.md) is run: add its one sentence, whichever way it came out. The second sentence above stays.
- **Shared funds:** the PayPal recipient and PYUSD devnet paths are tested against fake transports only. No real recipient or wallet has been used.
- **Examples:** the default demos use invented data and simulated money, and say so on screen.

## What's next

- One real sandbox hold through release and return, then an extension after its three-day honor period.
- The demonstration video, recorded from the current build.
- Playtests with real families on their own devices.
- A real sandbox recipient and a devnet wallet for the shared funds.

## Built with

`paypal` `node.js` `sqlite` `javascript` `three.js` `rust` `anthropic-claude` `cohere` `openai` `channel3` `ag-grid` `apimatic`

## Links

- Repository: https://github.com/alejandro-publius/our-castle
- Video: **not uploaded**. Under three minutes, public on YouTube. [Shot list](SUBMISSION-SHOTLIST.md) · [recording checklist](VIDEO-CHECKLIST.md)
- Try it: clone, `npm ci`, then either of the two commands above.

## Before submitting

- [ ] The video address is filled in and the video is public.
- [ ] Each **[swap]** passage carries the sentence that is true today.
- [ ] Every figure here still matches [SUBMISSION-DRAFT.md](SUBMISSION-DRAFT.md).
- [ ] Sponsor entries and the prepared APIMatic answer are taken from [SUBMISSION-DRAFT.md](SUBMISSION-DRAFT.md#submission-fields-still-to-supply).
- [ ] The deadline is Thursday, November 12, 2026, noon Pacific. The owner submits; no assistant does.
