# Our Castle — concept and decisions

## Latest owner correction: a connected realm

The owner expected bigger buildings to remain visible as **separate connected destinations**, greyed out behind bridges/moats until unlocked. They explicitly rejected continuing to replace one central building on a small plot. This replaces that part of the earlier spatial proposal below. A later owner correction (November 4, 2026) replaced the grey treatment and the open water: the realm is one green forest separated by narrow rivers under the bridges, and locked castles stay colourful (see the woodland section of ART-DIRECTION.md).

The current implementation arranges six districts across a 164×114 world: the starting village, manor gardens, market town, woodland garden, keep and royal citadel. These names, dimensions and arrangement are implementation choices for that direction. The existing financial thresholds, private/sandbox scope and evidence distinctions stay intact. Earlier homes remain, bridges lower as their destinations are earned, and later courts add inhabitants to their own districts. Locked destinations can be inspected without unlocking them; art previews are explicitly labeled.

## User's direction

Adapt the existing pixelated medieval art family to a Monopoly-like board game. A person can save alone or alongside family as one "house" with a crest. Progress unlocks larger houses and castles. The token moves around a map past deer, plants, trees and wilderness. Paid bills, money sent and savings are possible inputs; the user explicitly said the exact financial rules were not decided yet. This is for the PayPal AI Hackathon.

The user asked for a separate repository and for the entire art concept to be carried to Claude. The repository must remain **private for now**. No change to the existing card battler was requested.

## Proposed first version — editable defaults

These are implementation recommendations from the conversation, not additional user commitments:

- Cooperative household progress with a solo option; one shared goal and crest.
- A scenic board route around a growing home, not property trading or a combat arena.
- AI turns household-provided goal/budget/date inputs into an editable milestone plan with clear arithmetic and explanations.
- An adult approves a PayPal sandbox contribution. Server-confirmed capture updates a local test ledger, moves the token and can unlock a house tier.
- Savings milestones expand the home; bill habits can award banners/gardens. Gifts, spending and savings remain separate categories.
- The castle commemorates achieved milestones; current tracked goal progress is shown separately. Refunds reverse credited progress and do not masquerade as retained savings.
- First demo: two clearly labeled demo household members, one $300 goal, $60 of explicitly user-reported/example starting progress, and a $15 sandbox contribution reaching the first $75 milestone. An eight-week plan of $30/week covers the remaining $240. All of these amounts/people are synthetic defaults.

## Main loop

Choose a house/crest → set a shared goal → review an AI plan → approve a sandbox contribution → verify payment on the server → advance along the woodland board → unlock a home/crest milestone → choose the next goal action.

## Keep out of the first build

Real savings custody, interest, investments, bank-account balances, arbitrary automatic bill discovery, real-money transfers, punitive house demolition, public financial leaderboards, property gambling, RPS combat, multiplayer AR and a general financial chatbot. The current realm is a bounded, explorable six-district map; it preserves the twenty-step financial journey.

PayPal sandbox is the required demonstration environment. The app tracks goal progress; it must not imply that the internal goal ledger is a regulated savings account or that Checkout proves a family's overall savings balance. Check product support before proposing any real-world family pooling arrangement.

## Second version — the owner's expansion direction (November 4, 2026)

After watching the first demo, the owner asked for three things:
- a much more expansive and detailed world;
- substantially richer visible rewards as the home levels up;
- real financial conditions, such as a confirmed SDG&E bill payment, to unlock fitting world details.

**Built in this version:**
- **A wider estate:** a 42×30 island (it was 24×18) around the same 20-space route. It has a terraced bluff with a waterfall, a river with a mill and footbridge, a brook under a plank bridge into a reed pond, an orchard, farm plots, a well, a windmill and a hamlet.
- **More detailed homes:** a porched cottage with tiled roof, timber framing and chimney; a manor with a wing, courtyard and kitchen garden; a keep with towers and a gatehouse; and a castle with spired towers, great hall, moat, drawbridge, fountain and gardens.
- **Estate additions between the tiers:** the welcoming porch at 10% of the goal, the village quarter at 40% and the outer ramparts at 80%. They are earned from the same goal ledger as the tiers, kept as keepsakes after a refund, and announced when newly reached.
- **A Rewards view:** it shows each addition's condition, exact progress and evidence source, with labeled art-only previews.

**Proposed, not built:** bill-confirmed rewards. A lantern festival would follow a confirmed electricity bill, and a water garden a confirmed water bill. Both are shown locked with "needs a provider connection".
- SDG&E accepting PayPal does not let this app read a household's SDG&E bill status.
- No bill provider is connected, and nothing in the app can mark a bill as verified.
- The proof requirements and a possible provider path are in [BILL-VERIFICATION-RESEARCH.md](BILL-VERIFICATION-RESEARCH.md).
