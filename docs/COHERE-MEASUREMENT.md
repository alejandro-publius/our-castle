# Measuring the Cohere kit ordering: plan only

Written November 10, 2026 (Pacific) against `main` at `97c084a`. **Not run.** No Cohere request was made to write this, and this change adds no code. It is a plan for the owner, who decides whether to spend the calls.

So far the only live evidence is one request on November 10 that returned an ordering. That shows the connection works. It says nothing about whether the ordering is any good, and this plan does not change that: it measures one narrow thing, once.

## What the existing path can and cannot show

Read this first, because it limits every sentence that may be written afterwards. It is how [Order with Cohere](KIT-PLANNER.md#ordering-by-a-preference-cohere-optional) works today:

- **It orders complete kits, not single items.** Each kit is sent as its listings' titles and shops, joined in one line.
- **Weights are never sent.** Nor are prices, dates, counts or anything about the family. Cohere sees titles and shop names only.
- **The preference is one of four fixed sentences.** Nothing typed is sent.
- **Only Cohere's first choice comes back to the page.** The kit is labelled **Closest to your preference**, with a quoted match from its titles and a note of how many kits were sent and ordered. The rest of the order is not kept, shown or returned by the server.

So the measurable question is: **is Cohere's first choice the lightest kit?** A full comparison of two orders is not possible without a code change, and no result from this plan may be described as one.

## The fixed five

These are the five complete kits that fit in the repository's own [family-trip example](FAMILY-TRIP-EXAMPLE.md) when the one-off is $90 (planning limit $180). They are reused here instead of inventing new ones: the listings, both shops and every weight are already invented, public and fixed in `scripts/family-trip.mjs`, and the example's own unit test already checks that five of the eight possible kits fit at that figure.

Each kit is one tent, two sleeping bags and one stove; the torches are already at home. Shop one is `sample-shop-one.example`, shop two is `sample-shop-two.example`. No such shop exists.

| Kit | Tent | Sleeping bag (×2) | Stove | Listed total | Listed weight |
| --- | --- | --- | --- | --- | --- |
| 1 | Sample: Dome tent, four-person (one) | Sample: Sleeping bag, synthetic (one) | Sample: Camp stove (one) | $150 | 5.2 kg |
| 2 | Sample: Dome tent, four-person (one) | Sample: Sleeping bag, synthetic (one) | Sample: Compact stove (two) | $155 | 4.9 kg |
| 3 | Sample: Dome tent, four-person (one) | Sample: Sleeping bag, down (two) | Sample: Camp stove (one) | $170 | 4.6 kg |
| 4 | Sample: Dome tent, four-person (one) | Sample: Sleeping bag, down (two) | Sample: Compact stove (two) | $175 | 4.3 kg |
| 5 | Sample: Light tent, four-person (two) | Sample: Sleeping bag, synthetic (one) | Sample: Camp stove (one) | $180 | 4.0 kg |

Listed weights: dome tent 3.0 kg, light tent 1.8 kg; synthetic bag 800 g, down bag 500 g; camp stove 600 g, compact stove 300 g.

**Preference:** **Lighter to carry**, which sends the fixed sentence `camping gear that is lightweight, compact and easy to carry`.

**Lightest-first order of the same five:** kit 5, 4, 3, 2, 1. The lightest is **kit 5**.

No outcome is predicted. Kit 5 has the only "Light" title; kits 2 and 4 have "Compact"; kits 3 and 4 have "down". A text match could reasonably pick any of them, which is what makes this worth one run.

## The gap: these five cannot reach Cohere today

`npm run demo -- --family-trip` is the only way to load that catalogue, and it deliberately starts with no keys: Cohere is off there, and the **Order with Cohere** control is not offered. A server started with the owner's configuration has Cohere on, but takes its listings from Channel3 and cannot load the sample catalogue.

Letting the example use the owner's own Cohere key would be a small change to how the demo starts. It is code that sends data, so it is **not in this change** and needs the owner's decision and its own review. Until then, route B below is the only one that runs.

## Route A: the fixed five (after that separate change)

1. Start the family-trip example with Cohere on. The terminal must say `preference ordering by Cohere (rerank-v5.0-fast) only when an adult asks`.
2. Choose **Try a one-off expense** and type `90`.
3. Choose **Compare complete kits**. Two kits are shown: $150 and $180.
4. Under **Order the kits that fit by**, choose **Lighter to carry** and press **Order with Cohere** once.
5. Fill in the record below.

## Route B: live listings (runs today, not repeatable)

On a server where Cohere is on and Market Town is connected:

1. Use a saved kit list with something still to buy.
2. For each item, choose **Find listings for …**, add listings and enter how many one listing gives. At least one item needs two or three listings, or only one kit exists and there is nothing to order.
3. **Compare complete kits**, then under **Order the kits that fit by** choose **Lighter to carry** and press **Order with Cohere**, once.
4. Fill in the record below, and copy every listing's title, shop and listed weight into it. The live catalogue changes, so that copy is the only thing that makes the run checkable later.

This makes real Channel3 searches and one real Cohere request on the owner's keys. It is one case from one day's catalogue, and must be described that way.

## The record

Decide before pressing the button that this one run is the result. Running again until the answer looks good is not a measurement.

| Field | Value |
| --- | --- |
| Date and time (Pacific) | |
| Source commit | |
| Route (A or B) | |
| Model, from the terminal's Kit comparison line | |
| Preference | Lighter to carry |
| The note under the control, word for word | |
| Kits sent / kits ordered, from that note | |
| Kits that fit, from the comparison | |
| Kit labelled **Closest to your preference**: its listings and shops | |
| Cohere's quoted match | |
| Lightest kit: its listings, shops and listed weight | |
| Same kit? | yes / no |

**The run counts only if all three hold.** Otherwise record it and write "not comparable":

- every listing in the pool reports a weight (the page labels a kit **lower listed weight** only then);
- the number of kits sent equals the number that fit, so the lightest kit was among those sent (at most eight are sent);
- every kit sent was ordered. If the note reads "ordered 3 of the 5", Cohere left some out.

## Comparing

For route A the lightest kit is kit 5, from the table above. For route B it is the kit the page labels **lower listed weight**; check it by adding up the listed weights of the items to buy.

It is a match when **Closest to your preference** and the lightest kit are the same kit. On the page, that is one card carrying both labels.

## If it matches

Paste this, filled in, into the README or the entry. Use the first form for route A and the second for route B.

> On November __, 2026, for five fixed complete kits built from this repository's invented sample catalogue and the fixed preference "Lighter to carry", Cohere's first choice was the kit with the lowest listed weight. Cohere saw only listing titles and shop names. This is one case, not a measure of ranking quality.

> On November __, 2026, with that day's Channel3 listings for one kit list and the fixed preference "Lighter to carry", Cohere's first choice among the __ complete kits that fit was also the kit with the lowest listed weight. Cohere saw only listing titles and shop names. This is one case, not a measure of ranking quality.

## If it does not match

Record it exactly as above and keep the record. Then either leave the README as it is, or paste this:

> On November __, 2026, for __ complete kits and the fixed preference "Lighter to carry", Cohere's first choice was not the kit with the lowest listed weight: it chose a __ kg kit where the lightest was __ kg. Cohere sees listing titles and shop names only, never weights.

Do not run it again to get a match, do not swap the preference afterwards, and do not describe either outcome as good or bad ranking. The existing wording stays true either way: ranking quality has not been evaluated.

## What stays unmeasured

- The order beyond first place.
- The other three preferences.
- Any real family's sense of which kit suits them.
- Speed, cost and behaviour under failure, beyond the existing fake-transport tests.
