# Our Castle — concept and decisions

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

Real savings custody, interest, investments, bank-account balances, arbitrary automatic bill discovery, real-money transfers, punitive house demolition, public financial leaderboards, property gambling, RPS combat, multiplayer AR, a broad open world and a general financial chatbot.

PayPal sandbox is the required demonstration environment. The app tracks goal progress; it must not imply that the internal goal ledger is a regulated savings account or that Checkout proves a family's overall savings balance. Check product support before proposing any real-world family pooling arrangement.
