# PayPal Toolkit maintenance

November 5, 2026. This follow-up keeps the existing Merchant, Treasury and interface intact. No provider credentials, owner records or live calls were used.

## Read reliability

The installed Agent Toolkit 1.11.0 OpenAI adapter makes its order/reporting reads through Axios without a timeout. Its public tool-call API exposes no per-call cancellation setting. Applying the installed APIMatic resilience context, the server wrapper now limits its wait to **30 seconds** for each read, including authentication. It makes no automatic retry. Timers are cleared on completion/error.

A timed-out result is not payment proof. The necessary upstream read can still finish later; the wrapper cannot cancel that transport, and does not claim to. A late result cannot change the returned answer, reconciliation, ledger or goal progress. The same-order steward check remains unverified, even if the model claims success. Sandbox validation also requires one of the two exact HTTPS PayPal API origins, rejecting lookalike hosts, credentials in URLs, alternate ports and path/query additions.

## Dependency decision

The npm registry still lists Toolkit **1.11.0** as latest. Its pinned LangChain core 0.3.6 is affected by [GHSA-r399-636x-v7f6](https://github.com/advisories/GHSA-r399-636x-v7f6). The published fix within the same 0.3 line is **0.3.80**. A scoped, exact override applies that patch only below Toolkit 1.11.0. The main PayPal Server SDK remains **2.5.0**. The Toolkit's separate transitive SDK remains **1.1.0**; neither was silently swapped or downgraded.

Audit still reports **12 affected packages (11 high, one moderate)** through other advisories. The LangChain serialization advisory is removed from the current report; this is not an audit-clean claim. Remaining findings involve Zod 3, AI SDK 4/provider-utils/jsondiffpatch, mathjs, LangSmith and uuid. The registry offers no Zod 3 release fixing the reported collection issue, while the Toolkit bundles conversion code depending on Zod 3 internals. Forced major overrides or npm's suggested Toolkit downgrade to 1.3.5 were not applied.

A fresh-process import trace shows the actual OpenAI Toolkit path loading Zod and mathjs, but not LangChain, LangSmith, AI SDK or jsondiffpatch. This narrows the review; it is not a proof that every remaining advisory is unreachable. The patched LangChain adapter was also initialized successfully with only the two read tools.

## Actual checks

- **40 focused cases passed:** Merchant, Treasury, SDK, uncertain outcomes, steward, and the new real-Toolkit contract cases. These use fake transports/example data.
- The real published Toolkit was exercised through its actual CommonJS Axios instance: one fake token exchange, one order read and one bounded transaction-list read; native network access was blocked. No create/capture/refund operation was enabled.
- Stalled/late reads, malformed replies, sandbox URL rejection and timeout settings were checked. A fake-model success claim after a timed-out exact-order read remained unverified, with unchanged ledger rows.
- Clean `npm ci --ignore-scripts --no-audit` installed 276 packages. Five targeted Toolkit/compatibility cases then passed again from that installation. The original 47-file art/palette/renderer/syntax guard passed. Existing browser suites were not repeated for unchanged UI.

Ignored local evidence: `test-results/dependency-review/{audit-before.json,audit-after.json,sponsor-contracts.log,clean-toolkit-verified.log,clean-install.log,import-and-versions.json,source-check.log}`. The owner app still needs the usual dependency install and restart on 3010 after its Mac reconnects; preserve `.env`, data and the separate 3021 rehearsal. The live popup/same-order verification remains pending and needs no new key or renewed payment approval.
