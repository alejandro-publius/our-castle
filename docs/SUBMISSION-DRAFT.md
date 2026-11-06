# Devpost entry copy — not submitted

Prepared November 5, 2026; story and sponsor wording revised the same day (PST). This describes the current build; it does not replace the live-evidence notes below. Check final URLs and results against [release readiness](RELEASE-READINESS.md) before sending the entry.

## Name and tagline

**Our Castle** — one family goal, a realm you build together.

## Inspiration

A family working toward a camping trip, a bike or a repair needs a goal everyone can follow. We wanted to bring that plan out of a spreadsheet and into a place the household can look at together: a pixel woodland where each milestone opens a new district, where a child can ask how far the Manor is, and where contributions stay exact, adult-approved and honest about what has and has not been confirmed.

## What it does

Our Castle gives a family one shared goal, one editable plan and one growing realm. Adults keep control of every payment; children see progress as places opening up. The journey is four steps:

1. **Find it — Channel3 Merchant.** Open **Find an item** beside Goal in Plan, or visit Market Town. The merchant searches real products within a budget and shows up to three results with returned price and availability. **Use as goal** drafts the goal at that price, excluding tax and shipping. Nothing changes until the family confirms **Save as our goal**; a search never buys anything.
2. **Plan it — Claude planner.** The household enters its reported starting progress, a target date and a weekly amount it chooses. The AI planner proposes an editable weekly schedule with its arithmetic written out. The server re-checks every date, amount and total and says plainly when the goal is out of reach. Without an AI key, a labelled built-in rules planner remains available.
3. **Contribute — PayPal.** An adult approves one specific amount and opens PayPal sandbox checkout from the app. The server captures the order, checks amount, currency, household, goal and capture identity, and credits progress once. Pending and declined contributions do not count; an uncertain capture is checked against the same order, and refunds subtract once. A redirect, retry or model claim alone is not payment proof.
4. **Unlock.** At 25% the bridge to Manor Gardens lowers; 40% opens Market Town; 60% opens Stone Keep and Starfall Observatory; 100% opens the Royal Citadel, Rosewind Palace and Rapunzel's Tower. Each new district arrives with a short deed card showing the house crest and the family's chosen characters. Earlier districts stay. A refund lowers progress truthfully; an earned deed remains as a keepsake and says so.

Between steps, the Treasury keeps the next area, the contribution records and one selected receipt together, and the house steward answers questions such as "did PayPal confirm our last contribution?" It is read-only: it reads the ledger and, through PayPal's Agent Toolkit, looks up the selected order. The server returns the checked facts and whether PayPal and the ledger agree; a model's sentence alone never verifies a payment, and the steward cannot create, capture or refund anything.

The nine-district woodland has flowing rivers, drawbridges, family avatars, roaming guests, farm animals, a tavern and a hidden sword in the stone. Day, afternoon, night and rain change its light; optional city weather uses Open-Meteo. The ledger is a goal-progress record, not a bank balance: bills and gifts are recorded separately and never count as savings, and no utility provider is connected.

## How we built it

Each sponsor does one specific job for the family; none is decorative.

- **PayPal — the contribution.** JavaScript SDK v6 for in-app checkout; the official Server SDK 2.5.0 for sandbox Orders v2 and refunds; a Webhooks v1 listener that requires signature verification before processing an event. Integer cents, request idempotency and unique capture/refund records prevent duplicate credit. Amount, currency, household, goal, order reference and capture identity are checked server-side before progress moves. A timed-out capture rechecks the same order instead of being declared failed or replaced, and the receipt's explicit check can recover a dashboard refund from the order record once when its webhook never arrives. Webhook delivery and dashboard-refund recovery have fake-provider coverage; live webhook delivery remains unverified.
- **Anthropic Claude — the plan and the steward.** `claude-opus-5-5` through the Messages API, server-side only. The planner returns a structured schedule that the server validates for dates, cents, totals and feasibility. The steward answers household questions with two read-only PayPal Agent Toolkit tools, scoped `get_order` and `list_transactions`; it cannot authorize, capture or refund. Names, product titles and payment notes are treated as data, never instructions: tests play a model that obeys an injected product title or transaction note and confirm the server still refuses to verify or credit anything.
- **Channel3 — the goal.** Server-side product search with an optional budget, at most three results, and the item's real price as the drafted goal amount. Credentials stay on the server; the family confirms before the goal changes, and a search never triggers a payment.
- **AG Grid / AG Studio — the Treasury.** AG Grid Community lists searchable contribution records and receipts. AG Studio renders a parchment-themed custom next-area widget from a typed data model with a calculated share-of-threshold field evaluated by Studio's engine, and its Agent Framework runs the existing steward through a custom server-backed runner with scoped cancellation and thread cleanup. No second chatbot or generic dashboard is added; no built-in-agent delegation is claimed.
- **APIMatic — the PayPal integration's reference.** PayPal's APIMatic-generated Server SDK plus eight installed, discovery-verified SDK context skills used by Codex. That context informed uncertain-capture recovery, stale-read protection, bounded waits on every PayPal call and raw-body webhook verification, each covered by documented fake-provider tests.
- **Postman:** guarded example and opt-in sandbox walkthroughs, including replay and wrong-household checks.
- **Stack and art:** Node.js (`node:http`, `node:sqlite`), browser JavaScript and Three.js. Original Tiny Castle art, fonts and the 90-colour renderer carry over from the owner's earlier project; the connected world and PayPal/AI/sponsor experience were built for Our Castle. Inspiration references contributed no copied third-party game art or code.

## Existing materials and work completed during the hackathon

We reused the owner's earlier Tiny Castle artwork, bundled fonts and pixel-rendering foundation. We built Our Castle's family setup, shared goal and weekly plan, connected woodland districts, bridges and earned deed cards during the hackathon. New integration work includes adult-approved PayPal sandbox checkout, a server-verified contribution ledger and persistent rewards, the live AI planner and read-only payment steward, Channel3's merchant, and the AG Grid/AG Studio Treasury. Repository history and [validation records](VALIDATION.md) document that work; the earlier artwork is not presented as newly created for this event.

## What we verified

| Evidence | What it establishes |
| --- | --- |
| November 5 PST / November 6 UTC in-app sandbox result | Owner-completed $15 contribution; one persisted credit from $60 reported to $75; village/Manor open; actual same-order Agent Toolkit `get_order` and deterministic server `match`. Subsequent steward verification used the local API. [Exact evidence](IN-APP-SANDBOX-VERIFICATION.md); continuous popup/bridge/steward UI footage is unconfirmed. |
| November 4 UTC / November 3 PST sandbox verifier | Buyer-approved **hosted approval link**, $15 capture, one credit from $60 to $75, replay safety, wrong-household refusal, matching PayPal record and one refund reversal. It does not establish the in-app popup. |
| Same-date live AI run | A feasible plan covering $240 exactly, an impossible plan reporting its $160 shortfall, ledger reading and PayPal transaction listing. No household-order `get_order` was verified in that run. |
| November 5 Channel3 desktop check | One real search returned three real USD products and rendered their images. Phone and goal-save contracts use fake results. |
| Current local browser/contract checks | Full family journey, simulated credit/unlocks, real AG Studio widget/framework, cancellation, fallback and selected-order proof with fake providers. Exact runs and limitations are in [VALIDATION.md](VALIDATION.md); these are not new live financial evidence. |
| November 5 anonymous public clone | Clean install/source guard and ten current-build journey/phone checks passed with actual `npm run demo`; a fresh in-memory example household, no keys, saved data or provider call. |

**Runtime check now complete; recorded insert still missing:** the owner completed the approved contribution, and the same-order steward check passed after a focused compatibility fix. No continuous owner recording has been located or confirmed. Existing review videos still label the missing insert; neither their example footage nor the runtime API evidence reconstructs a popup or bridge animation. No entry has been submitted.

## Challenges and learning

An inviting game still needs a precise ledger. We kept reported savings, simulated payments, sandbox captures, gifts and bills distinct, while removing repeated explanation from the game screen. Keeping one current receipt also matters: a correct answer about an earlier selection must disappear when the family changes records. The Studio framework now manages that boundary behind the existing interface.

## AI and development disclosure

Runtime AI is Anthropic Claude through the official SDK, called server-side for the planner and read-only steward. Claude Code and OpenAI Codex assisted with implementation, tests, design iteration and documentation. Coding-assistant authentication is never reused as a runtime API key.

## What's next

Finish the final public video using genuine source footage and submit the entry. The approved sandbox contribution and same-order verification now pass; no replacement payment is needed. Beyond the hackathon: real member authentication, shared household access, commercial licensing and provider-backed bill rewards. No utility provider is connected; household-entered bills remain reported and verified-bill rewards remain connection-required. This goal ledger is not a bank balance or a savings account.

## Submission fields still to supply

- Repository: https://github.com/alejandro-publius/our-castle — public access confirmed November 5, 2026; recheck the final submission URL.
- Public YouTube video under three minutes: **not uploaded**. Existing cuts are review drafts; the missing live insert remains unfilmed.
- Functional demo: repository setup instructions; a hosted site is not required by the checked rules.
- Sponsor entries: Channel3, AG Grid/Studio and APIMatic; describe the exact use above. No award eligibility or result is guaranteed.
- APIMatic plugin-use question: use the prepared answer below, adapting it to the actual form wording. The signed-in submission form has not been inspected or filled here; this is a draft, not a completed sponsor entry.

### Prepared APIMatic plugin-use answer

Yes. We used PayPal's APIMatic Context Plugin TypeScript/Node guidance in Codex while developing Our Castle's PayPal integration. Eight SDK-specific skills are installed and discovery-verified at repository scope. We used them to check the exact PayPal Server SDK 2.5.0 initialization, sandbox environment, OAuth fields, timeouts and retry behavior. The guidance informed recovery for uncertain captures and bounded read checks, with focused fake-provider tests and documented findings. Installation, provenance and actual use: https://github.com/alejandro-publius/our-castle/blob/main/docs/APIMATIC-CODEX.md . This is a repository-scoped context installation, not a claim of global marketplace registration.

### Submission timing

Use **Thursday, November 12, 2026, 12:00 p.m. Pacific**, as stated in the [official rules](https://paypalaihackathon.devpost.com/rules) checked November 5. The supplied webinar notes report a later spoken time; the written rules govern this draft's schedule. The [APIMatic sponsor page](https://paypalaihackathon.devpost.com/details/apimatic) describes plugin-use benefits; actual form completion and award selection are still separate steps.

## Prepared video upload fields

**Title:** Our Castle — a family goal becomes a living realm | PayPal AI Hackathon

**Description:** Our Castle keeps a shared family goal, an editable weekly plan and contribution records inside a growing pixel woodland. Market Town uses Channel3 product search; the Treasury uses AG Grid and AG Studio; APIMatic context supports the PayPal integration. Source and local setup: https://github.com/alejandro-publius/our-castle .

The actual current-build review cut, source labels, captions and remaining insert are in [the current edit kit](demos/current-review/README.md). Replace its unfilmed insert and recheck this description against the recorded evidence before upload. The final visibility required by the checked rules is public. No video URL or submitted-entry confirmation exists yet.
