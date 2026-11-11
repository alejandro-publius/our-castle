# Devpost entry copy — not submitted

Revised November 10, 2026 against `main` after the village, loading and hold-first merges (#82 as `3bfe6e1`, #83 as `a56170a`) and its two playable examples. This is prepared entry text, not a submitted entry or a claim that the current video shows these features. Check final URLs and results against [release readiness](RELEASE-READINESS.md).

## Name and tagline

**Our Castle** — decide what your family can afford, then build toward it together.

## Inspiration

A camping trip is rarely just “save for a tent.” A family needs several things, already owns some of them, and has different amounts each adult is comfortable contributing. Then an expense changes the plan. We wanted to help the family see its choices together: what fits, when it can happen, and the smallest change that keeps the trip possible.

The shared goal becomes a pixel woodland. Its campsite, garden or schoolhouse develops with recorded progress, giving the household a place to return to as well as a plan to discuss.

Some goals are bigger than one household: a class trip, a shared library. Neighboring families can fund one project together while each family's own plan and amounts stay its own.

## What it does

1. **List what the family needs.** Type a packing list, or use the optional OpenAI photo reader to make an editable draft. An adult corrects quantities, marks what is already at home and explicitly saves the list.
2. **Compare whole kits.** Adults add Channel3 listings and enter how many items one listing supplies. The planner combines the items still needed, each adult's weekly offer, the target date and a one-off expense. It shows distinct tradeoffs: lowest listed total, lower known listed weight and fewer shops. Missing prices or weights stay unknown; taxes and shipping are excluded.
3. **Adapt without starting again.** Choose a kit and keep a line the family has agreed on. If an expense grows, the planner offers the fewest changed lines that restore feasibility, while preserving every kept choice. If nothing fits, it shows the shortfall and later finish instead of inventing an affordable answer.
4. **Agree on the plan.** Adults can make weekly offers and preferences. Reviewing a kit opens an unsaved goal and schedule; saving the goal and choosing to use the schedule remain explicit. Children can explore and read the chosen plan. Optional passkey-based family access supports invitations and live updates across separately signed-in members.
5. **Contribute and see progress.** An adult approves one exact amount for PayPal sandbox checkout, or a clearly labelled simulated contribution in the no-key example. Confirmed contributions open districts and develop the chosen project. **Review the receipt** reaches that exact contribution in the Treasury. An adult can instead hold the amount first: nothing counts until an adult releases an exact part of it or returns it.
6. **Share a project with the neighbors.** Adults can start a private neighborhood, invite another family with a single-family code that lasts 24 hours, describe a shared project in one sentence, then review and accept the draft. Each family chooses only its own share; nobody can promise another family's money. An approved contribution appears for every member family and develops a shared schoolhouse in a shared square. Private amounts never appear there, and a family's castle appearance is shown only if an adult opts in.

The [playable family-trip example](FAMILY-TRIP-EXAMPLE.md) runs with `npm run demo -- --family-trip`. Its family, six listings and two shops are invented; the existing planning engine computes the results. In the example, a $90 one-off leaves two distinct $150/$180 kit choices. After choosing the $180 kit and keeping its stove, changing the one-off to $120 produces a $150 repair that switches only the tent. These are reproducible example calculations, not a claim about real shopping prices or observed family outcomes.

The [shared village example](VILLAGE-DEMO.md) runs with `npm run demo -- --village-fund`. Five invented families share **Class trip together**, starting at $200 of $400. Approving one exact $40 simulated contribution moves the shared total to $240 and the schoolhouse to its second stage, while the family's own $60/$300 goal is unchanged. [Two fresh signed-in families](VILLAGE-FIRST-USE.md) can also reach one shared project from nothing through the same controls.

Our Castle records goal progress, not a bank balance or a savings account. Reported savings, simulated contributions and sandbox captures are kept distinct, and a shared fund's total is never mixed with a family's own. Browsing, comparing, voting and trying an expense never spend money.

## How we built it

- **PayPal — an adult-approved contribution.** JavaScript SDK v6 opens checkout; Server SDK 2.5.0 handles sandbox Orders v2 and refunds. The server checks amount, currency, household, goal and capture identity before crediting once. Idempotency, same-order recovery, verified webhook processing and refund reconciliation keep uncertain or delayed outcomes from creating false progress. An opt-in hold-first path creates the order with intent `AUTHORIZE`; later an adult captures an exact amount as the final capture or voids it. That path has fake-provider and example-mode evidence only: no real sandbox hold has been made.
- **Shared village funds.** A neighborhood-bound project keeps its own accounting: voluntary own-family shares, immutable receipt events and refund-aware progress. Each fund uses one rail, and totals are never mixed: simulated USD, PayPal sandbox USD with a server-validated recipient frozen on the order, or read-only observation of PYUSD test tokens on Solana devnet. The sandbox-recipient and devnet paths are tested against fake transports only; no real recipient, wallet or token transfer has been used, and watching an address does not control what its owner spends.
- **Anthropic Claude — schedules and read-only questions.** The server validates structured schedule dates, cents and totals. The steward uses only scoped `get_order` and `list_transactions` through PayPal's Agent Toolkit. It cannot create, capture or refund payments. The rules planner and local saved-history answers remain available without a model key.
- **Channel3 — candidate products.** Search, selected variants, explicit refresh and cheaper alternatives supply listings for the family's goal and kit. A human supplies the selling-unit count; the app never guesses a pack size from a title. Comparing and repairing an already-loaded kit make no catalogue call. Our Castle contributions do not purchase the retailer's products.
- **Rust — exact complete-kit search.** A bounded native solver explores combinations of up to three listings for each of eight items using checked integer cents, quantities and weights. The Node boundary validates every answer, limits time/output/concurrency and passes no credentials or payment authority. An independent JavaScript reference supports no-Rust checkouts and differential tests. We make no measured speed claim.
- **OpenAI — an optional photo-to-draft reader.** Structured output turns a photographed list into editable items, with server validation and adult correction before saving. One live synthetic-image adapter check passed; this is not a real-world photo accuracy benchmark.
- **Cohere — optional preference ordering.** Rerank orders already-eligible kits using public titles and shops. Budget, required quantities and kept choices remain deterministic. Family names, offers, dates and amounts are not sent. The adapter and fallback are implemented and fake-provider tested. On November 10 the owner's key was set in private local configuration and one live request through the adapter returned an ordering; that shows the connection works, not that the ordering is good. The owner's saved apps were restarted in the November 10 upgrade and now select it; ranking quality has not been evaluated.
- **AG Grid / AG Studio — the Treasury.** Grid Community presents searchable records. Studio 3.1's typed data engine powers the illustrated next-area and planned/recorded weekly widgets, preserving selection and filters through updates. Its Agent Framework runs the existing steward with scoped cancellation and cleanup.
- **MCP — a read-only assistant bridge.** Three local stdio read tools expose one adult-selected shared fund through short-lived, revocable access. Tested with the real SDK protocol and a child process; no owner assistant has been connected to it.
- **APIMatic — SDK-specific development context.** Eight installed PayPal context skills support the pinned generated SDK integration. Tests exercise actual OAuth, controllers and serialization through fake transport, including request IDs, digital-goods settings and bounded failure handling. This is documented context use, not a newly discovered SDK vulnerability.
- **Foundation.** Node.js, SQLite, browser JavaScript, Three.js and original pixel artwork. Focused CI builds the Rust solver, tests Node 22.16/24/26 and runs desktop/390 px browser journeys, including the shared village. Payment model tests, controlled process restarts and two-server races use disposable databases and fake providers.

## Existing materials and hackathon work

We reused the owner's earlier Tiny Castle artwork, bundled fonts and pixel-rendering foundation. During the hackathon we built the connected family world, goal planning, PayPal/AI/sponsor integrations, shared access, complete-kit decisions and recovery work described above. Original art notices and provenance remain in the repository. No copied Pokémon art, music or code is used for Moss's optional castle-keeper tour. The brief knight-and-dragon [loading scene](DRAGON-LOADING.md) is an original pixel animation drawn in code for this project.

## What we verified

| Evidence | What it establishes and what it does not |
| --- | --- |
| Preserved in-app $15 sandbox result | One owner-completed capture, one credit from $60 reported to $75, and actual same-order `get_order`/server match. Historical live evidence; continuous popup/unlock/steward footage is unconfirmed. [Exact record](IN-APP-SANDBOX-VERIFICATION.md). |
| November 9 saved-app upgrade | Reviewed source `b21b2d8`, schema 12 and the compiled solver activated on both saved Mac apps after private backup/rehearsal. All original application-table values and the historical $15 capture were preserved; no new PayPal call. Superseded by the November 10 upgrade below. |
| November 10 saved-app upgrade | Both saved Mac apps moved to `a56170a`, schema 12 → 18, after backups and a rehearsed rollback on private copies. Every original row and the historical $15 capture were preserved; no provider request. A local upgrade, not a hosted deployment. [Record](evidence/runtime-activation-20261110.json). |
| Hold-first contributions | [#83](https://github.com/alejandro-publius/our-castle/pull/83): 25 unit cases against both PayPal adapters with transport replaced, nine deliberate rule breaks each caught, and one example-mode browser journey. No real sandbox hold, capture or void. [Details](PAYMENT-HOLDS.md). |
| November 10 village and loading release | Shared funds, the two-family journey and the loading scene, merged to `main` as `3bfe6e1`. The final-candidate [run 42933883601](https://github.com/alejandro-publius/our-castle/actions/runs/42933883601) passed all ten jobs on the reviewed head `795a6e7`, and the automatic post-merge [run 42936771527](https://github.com/alejandro-publius/our-castle/actions/runs/42936771527) passed all ten on `main`. Fake providers, disposable data, virtual authenticators and an emulated phone; no sandbox recipient, devnet wallet, connected assistant or real family. [What was checked](VALIDATION.md#combined-village-and-loading-release--november-10-2026). |
| November 9 OpenAI check | One synthetic packing-list image passed through the real photo adapter and returned the four expected item counts. No household photo, browser-upload or comparative accuracy claim. |
| Complete-kit engine | Compiled Rust/reference agreement on 403 cases, bounded-process checks, kept-choice repair, quantities, freshness, access and explicit adoption. Fake catalogue and Cohere evidence, plus the one live Cohere connection check above; no measured ranking-quality or speed claim. |
| Playable family trip | The actual engine over invented local listings, exercised through desktop and 390 px browser controls. Example results and simulated money are labelled throughout. [Guide and checks](FAMILY-TRIP-EXAMPLE.md). |
| Channel3 | One historical real desktop search. Newer fit/variant/refresh/kit flows have fake-provider coverage and are not fresh live-catalogue proof. |
| Shared families and recovery | Passkey ceremonies with software/virtual authenticators, separate browser contexts, controlled process faults and disposable data. These are not human playtests, physical-device tests or production reliability guarantees. |

[VALIDATION.md](VALIDATION.md) records exact source heads, raw-check summaries and known limits. The current review video predates the planning and village features, and its checkout insert remains unfilmed. Neither API results nor the invented example reconstruct missing footage.

## Challenges and learning

The important product change was moving beyond a single goal amount. A family needs quantities, things already owned, personal offers and choices it wants to keep. The planner therefore separates hard constraints from optional text preferences, and shows what actually changes when an expense grows.

The inviting world still needs precise records. We kept reported savings, simulated payments and sandbox captures distinct, and prevented older answers or delayed payment events from overriding newer facts. The family remains responsible for saving a plan and approving every contribution.

## AI and development disclosure

Runtime AI uses Anthropic for the planner/steward, optional OpenAI for kit-photo drafts and optional Cohere for eligible-kit ordering. Each integration has separate server-side configuration. Claude Code and OpenAI Codex assisted with implementation, tests, design and documentation. Coding-assistant authentication is never reused as a runtime API key.

## What's next

Validate the product with real families and physical devices, complete the current-build demonstration and submit the entry. Family playtesting and web submission have not been performed. Shared funds still need a real sandbox recipient and a devnet wallet before their PayPal and PYUSD paths can be called accepted. The hold-first path still needs one real sandbox hold, a partial release and a return before anything is claimed about it with PayPal. Hosted operations, public webhook delivery, commercial licensing and genuine utility-provider integrations remain future scope. Local passkey access and live household updates are already implemented.

## Submission fields still to supply

- Repository: https://github.com/alejandro-publius/our-castle
- Public YouTube video under three minutes: **not uploaded**. Existing cuts are review drafts with a missing insert.
- Functional demo: clone/run instructions plus the two no-key commands, `npm run demo -- --family-trip` and `npm run demo -- --village-fund`. The checked rules do not require a hosted site.
- Sponsor entries: Channel3, AG Grid/Studio and APIMatic, with the exact roles and limitations above. No prize or score is guaranteed.
- APIMatic plugin-use question: prepared answer below; the authenticated form has not been filled.

### Prepared APIMatic plugin-use answer

Yes. We used APIMatic Context Plugin guidance for PayPal while building Our Castle. Eight SDK-specific TypeScript/Node skills are installed and discovery-verified in Codex at repository scope. Initialization, authentication, endpoint/model, error-handling and resilience guidance supported sandbox configuration, request IDs, bounded waits and same-order recovery. The testing skill informed tests through SDK 2.5.0's actual OAuth, controllers and serializers with HTTP transport replaced. They check Orders/Payments requests, digital-goods settings, raw capture data and failures without hidden retries. These fake-transport checks are separate from the approved live sandbox evidence; we do not claim a newly discovered SDK defect.

[Skill names, provenance and use map](APIMATIC-CODEX.md). Webhook signature verification uses PayPal's separate guidance and REST API; the generated Server SDK does not implement Webhooks v1.

### Submission timing

The checked [official rules](https://paypalaihackathon.devpost.com/rules) state **Thursday, November 12, 2026, noon Pacific**. The written rules govern the schedule. Actual form completion and award selection remain separate from this prepared text.

## Prepared video upload fields

**Title:** Our Castle — a family plan that adapts when life changes | PayPal AI Hackathon

**Description:** Our Castle helps a family compare complete kits, agree on contributions and repair a plan when an expense changes. Progress develops a shared pixel woodland, and neighboring families can fund one project together. Channel3 supplies product listings; AG Grid/Studio powers the Treasury; APIMatic context supports the PayPal integration. The no-key examples use invented families and products and simulated contributions. Source: https://github.com/alejandro-publius/our-castle .

The [shot plan](SUBMISSION-SHOTLIST.md) distinguishes proposed footage from the preserved historical review cut. Check every claim against the final recorded material before upload. No final video URL or submission confirmation exists.
