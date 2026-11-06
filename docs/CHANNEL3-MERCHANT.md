# Market Town merchant (Channel3)

The owner asked for "Channel3: the merchant. Find real items and prices for a family goal inside Market Town." A family can search for a real item, see up to three results, and carry one into the Plan form as an unsaved goal draft that they confirm themselves. Searching is discovery only. It never buys anything, credits money, changes progress, opens an area, or reaches checkout.

## Open it

Areas → Market Town (or the Market Town plaque) → **Merchant**, at the foot of the map. The merchant is open whether Market Town is locked or not; browsing never changes access. Type what the family is saving for, add an optional budget, then press Search. Nothing is sent while typing. Escape or × closes the merchant and returns focus to the Merchant button.

**Use as goal** closes the merchant, opens Journal → Plan and fills the Goal name and amount. A short draft note shows the item, its price, merchant, returned availability and when Channel3 checked it. **Save as our goal** is the only step that writes. **Discard draft** restores the saved goal. While a draft is pending, the planner button waits.

If another tab changes the goal, the draft stays available with **Review latest goal**. This loads the current starting amount, date and weekly budget while keeping the chosen item and its edited name/target; saving still needs a separate click. An expired result instead offers **Search again**, with the previous query and budget filled in. Opening that recovery step makes no provider request.

## Setup

Put the key in the server's local `.env`. It stays server-side and is never sent to the browser.

```
CHANNEL3_API_KEY=...
```

Restart the server; the start-up line then reads `Merchant: Channel3 product search`. Without a key, the family sees only "The merchant isn't open yet: product search is not connected.", its fields are disabled, and no request is made. These setup steps are for whoever runs the server and are not shown in the game. Keys come from a free developer account (https://trychannel3.com/sign-up/developer → https://trychannel3.com/dashboard/api). Channel3 documents 1,000 free credits a month, and one search costs one credit. The sponsor's promo code (PAYPAL-HACKATHON-2026) was not used or verified here; no account, purchase or terms acceptance was automated.

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
- at most 6 provider operations a minute (search, refresh and similar share the limit);
- provider errors become short states: key rejected, no credits, rate limited, unavailable, unreadable response, timeout or unreachable.

In the browser, only the newest search may update the list; an older answer is aborted or dropped, including when the replacement query is invalid. Starting another search clears the old selectable results. The results summary retains the budget used for that search; an over-budget offer still carries its own warning. Provider text is added only as text.

## The goal boundary

The household has a single active goal, and goal edits already set earlier plans aside. A merchant result is therefore a draft imported into the existing Plan editor. It is never a silent replacement, and `POST /api/merchant/goal` saves it only on the family's click.

- The draft is the server's own copy of a result it showed. A `draftId` is valid for 30 minutes, and the client cannot invent provenance.
- Searching and "Use as goal" change nothing on the server. On "Save as our goal" the goal changes through the existing `updateGoal`, exactly as the Plan editor would save the same values: same validation, plans set aside, and milestones recorded for progress already tracked against the new amount.
  - So a $189.50 tent with $60 already reported becomes a $189.50 goal, and the Manor (25%) opens with its usual deed. The Plan editor would do the same for that edit. A unit test checks this against the ordinary goal route.
  - No money is credited, captured or paid out; ledger entries, payment orders and members stay as they were. The draft note says what will change before saving.
- The actual returned price is the default amount. A family may deliberately choose more (tax, shipping, a broader goal) but never less.
- The save is refused if:
  - the amount is below the item's price;
  - the price isn't in the goal currency;
  - the goal changed since the draft was made;
  - the draft expired;
  - the ordinary goal validation fails.
- A refused save leaves the goal, item and records unchanged.
- Goal edits are checked against a revision of the fields being replaced, including the separately stored starting-progress report. The browser binds it to the Plan fields actually shown, even if another tab edited that same goal before the product search began. Search responses also supply request-specific goal context, independent of cached product results. Missing/stale context is refused; contributions alone do not invalidate a draft. This is optimistic concurrency, not household authentication.
- Correction (November 5): an earlier version refused any amount that would open an area from already-tracked progress and offered an inflated minimum ($240.01 for the $189.50 tent). That merchant-only rule was a misreading of "browsing must not unlock anything" and has been removed.
- Provenance is kept in the additive `goal_items` table (migration 3): product id, title, merchant, link, item price, currency, availability and the time Channel3 checked. It is not search history. The Plan form shows it while the goal keeps that name. Saved links are historical provenance only. The Plan form offers **Check item** rather than navigating to the stored link. Migration 5 adds selected variant labels and condition; older items retain an empty selection and require fresh review.
- Role rules are unchanged: anyone who may edit the goal may confirm a draft. Contributions still need an adult's amount-specific approval, and nothing here touches payment code.

## Evidence

**Initial implementation, before the November 6 extension.** Fakes (`test/helpers/fake-channel3.mjs`, documented response shape with invented products) are not live Channel3 answers. Current extension checks are recorded in [VALIDATION.md](VALIDATION.md).
- Fifteen unit cases in `test/unit/channel3-merchant.test.mjs`:
  - the exact request and headers, with no household data;
  - valid, missing-price, non-USD, out-of-range and malformed answers;
  - unsafe links and merchant-hosted images dropped;
  - 401, 402, 422, 429, 500 and 504 responses, timeout and network failure;
  - no key means no request;
  - cache, shared requests and the burst limit;
  - draft expiry;
  - the routes: search and draft change nothing; explicit confirmation saves provenance through ordinary goal-edit rules, without a new ledger entry or order; existing progress can qualify milestones against the confirmed amount;
  - the refusals;
  - same-goal edits, changed starting progress, edits during a delayed search, per-request context on cached answers, and explicit review without another provider search;
  - missing review context rejected, while a contribution alone preserves draft validity;
  - the additive migration on a version-two household.
- Ten browser cases in `test/e2e/channel3-merchant.spec.mjs`, desktop 1440 and touch phone 390. Each runs the real app on its own port with a fresh in-memory example database. They cover:
  - explicit search only;
  - three honest rows with image, price, merchant and availability;
  - the secondary safe link and disclosure;
  - the draft, then the confirmed save at the actual price with the ordinary Manor deed, then reload persistence;
  - stale answers dropped;
  - empty, error and link-refused states;
  - Escape and focus return;
  - discard;
  - stale Plan fields from another tab's goal edit, preserved product draft, explicit review and save;
  - expired prices, prefilled search recovery and no automatic provider retry;
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
- The owner's 3010 app was updated and restarted November 5; the additive `goal_items` table is empty and all prior application records are preserved.
- Claude's direct Devpost fetch returned 403. Codex subsequently read the public [brief](https://paypalaihackathon.devpost.com/details/channel3): meaningful API/MCP use is required, and one real search is recorded above. The advertised 20,000-search promotion was not applied or tested.
- None of this is PayPal, checkout or verified-savings evidence.

## Freshness and cheaper alternatives — November 6

The owner's pasted Channel3 staff messages (George, October 15 and November 1) explicitly say supported checkout will not be available for this hackathon. Discovery and an external retailer visit are kept separate from Our Castle's adult-approved sandbox contribution. A contribution never represents a retailer purchase or fulfillment.

Contracts for this extension were read from the [official Channel3 skills repository](https://github.com/channel3-ai/skills/tree/db55b30bb42e0f6306d47a9857bf1cd6482ecb48), `SKILL.md` and `references/api-reference.md`, at revision `db55b30bb42e0f6306d47a9857bf1cd6482ecb48`. This is official documentation evidence, not a new live API check.

- **Check item / Details → Check price & stock:** explicit `POST /api/merchant/refresh` accepts only the active goal's saved item or a server-issued result reference. The server calls `GET /v1/products/{id}` with US/USD locale, the same `website_ids` retailer and `option_<name>` selected labels. A missing retailer, relaxed variant, non-USD price or unavailable stock cannot silently become a replacement goal. The returned price is a new draft; goal amount, ledger and payments stay unchanged until the family confirms **Save as our goal**.
- **Cheaper options:** explicit `POST /api/merchant/alternatives` calls `POST /v1/similar` with the server's product ID and a ceiling equal to the lower of the entered budget and one cent below the reference price. Local checks also require a different product, in-stock USD offer within that ceiling. At most three results use the same compact list. No match is reported honestly, with no automatic paid fallback search.
- **Retailer visit:** Details → Visit reserves a user-initiated tab and refreshes the product before navigating to the newly returned offer URL. If price, stock or selected variant changed, the empty tab closes and the family reviews the changed result first. No old saved URL is used. Browser popup blocking gives a clear retry instruction. No purchase is made by the app.
- Refresh has no price cache; identical in-flight lookups coalesce. Search keeps its existing two-minute cache. All calls share the bounded rate limit and eight-second timeout; 404, timeout and other errors never loop. Reopening the dialog clears old results. Closing it or starting another action invalidates late answers.
- Option labels and condition are additive provenance, not private account data. The same goal-revision guard still protects saving after another tab edits the goal.

Tests use only invented products and an injected Channel3 transport. The earlier November 5 live search remains the live evidence; product refresh and similar endpoints have **not** been called with the owner's key in this pass. Automatic price subscriptions and checkout services are not added.
