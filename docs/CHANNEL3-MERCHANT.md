# Market Town merchant (Channel3)

The owner asked for "Channel3: the merchant. Find real items and prices for a family goal inside Market Town." A family can search for a real item, see up to three results, and carry one into the Plan form as an unsaved goal draft that they confirm themselves. Searching is discovery only. It never buys anything, credits money, changes progress, opens an area, or reaches checkout.

## Open it

Areas → Market Town (or the Market Town plaque) → **Merchant**, at the foot of the map. The merchant is open whether Market Town is locked or not; browsing never changes access. Type what the family is saving for, add an optional budget, then press Search. Nothing is sent while typing. Escape or × closes the merchant and returns focus to the Merchant button.

**Use as goal** closes the merchant, opens Journal → Plan and fills the Goal name and amount. A short draft note shows the item, its price, merchant, returned availability and when Channel3 checked it. **Save as our goal** is the only step that writes. **Discard draft** restores the saved goal. While a draft is pending, the planner button waits.

## Setup

Put the key in the server's local `.env`. It stays server-side and is never sent to the browser.

```
CHANNEL3_API_KEY=...
```

Restart the server; the start-up line then reads `Merchant: Channel3 product search`. Without a key, the merchant says "Channel3 is not connected on this server yet…", its fields are disabled, and no request is made. Keys come from a free developer account (https://trychannel3.com/sign-up/developer → https://trychannel3.com/dashboard/api). Channel3 documents 1,000 free credits a month, and one search costs one credit. The sponsor's promo code (PAYPAL-HACKATHON-2026) was not used or verified here; no account, purchase or terms acceptance was automated.

## Contract and sources

These were checked on November 4–5, 2026. Endpoints were not guessed from examples.

- Official OpenAPI: https://channel3.ai/docs/openapi/openapi.json (server `https://api.trychannel3.com`; security `x-api-key` header). Relevant schemas: `SearchRequest`, `SearchConfig`, `SearchFilters`, `SearchFilterPrice`, `SearchResponse`, `Product`, `ProductOffer`, `Price`, `ProductImage`, `CurrencyCode`, `OfferAvailabilityStatus`, and error responses 400/401/402/422/500/504.
- Guides: https://channel3.ai/docs/guides/make-a-search.md, `/guides/search.md`, `/guides/price-filters.md`, `/guides/locale.md`, `/guides/response-overview.md`, `/guides/product.md`, `/guides/offer.md`, `/guides/caching.md`, `/faq/rate-limits.md`, `/pricing.md` and `/commissions.md`. https://docs.trychannel3.com redirects to https://channel3.ai/docs/.
- The Devpost sponsor page (https://paypalaihackathon.devpost.com/details/channel3) returned HTTP 403, so the full sponsor conditions remain unverified.

The adapter, `server/merchant/channel3.mjs`, sends `POST /v1/search` with these fields only:

```json
{ "query": "<the family's words>", "limit": 3, "config": { "country": "US", "currency": "USD", "language": "en" }, "filters": { "price": { "max_price": 250 } } }
```

`filters` appears only when a budget is given. The locale lives under `config`, as in the OpenAPI schema; the SDK guide's top-level `currency` example is the SDK's own shape. Channel3's documented defaults apply: new-condition and in-stock offers.

No `x-user-id` is sent, and nothing else leaves the server: no household name, members, ledger, bills or goal. The MCP free tier, image search, URL lookup and pagination are not used.

From each product the adapter picks one offer: the goal currency first, then within budget, then in stock, then the lowest price. It keeps the following and drops anything malformed:
- `id`, `title` and the first brand;
- one image, either `cleaned_url` or `url`, and only from `*.trychannel3.com`, the page's only extra `img-src`;
- the offer's `url` (https only), `domain`, `price.price` and `price.currency`, `availability` and `condition`.

A missing price stays "No price returned". A non-USD price is shown in its own currency and cannot become the USD goal; prices are never converted. The panel carries one line near the links: "Channel3 prices and stock, checked HH:MM; tax and shipping not included. We may earn a commission when you buy through links on this page." The second sentence is the disclosure Channel3's commissions page requires wherever its links appear.

Server bounds:
- query 2–80 characters, and a link is refused rather than sent;
- budget $1–$100,000;
- 8-second timeout, and redirects refused;
- a 2-minute cache, and identical concurrent searches share one request;
- at most 6 provider searches a minute;
- provider errors become short states: key rejected, no credits, rate limited, unavailable, unreadable response, timeout or unreachable.

In the browser, only the newest search may update the list; an older answer is aborted or dropped. Provider text is added only as text.

## The goal boundary

The household has a single active goal, and goal edits already set earlier plans aside. A merchant result is therefore a draft imported into the existing Plan editor. It is never a silent replacement, and `POST /api/merchant/goal` saves it only on the family's click.

- The draft is the server's own copy of a result it showed. A `draftId` is valid for 30 minutes, and the client cannot invent provenance.
- The goal changes through the existing `updateGoal`, with the same validation. Starting progress, ledger, contributions and members stay untouched, and plans are set aside as with any goal edit. The draft note says what will change before saving.
- The save is refused if:
  - the amount is below the item's price;
  - the goal changed since the draft was made;
  - the draft expired;
  - the new amount would open any area from progress already tracked. The refusal offers the smallest safe amount, for example "Set the goal to $240.01". Areas open only through progress.
- Provenance is kept in the additive `goal_items` table (migration 3): product id, title, merchant, link, item price, currency, availability and the time Channel3 checked. It is not search history. The Plan form shows it while the goal keeps that name. Channel3 says offer links are short-lived, so the saved link is labelled as of its checked time.
- Role rules are unchanged: anyone who may edit the goal may confirm a draft. Contributions still need an adult's amount-specific approval, and nothing here touches payment code.

## Evidence

**Fakes** (`test/helpers/fake-channel3.mjs`, documented response shape with invented products). These are not live Channel3 answers.
- Eleven unit cases in `test/unit/channel3-merchant.test.mjs`:
  - the exact request and headers, with no household data;
  - valid, missing-price, non-USD, out-of-range and malformed answers;
  - unsafe links and merchant-hosted images dropped;
  - 401, 402, 422, 429, 500 and 504 responses, timeout and network failure;
  - no key means no request;
  - cache, shared requests and the burst limit;
  - draft expiry;
  - the routes: search changes nothing; a confirmed save writes provenance only, with no ledger, order or area change;
  - the refusals;
  - the additive migration on a version-two household.
- Six browser cases in `test/e2e/channel3-merchant.spec.mjs`, desktop 1440 and touch phone 390. Each runs the real app on its own port with a fresh in-memory example database. They cover:
  - explicit search only;
  - three honest rows with image, price, merchant and availability;
  - the secondary safe link and disclosure;
  - the draft and the area refusal with its smallest-safe-amount fix, then the confirmed save;
  - stale answers dropped;
  - empty, error and link-refused states;
  - Escape and focus return;
  - discard;
  - the not-connected state;
  - no checkout, AI or other writes, no external requests and no horizontal overflow.

**Live: one bounded search, 2026-11-05 07:13 UTC.**
- Setup:
  - the owner-authorized key was loaded alone, in memory, into an isolated in-process app;
  - the app ran on an unused port with a fresh in-memory example database, and PayPal and AI were absent;
  - the transport refused any second call.
- The search: "camping tent", budget $250, through the real browser flow.
- What came back:
  - HTTP 200 and exactly one provider call;
  - three real products: $62.82, $95.99 and $219.99, all USD and in stock;
  - merchants shop.homestyler.com, bestbuy.com and aosom.com;
  - all three images from `cdn.trychannel3.com` rendered, and the links came from `buy.trychannel3.com`.
- The raw keys matched the documented schema (`products`, `next_page_token`; `price.{price,currency,compare_at_price}`).
- The capture is kept untracked at `test-results/channel3-merchant/live/` in the `our-castle-channel3` worktree, because it shows third-party retailer photos.
- Not exercised live: the phone render and the draft/save with a live item. The second (phone) page timed out loading under headless SwiftShader before any further provider call, and no second credit was spent. Those steps are covered by the fake-transport browser cases.

Fixture stills (drawn stand-in image, invented products): [results](screenshots/channel3-merchant-results.png), [draft](screenshots/channel3-merchant-draft.png), [phone](screenshots/channel3-merchant-phone.png).

## Remaining

- US/USD search only, because the goal currency is USD.
- No price refresh. Channel3's free `GET /v1/products/{id}` could recheck a saved item but is not wired.
- Saved offer links may expire.
- The owner's 3010 app shows the merchant only after it is restarted with this code. Its database then gains the empty `goal_items` table.
- The sponsor's conditions are unverified (Devpost returned 403).
- None of this is PayPal, checkout or verified-savings evidence.
