# Selected product scope

Our Castle helps a family decide what it can afford, keep the parts of a plan it agrees on, and adjust when an expense changes. An adult then reviews the goal and schedule and explicitly approves any contribution. The woodland shows recorded progress; a proposed kit is not a purchase or an earned unlock.

This checklist reconciles the selected work from the research and implementation discussions. The selected family-trip and map-preview features are implemented, with focused checks and a documented review route. It is a completion boundary, not a claim of production banking readiness or a predicted hackathon score. The runnable route is in [the family-trip guide](FAMILY-TRIP-EXAMPLE.md); [release readiness](RELEASE-READINESS.md) separates source, saved runtimes and live evidence.

| Selected work | Implementation and review route |
| --- | --- |
| A family decides together | [Family choices](FAMILY-CHOICES.md): adults save their own comfortable offers, members express preferences, and an expense changes dates and shortfalls. Saving the goal can propose the dated schedule; **Use this plan** explicitly puts it in use. |
| Compare a complete, affordable kit | [Kit planner](KIT-PLANNER.md): quantities, already-owned items, adult-confirmed items per listing, price, stock, must-haves, offers and deadline constrain the comparison. The bounded Rust solver and JavaScript reference return checked answers. |
| Repair the plan with the smallest change | A kept stove stays fixed when the sample expense rises from $90 to $120. The $180 chosen kit can be repaired to $150 by changing only the tent. At $200, the still-chosen $180 kit is $110 short; the separate closest $150 kit is $80 short. Neither fits the $70 limit. |
| See a proposed plan in the world | **Preview on map** is implemented as a temporary planning groundsheet with compared quantities, shop tags and kept/switched lines. A chosen kit that no longer fits can show the smallest-change proposal without changing the saved choice. Funded progress stays separate. Six desktop/phone browser cases and 16 pure unit cases cover the preview; [implementation and limits](KIT-MAP-PREVIEW.md). |
| Type or photograph a packing list | [Kit list](KIT-LIST.md): manual entry works without a key. Optional OpenAI vision produces an editable draft; the adult corrects counts before saving. One live synthetic-image adapter check is recorded separately from fake-provider browser checks. |
| Optional preference ranking | The [Cohere adapter](KIT-PLANNER.md) can order eligible kits by a selected preference. Deterministic affordability and must-have checks remain independent. The adapter is built; live ranking quality is not established and no key is required for the sample. |
| A runnable example without provider accounts | `npm run demo -- --family-trip` uses six labelled invented listings and the existing decision engine. The ordinary blank demo remains available. No sample response is presented as a real shopping offer or PayPal transaction. |
| Separate real family access | [Passkeys, invitations and live updates](FAMILY-ACCESS.md) run in the opt-in family runner. Adult/child and household boundaries are server-enforced. Switching an example persona does not impersonate authenticated collaboration. |
| Explore and learn the interface | [Moss's optional original tutorial](KEEPER-GUIDE.md), the compass/free map dragging, goal-specific projects, original crests and [default-muted music](../assets/music/README.md) are implemented. |
| Contribution to receipt | **Review the receipt** selects the exact contribution in Treasury. The earned area remains visible until the family chooses that route. The receipt distinguishes reported, simulated and sandbox evidence; [handoff](RECEIPT-HANDOFF.md). |
| Dependable payment and runtime behavior | [Validation](VALIDATION.md) records idempotency, refund-before-capture recovery, generated-SDK contracts, access rechecks, seeded model tests, two-server/crash cases and household snapshots using disposable data and fake providers. |
| Sponsor tools do useful work | [Channel3](CHANNEL3-MERCHANT.md) supplies configured shopping; [AG Grid/Studio](TREASURY.md) supplies records, the milestone widget and steward runner; [APIMatic](APIMATIC-CODEX.md) supplies SDK context and contract guidance. The steward cannot spend. |

## One product route

Start the fresh family-trip example. At a $90 one-off, compare the $150 and $180 kits, choose $180, keep the stove and select **Preview on map**. Change the expense to $120: the map shows a temporary $150 smallest-change proposal switching only the tent. The chosen $180 kit is unchanged. At $200, the preview shows that chosen kit $110 short, while the separate closest $150 card is $80 short. Return to $120, explicitly choose the repair, review it and save the goal with its proposed schedule. **Use this plan** puts that schedule in use. Approve a simulated contribution, enjoy the earned area, then choose **Review the receipt**.

The preview saves nothing, buys nothing and earns no progress. The [walkthrough](FAMILY-TRIP-EXAMPLE.md) includes actual desktop and phone preview captures and links to their source hashes and focused checks. The saved Mac sandbox rehearsal remains a separate historical record.

## What remains outside the build

- **Presentation:** rehearse and record the current product, then handle publication and submission under the owner’s authorization. The existing 2:42 cut predates the newer planning flow.
- **Evidence that needs people or live services:** observed family playtesting, real-device/passkey checks, representative photo accuracy and live Cohere ranking evaluation. Source tests do not replace these.
- **Optional services and operating terms:** configured shopping/photo/ranking credentials and suitable AG Studio production terms are not required to run the no-key example. The sample is not a hosted service.
- **Research options deliberately left out:** Kubernetes, Kafka/JunoDB/Java rewrites, broader merchant checkout/UCP/WebMCP adoption and automatic purchasing were discussed as possibilities. They are not missing deliverables in this family-planning scope.

The selected code scope is built. The remaining items above concern presentation, operating choices and evidence from people or configured live services; they are not hidden unfinished features.
