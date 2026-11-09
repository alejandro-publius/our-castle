# Devpost entry copy — not submitted

Revised November 9, 2026 against the integrated source and the reviewed family-trip example. This is prepared entry text, not a submitted entry or a claim that the current video shows these features. Check final URLs and results against [release readiness](RELEASE-READINESS.md).

## Name and tagline

**Our Castle** — decide what your family can afford, then build toward it together.

## Inspiration

A camping trip is rarely just “save for a tent.” A family needs several things, already owns some of them, and has different amounts each adult is comfortable contributing. Then an expense changes the plan. We wanted to help the family see its choices together: what fits, when it can happen, and the smallest change that keeps the trip possible.

The shared goal becomes a pixel woodland. Its campsite, garden or schoolhouse develops with recorded progress, giving the household a place to return to as well as a plan to discuss.

## What it does

1. **List what the family needs.** Type a packing list, or use the optional OpenAI photo reader to make an editable draft. An adult corrects quantities, marks what is already at home and explicitly saves the list.
2. **Compare whole kits.** Adults add Channel3 listings and enter how many items one listing supplies. The planner combines the items still needed, each adult's weekly offer, the target date and a one-off expense. It shows distinct tradeoffs: lowest listed total, lower known listed weight and fewer shops. Missing prices or weights stay unknown; taxes and shipping are excluded.
3. **Adapt without starting again.** Choose a kit and keep a line the family has agreed on. If an expense grows, the planner offers the fewest changed lines that restore feasibility, while preserving every kept choice. If nothing fits, it shows the shortfall and later finish instead of inventing an affordable answer.
4. **Agree on the plan.** Adults can make weekly offers and preferences. Reviewing a kit opens an unsaved goal and schedule; saving the goal and choosing to use the schedule remain explicit. Children can explore and read the chosen plan. Optional passkey-based family access supports invitations and live updates across separately signed-in members.
5. **Contribute and see progress.** An adult approves one exact amount for PayPal sandbox checkout, or a clearly labelled simulated contribution in the no-key example. Confirmed contributions open districts and develop the chosen project. **Review the receipt** reaches that exact contribution in the Treasury.

The [playable family-trip example](FAMILY-TRIP-EXAMPLE.md) runs with `npm run demo -- --family-trip`. Its family, six listings and two shops are invented; the existing planning engine computes the results. In the example, a $90 one-off leaves two distinct $150/$180 kit choices. After choosing the $180 kit and keeping its stove, changing the one-off to $120 produces a $150 repair that switches only the tent. These are reproducible example calculations, not a claim about real shopping prices or observed family outcomes.

Our Castle records goal progress, not a bank balance or a savings account. Reported savings, simulated contributions and sandbox captures are kept distinct. Browsing, comparing, voting and trying an expense never spend money.

## How we built it

- **PayPal — an adult-approved contribution.** JavaScript SDK v6 opens checkout; Server SDK 2.5.0 handles sandbox Orders v2 and refunds. The server checks amount, currency, household, goal and capture identity before crediting once. Idempotency, same-order recovery, verified webhook processing and refund reconciliation keep uncertain or delayed outcomes from creating false progress.
- **Anthropic Claude — schedules and read-only questions.** The server validates structured schedule dates, cents and totals. The steward uses only scoped `get_order` and `list_transactions` through PayPal's Agent Toolkit. It cannot create, capture or refund payments. The rules planner and local saved-history answers remain available without a model key.
- **Channel3 — candidate products.** Search, selected variants, explicit refresh and cheaper alternatives supply listings for the family's goal and kit. A human supplies the selling-unit count; the app never guesses a pack size from a title. Comparing and repairing an already-loaded kit make no catalogue call. Our Castle contributions do not purchase the retailer's products.
- **Rust — exact complete-kit search.** A bounded native solver explores combinations of up to three listings for each of eight items using checked integer cents, quantities and weights. The Node boundary validates every answer, limits time/output/concurrency and passes no credentials or payment authority. An independent JavaScript reference supports no-Rust checkouts and differential tests. We make no measured speed claim.
- **OpenAI — an optional photo-to-draft reader.** Structured output turns a photographed list into editable items, with server validation and adult correction before saving. One live synthetic-image adapter check passed; this is not a real-world photo accuracy benchmark.
- **Cohere — optional preference ordering.** Rerank orders already-eligible kits using public titles and shops. Budget, required quantities and kept choices remain deterministic. Family names, offers, dates and amounts are not sent. The adapter and fallback are implemented and fake-provider tested; live activation and ranking-quality evaluation remain pending.
- **AG Grid / AG Studio — the Treasury.** Grid Community presents searchable records. Studio 3.1's typed data engine powers the illustrated next-area and planned/recorded weekly widgets, preserving selection and filters through updates. Its Agent Framework runs the existing steward with scoped cancellation and cleanup.
- **APIMatic — SDK-specific development context.** Eight installed PayPal context skills support the pinned generated SDK integration. Tests exercise actual OAuth, controllers and serialization through fake transport, including request IDs, digital-goods settings and bounded failure handling. This is documented context use, not a newly discovered SDK vulnerability.
- **Foundation.** Node.js, SQLite, browser JavaScript, Three.js and original pixel artwork. Focused CI builds the Rust solver, tests Node 22.16/24/26 and runs desktop/390 px browser journeys. Payment model tests, controlled process restarts and two-server races use disposable databases and fake providers.

## Existing materials and hackathon work

We reused the owner's earlier Tiny Castle artwork, bundled fonts and pixel-rendering foundation. During the hackathon we built the connected family world, goal planning, PayPal/AI/sponsor integrations, shared access, complete-kit decisions and recovery work described above. Original art notices and provenance remain in the repository. No copied Pokémon art, music or code is used for Moss's optional castle-keeper tour.

## What we verified

| Evidence | What it establishes and what it does not |
| --- | --- |
| Preserved in-app $15 sandbox result | One owner-completed capture, one credit from $60 reported to $75, and actual same-order `get_order`/server match. Historical live evidence; continuous popup/unlock/steward footage is unconfirmed. [Exact record](IN-APP-SANDBOX-VERIFICATION.md). |
| November 9 saved-app upgrade | Reviewed source `b21b2d8`, schema 12 and the compiled solver activated on both saved Mac apps after private backup/rehearsal. All original application-table values and the historical $15 capture were preserved; no new PayPal call. |
| November 9 OpenAI check | One synthetic packing-list image passed through the real photo adapter and returned the four expected item counts. No household photo, browser-upload or comparative accuracy claim. |
| Complete-kit engine | Compiled Rust/reference agreement on 403 cases, bounded-process checks, kept-choice repair, quantities, freshness, access and explicit adoption. Fake catalogue and Cohere evidence; no measured ranking-quality or speed claim. |
| Playable family trip | The actual engine over invented local listings, exercised through desktop and 390 px browser controls. Example results and simulated money are labelled throughout. [Guide and checks](FAMILY-TRIP-EXAMPLE.md). |
| Channel3 | One historical real desktop search. Newer fit/variant/refresh/kit flows have fake-provider coverage and are not fresh live-catalogue proof. |
| Shared families and recovery | Passkey ceremonies with software/virtual authenticators, separate browser contexts, controlled process faults and disposable data. These are not human playtests, physical-device tests or production reliability guarantees. |

[VALIDATION.md](VALIDATION.md) records exact source heads, raw-check summaries and known limits. The current review video predates the new planning features, and its checkout insert remains unfilmed. Neither API results nor the invented example reconstruct missing footage.

## Challenges and learning

The important product change was moving beyond a single goal amount. A family needs quantities, things already owned, personal offers and choices it wants to keep. The planner therefore separates hard constraints from optional text preferences, and shows what actually changes when an expense grows.

The inviting world still needs precise records. We kept reported savings, simulated payments and sandbox captures distinct, and prevented older answers or delayed payment events from overriding newer facts. The family remains responsible for saving a plan and approving every contribution.

## AI and development disclosure

Runtime AI uses Anthropic for the planner/steward, optional OpenAI for kit-photo drafts and optional Cohere for eligible-kit ordering. Each integration has separate server-side configuration. Claude Code and OpenAI Codex assisted with implementation, tests, design and documentation. Coding-assistant authentication is never reused as a runtime API key.

## What's next

Validate the product with real families and physical devices, complete the current-build demonstration and submit the entry. Family playtesting and web submission have not been performed. Hosted operations, public webhook delivery, commercial licensing and genuine utility-provider integrations remain future scope. Local passkey access and live household updates are already implemented.

## Submission fields still to supply

- Repository: https://github.com/alejandro-publius/our-castle
- Public YouTube video under three minutes: **not uploaded**. Existing cuts are review drafts with a missing insert.
- Functional demo: clone/run instructions plus the no-key family-trip command. The checked rules do not require a hosted site.
- Sponsor entries: Channel3, AG Grid/Studio and APIMatic, with the exact roles and limitations above. No prize or score is guaranteed.
- APIMatic plugin-use question: prepared answer below; the authenticated form has not been filled.

### Prepared APIMatic plugin-use answer

Yes. We used APIMatic Context Plugin guidance for PayPal while building Our Castle. Eight SDK-specific TypeScript/Node skills are installed and discovery-verified in Codex at repository scope. Initialization, authentication, endpoint/model, error-handling and resilience guidance supported sandbox configuration, request IDs, bounded waits and same-order recovery. The testing skill informed tests through SDK 2.5.0's actual OAuth, controllers and serializers with HTTP transport replaced. They check Orders/Payments requests, digital-goods settings, raw capture data and failures without hidden retries. These fake-transport checks are separate from the approved live sandbox evidence; we do not claim a newly discovered SDK defect.

[Skill names, provenance and use map](APIMATIC-CODEX.md). Webhook signature verification uses PayPal's separate guidance and REST API; the generated Server SDK does not implement Webhooks v1.

### Submission timing

The checked [official rules](https://paypalaihackathon.devpost.com/rules) state **Thursday, November 12, 2026, noon Pacific**. The written rules govern the schedule. Actual form completion and award selection remain separate from this prepared text.

## Prepared video upload fields

**Title:** Our Castle — a family plan that adapts when life changes | PayPal AI Hackathon

**Description:** Our Castle helps a family compare complete kits, agree on contributions and repair a plan when an expense changes. Progress develops a shared pixel woodland. Channel3 supplies product listings; AG Grid/Studio powers the Treasury; APIMatic context supports the PayPal integration. The no-key example uses invented products and simulated contributions. Source: https://github.com/alejandro-publius/our-castle .

The [shot plan](SUBMISSION-SHOTLIST.md) distinguishes proposed footage from the preserved historical review cut. Check every claim against the final recorded material before upload. No final video URL or submission confirmation exists.
