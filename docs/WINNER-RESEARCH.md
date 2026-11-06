# Previous PayPal winners: evidence and applied decisions

Researched November 6, 2026. Eight distinct winners across three competitions are covered below; Rosen appears in two events and is counted once. These are official product descriptions and a participant write-up, not independent performance measurements or security audits. The 2024/2025 challenges had different goals and judging from the current AI Hackathon. Their rankings cannot predict this entry's result.

## What the primary sources establish

| Winner | Verified result / described capability | Useful lesson for Our Castle |
| --- | --- | --- |
| CrawlerPal | First, Dev Days 2025; paywall access for agents | Make the entire task understandable as one short, observable sequence |
| Codebusters / Shopware | Second, Dev Days 2025; JavaScript SDK v5 to v6, with non-blocking loading described by Shopware | Keep payment infrastructure off the family's initial world/planning path; measure requests and readiness |
| Rosen | Third, Dev Days 2025; second, 2025 Google Cloud bounty; translation and PYUSD micropayments within its social product | Keep assistance and payment outcomes in the existing family journey |
| Ripe | Grand Champion, 2024 Portal PYUSD hackathon; QR payments with review and transaction tracking | Put the approved amount and its eventual record together; recovery must preserve context |
| Lingocaster | Runner-up, 2024 Portal PYUSD hackathon; AI vocabulary quizzes and collectible progress | Make progress meaningful to the activity, with a visible developing family project |
| Phaigo | First, 2025 Google Cloud bounty; readable usernames and natural-language assistance | Ask families to choose familiar people/goals; retain provider identifiers inside receipt details |
| Normie Tech | Third, 2025 Google Cloud bounty; familiar card/PayPal payment into PYUSD without a customer wallet | Reuse familiar checkout; keep integration machinery behind the product |
| 4m.4n PYUSD Hub | Special Merit, 2025 Google Cloud bounty; wallet with transaction/network analysis | Useful analysis should explain an actual record, rather than merely produce fluent text |

Primary sources:

1. [PayPal: Dev Days 2025 winners](https://developer.paypal.com/community/blog/winners-dev-days-hackathon/), May 29, 2025.
2. [Shopware's implementation account](https://www.shopware.com/en/news/shopware-at-paypal-dev-days-2025/), June 30, 2025. It describes non-blocking loading, a unified loader and context-sensitive methods; it supplies no comparable latency benchmark for this project.
3. [PayPal: Portal PYUSD winners](https://developer.paypal.com/community/blog/winning-solutions-pyusd-portal-hackathon-solana/), December 11, 2024. The March 2025 recap describes the same competition, not another set of wins.
4. [PayPal: Google Cloud bounty winners](https://developer.paypal.com/community/blog/paypal-google-cloud-bounty-challenge-winners/), July 18, 2025.
5. [Firsthand Postman account of CrawlerPal](https://community.postman.com/t/postman-paypal-community-winning/79892), May 12, 2025. It describes Vault and subsequent-payment integration; saying CrawlerPal only listed PayPal as a method would be inaccurate.
6. [CrawlerPal public source](https://github.com/positiveblue/CrawlerPal), inspected in this research for its Orders API request. Current source is not proof of the exact award-day implementation.
7. [Current judging criteria](https://paypalaihackathon.devpost.com/): implementation, coherent design, demonstrated impact, innovation and an understandable working demonstration.

## Decisions across the current judging criteria

| Facet | Current evidence | Decision / remaining work |
| --- | --- | --- |
| Implementation | One real sandbox capture/credit and same-order Toolkit `get_order` match; saved checks, idempotent capture and refund recovery | Preserve that evidence. This pass targets browser initialization failure and overlapping approval attempts with isolated fake-provider tests |
| Performance | Grid/Studio already load on Ledger. PayPal was initialized by hidden Contribute rendering | Defer the PayPal SDK/config/eligibility work until Contribute is chosen; initialization is distinct from creating an order |
| Design | World-first realm, one journal, short deeds and one general notice | Preserve existing typography and layout. Show one Retry checkout action only if initialization fails; retain amount and approval |
| Useful AI | Validated schedule proposals and a scoped read-only steward | Demonstrate assistance with a family decision and an actual matching record. A refusal to spend is a safeguard, not sufficient novelty on its own |
| Impact | Real integration proof; the three-person playtest remains unrun | Obtain actual observed task completion and understanding. Automated checks cannot establish family benefit |
| Innovation | Shared goal expressed as a persistent world; the current goal project is always a campsite | Goal-specific projects and family choices are a useful next expansion, while existing homes remain. This pass does not claim that choice is implemented |
| Collaboration | Family avatars and fixed example personas | Real member authentication, invitations and independent sessions remain a product gap; a persona switch is not secure family participation |
| Sponsors | Channel3 item-to-goal; AG Grid/Studio Treasury and Agent Framework; APIMatic context/SDK findings | Keep these in the existing loop and cite their actual evidence. Another sponsor logo or unrelated API adds no demonstrated benefit |
| Developer experience | `npm run demo`, no keys needed; public source and run instructions | Keep clean startup and error recovery observable; keep provider-dependent checks distinct from no-key tests |
| Presentation | Approved runtime evidence exists; checkout footage is missing from the existing cut | Capture remains paused. No recording, upload or submission is implied by this work |

The family story remains: choose a goal, review an affordable plan, approve a contribution, see the server-confirmed result and visit the resulting world progress. Technical receipt details support that story without becoming a second dashboard.

## Checkout work in this pass

Review found that every state render started sandbox checkout even while Contribute was hidden. A failed script promise stayed rejected forever. The button also lacked an in-progress guard; server idempotency protects a reused request id, but repeated browser clicks generate different ids and can represent different orders. A later callback must remain attached to the window/order that produced it.

The implemented correction is demand-driven initialization, bounded script loading with an explicit retry before an order exists, and one active checkout attempt whose callbacks retain its own order and scope. The existing capture endpoint is unchanged; no refund, provider-check action or automatic order retry is added. This is browser recovery, not a claim of new live payment evidence.

### Interface reference lock

Primary: [the existing game direction](INTERFACE-DIRECTION.md), including its owned fonts, parchment journal and sparse actions. Refero's [Wayfinder style](https://wayfinder.nfb.ca) was retrieved again for world-first restraint; none of its palette/type tokens replace ours. [Douze checkout flow 6739](https://refero.design/flows/6739) supplies the narrow interaction lesson: preserve entered details and keep recovery at the failed action. Its purchase retry is not copied onto an uncertain payment outcome; our Retry checkout action is confined to initialization, before an order is requested.

| Decision | Source / role |
| --- | --- |
| Keep the world and Plan free of PayPal loading | Shopware's loading lesson; existing world-first direction |
| Keep the same amount/approval during a load retry | Douze recovery flow; existing amount-specific consent |
| One inline Retry checkout, only on load failure | Existing journal actions and owner's less-is-more instruction |
| Bind callbacks to one approval attempt | Existing same-order payment contract; SDK session/callback reference |

[PayPal v6 setup](https://developer.paypal.com/sdk/js/set-up) (updated October 13, 2026) and [reference](https://developer.paypal.com/sdk/js/reference/) (October 29) were checked. This pass preserves the installed Server SDK 2.5.0, current client-id initialization, server ownership/verification and SDK callback contract. The APIMatic resilience/testing context informs the separation of retries and fake transport evidence; it is not the source of browser SDK APIs.

## Actual checks

Before editing product code, three new desktop cases reproduced the hidden initialization, permanently failed loader and two orders from rapid clicks. The latter used distinct request ids, as the actual form does; reusing an id would have hidden the browser defect behind server idempotency.

After the fix, **22 targeted browser cases passed**: eight new scenarios and three existing callback regressions at both desktop and 390 px touch-phone sizes. The new scenarios cover on-demand loading and retained input/approval, explicit recovery from download failure, a 20-second stalled-download deadline with a virtual clock, one order/capture/credit under rapid clicks, stale-window callbacks, a mismatched approval id, retained household scope, and cancel/approval racing during creation/capture. The complete app's load-recovery case proves every application table unchanged and zero fake provider requests before a payment click. Actual desktop and phone captures were inspected; the existing journal styling and world remain.

Commands: `npx playwright test test/e2e/checkout-readiness.spec.mjs test/e2e/paypal-callbacks.spec.mjs --reporter=line` and `npm run check`. The original 47-file, 90-colour palette, renderer and syntax guard passed; diff checks passed. The initial full-motion software-WebGL run timed out in the two complete-scene cases (seven wrapper cases passed, seven did not run); the final run uses the same reduced-motion policy as existing Plan interaction tests and passed in 1.1 minutes. This is not a hardware graphics or real-phone performance benchmark.

Ignored evidence: `test-results/checkout-readiness-{before,after,final}.log` and the final `test-results/artifacts/checkout-readiness-world-*/{world-before-checkout,checkout-retry}.png` captures. Tests used in-memory households, a scripted SDK and stateful fake PayPal transport, blocking unrelated network traffic. No actual PayPal script, popup, payment, paid model/search, owner record or recording was used. Prior real sandbox evidence remains historical; this revised browser wrapper has not been replayed against a real popup. Server money logic and dependencies are unchanged.

Real family accounts, observed playtesting and the unfinished video/form are not marked complete by a checkout improvement. The remaining build priorities are secure shared family participation and goal-specific world projects, alongside Rachel's actual playtest observations. Their value must be demonstrated before making comparative claims about previous winners.
