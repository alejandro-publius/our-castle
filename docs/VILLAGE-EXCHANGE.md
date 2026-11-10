# Village Exchange

A neighbor's unused tent can help another family keep its trip. The Exchange lives inside **Plan**, with a shortcut at **Market Town**, and connects received items to the existing complete-kit planner.

Run `npm run demo -- --village-exchange` for a fresh, keyless local example. Alder has a four-person tent on its kit list; Willow has offered to lend one. Accepting the offer leaves the shopping requirement unchanged. **I received the item** makes the tent available, and **Compare what is left to buy** computes a new kit. In the authored sample, the lowest listed total drops from **$150 to $70**. Recorded progress remains $60; no money moves. Returning the item restores the shopping requirement.

The families, offer, shops and prices in that runner are invented. The regular `--family-trip` example stays available. Real local family-mode users can create and join their own private neighborhood through the same domain services.

| Desktop: confirmed neighbor item | Phone: the same handover |
| --- | --- |
| ![An invented neighbor loan confirmed received in the journal](screenshots/village-exchange-desktop-received.png) | ![Phone journal showing the received tent and explicit return action](screenshots/village-exchange-phone-received.png) |

## With two families

1. Each family creates its own passkey household in the family runner. An adult saves the items it needs in **Kit list**.
2. In **Village Exchange**, an adult creates a neighborhood and chooses a shared family alias. The founding family creates a single-use invitation, expiring in 24 hours, and shares it themselves. The server stores only its hash; active invitations can be revoked.
3. The other adult previews the neighborhood and explicitly joins. This grants access to the board, not the other household's private records.
4. The requesting adult selects one saved kit line, a quantity, needed-through date and note, and confirms those fields will be shared.
5. The neighbor offers a loan or gift. A loan must cover the requested date. Offer details are visible only to the offering and receiving households.
6. The receiving adult accepts, then separately confirms physical receipt. Accepted promises reserve the request quantity but do not count as available equipment.
7. Received equipment reduces the remaining quantity used by kit comparison. The family still reviews any changed kit, goal and schedule through the existing approval flow.
8. The recipient confirms a return or stops counting a gift when it no longer covers the kit. Accepted items and received loans must be resolved before either family leaves. A giver can leave after a gift is received; the recipient keeps its availability. The receiving family must resolve received items before removing their kit line or leaving.

Children can read their family's board; adults manage sharing. Household IDs and roles come from the session. The server checks origin and CSRF on writes, neighborhood membership, offer ownership, kit revision, current requirements, dates and reserved quantities. Acceptance and handover are transactional; a repeated handover cannot add stock twice. Live notices contain no other family's records.

## Deliberate scope

This first version coordinates voluntary equipment. It does not charge cards, send money between families, trade debt, escrow funds, independently verify delivery or equipment condition, expose household addresses automatically, or send messages. Receipt is the adult's own report of an offline handover. A loan counts for the goal only while its return date covers the goal date; moving the goal later can make it ineligible. Neighborhoods are capped at 12 families and 24 open requests (200 total); one family belongs to one neighborhood at a time.

The current saved owner apps are separate from the new schema-13 source. This work does not migrate or restart them. Browser evidence uses Chromium's virtual passkeys and an emulated phone, not human playtesting or physical-device evidence.

Implementation: [exchange service](../server/exchange/index.mjs), [shared stock](../server/exchange/stock.mjs), [journal controls](../src/app/village-exchange.js), [authored example](../scripts/village-exchange.mjs), [architecture](ARCHITECTURE.md#village-exchange-lifecycle).
