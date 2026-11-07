# Selected configuration availability — November 6 PST, 2026

Based on integrated main `f5e80bc`. This review follows Channel3's current public documentation, without using an account key or calling the product API.

## Contract and reproduced failure

The [product-detail guide](https://channel3.ai/docs/guides/product-detail.md) and [variant guide](https://channel3.ai/docs/variants.md) distinguish listing stock from the selected configuration. Search can leave `OptionValue.available` null; detail hydrates it. `variants.selected` is the effective configuration after the provider resolves or relaxes requested options. Each selected label must be matched against its option's values; another size being sold out says nothing about this selection.

Two real-HTTP regressions on the old adapter failed: a listing marked `InStock` still yielded a usable goal draft when the selected size explicitly returned either `available: "OutOfStock"` or `exists: false`. The adapter read only listing stock. Fixtures follow the public schema and are invented; these are not claims about a real retailer.

## Fix

The normalizer now checks only the effective selected option values:

- Explicitly out-of-stock selections are unusable and display **Out of stock**.
- A configuration that no longer exists is unusable, with its stock label left unknown instead of claiming **In stock**.
- Unknown stock, absent variant metadata and unavailable unselected sizes do not create a new restriction.
- An in-stock variant cannot override an unavailable retailer offer, unusable currency or missing price.

The existing draft-freshness mechanism expires older usable references for that same configuration. A direct request using the unavailable reference is also refused. A later explicit check can create a usable draft if the selected configuration becomes available; **Save as our goal** is still required. Search, checking and refusal write no goal, ledger, plan or payment. No interface, endpoint, dependency, schema or payment behavior is added.

## Verification

`node --test test/unit/merchant-freshness.test.mjs test/unit/channel3-merchant.test.mjs test/unit/family-sponsor.test.mjs`: **32 passed, 0 failed**. The two new HTTP cases verify old-draft expiry, rejection of the unusable-reference bypass, unchanged full household state, no automatic lookup and explicit available-stock recovery. A third case covers available/unknown selected values, absent metadata, other unavailable sizes and an unavailable retailer offer.

The browser regression is `channel3-merchant.spec.mjs` → **an unavailable selected size blocks the retailer visit and goal, then recovers only after an explicit check**. It checks closure of the reserved tab, no retailer navigation, the existing disabled goal action, unchanged state and explicit check/save recovery. Its final result is recorded in [VALIDATION.md](VALIDATION.md).

Ignored logs: `test-results/merchant-variants/{before,focused,browser,check}.txt`; public documentation snapshot hashes: `test-results/merchant-variants/public-docs.json`. Browser screenshots remain in the corresponding Playwright artifact folders. No full-suite rerun is required for this isolated normalizer change.

## Evidence boundaries

The [OpenAPI document](https://channel3.ai/docs/openapi/openapi.json) read for this pass has SHA-256 `b563d5579441a72bc9f129ac53b8a8e9292db69aa97078380a60ee0b5f4ad76d`. It specifies `Price.price` and the public `InStock`/`OutOfStock` availability enum; some narrative examples show a different price key or broader status list. This fix keeps the formal schema and the earlier actual-response evidence, rather than guessing additional fields or stock states.

Provider facts are still catalog evidence, not retailer confirmation. Local lookup start order cannot establish retailer update time, and the search-versus-detail default-selection caveat remains. No live product lookup, subscription, paid call, checkout or owner-data change was made. The earlier single real search remains separate evidence. Claude's camera work is outside this change.
