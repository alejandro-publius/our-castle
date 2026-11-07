# Merchant drafts after a catalog change

Independent review of PR #20 at `1de17ba61c7ced1be9522fd992c58063e7242112`, November 6, 2026 (Pacific).
This branch is a proposed integration fix; it has not been activated on the owner's apps.

## Reproduced problem

1. Search returns a $189.50 tent and creates a usable goal draft.
2. An explicit refresh returns $249 or out-of-stock for the same offer.
3. The older draft still saves a $189.50 goal with HTTP 200. Repeating the original search returns its old cached price and availability.

The real HTTP regression failed before the fix (`200` instead of `410`). A second regression showed the old draft and cached in-stock result surviving an out-of-stock refresh. All catalog responses were invented fixtures.

## Resulting behavior

The server tracks bounded catalog observations for a product, retailer, condition and selected variant. A contradictory newer read expires older references for that offer and removes cached lists containing them. This applies to search, refresh and cheaper-option results. A catalog 404 also expires the old reference. Transport failures and malformed responses supply no new offer facts and leave the prior result available until its normal expiry.

An older request that finishes after a contradictory newer lookup cannot mint another usable draft or repopulate the cache. Requests are ordered by when they started; this is local response ordering, not a claim about the retailer's update time. Equal offer facts remain usable, including when only a tracking link, title or photo changes. Other retailers, conditions and variants keep their own references.

The existing `merchant_draft_expired` response returns the Plan form to its existing **Search again** recovery. Edited fields remain visible. Searching again and saving the reviewed result each require an explicit action. Expiring a reference performs no provider call or database write. Existing saved goals and their financial records change only through the ordinary confirmed goal-save route.

The 30-minute draft lifetime is an upper bound, not a price reservation. This follows the staff guidance already recorded in [CHANNEL3-MERCHANT.md](CHANNEL3-MERCHANT.md#staff-availability-guidance-applied--november-6): catalog reads and retailer price/stock are separate evidence. No live Channel3 lookup was made for this review.

## Verification

- `node --test --test-reporter=tap test/unit/merchant-freshness.test.mjs test/unit/channel3-merchant.test.mjs`: 28 passed, including nine new freshness/race cases.
- The new real HTTP case checks rejection before any goal or financial change, then successful saving of the explicitly reviewed fresh price.
- Deterministic promise gates cover late search/refresh responses and coalesced requests; no timing sleeps or provider retries.
- `npm run check`: copied artwork, palette, renderer wiring and JavaScript syntax passed.
- `npx playwright test test/e2e/channel3-merchant.spec.mjs --grep 'a newer catalog price' --reporter=line`: 2 passed (desktop and 390px phone). The open Plan draft was refused after a second request changed the catalog price; edited fields survived, no deed opened, no goal/financial record changed, and explicit search/review/save recovered at $249. No horizontal overflow or page errors were recorded.

Ignored evidence is under `test-results/merchant-review/` (`before.log`, `focused.log`, `browser.log`). The browser test uses invented products and a drawn fixture thumbnail, and saves `catalog-change-review.png` in its Playwright output directory.

## Integration

Apply after reviewing PR #20's finished shared-family work. The implementation change is confined to `server/merchant/channel3.mjs`; this pass does not edit Claude's active source tree, family-stream code, schema, payment service or original scene. The existing household checks still decide which families may use a shown reference. This change expires obsolete public-offer references; it grants no new access.
