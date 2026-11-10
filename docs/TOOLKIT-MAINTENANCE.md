# PayPal Toolkit maintenance

Originally November 5, 2026; dependency inventory reviewed again November 9 on source `9989ee9`. No provider credentials, owner records or live application calls were used.

## Read reliability

The installed Agent Toolkit 1.11.0 OpenAI adapter makes its order/reporting reads through Axios without a timeout. Its public tool-call API exposes no per-call cancellation setting. Applying the installed APIMatic resilience context, the server wrapper now limits its wait to **30 seconds** for each read, including authentication. It makes no automatic retry. Timers are cleared on completion/error.

A timed-out result is not payment proof. The necessary upstream read can still finish later; the wrapper cannot cancel that transport, and does not claim to. A late result cannot change the returned answer, reconciliation, ledger or goal progress. The same-order steward check remains unverified, even if the model claims success. Sandbox validation also requires one of the two exact HTTPS PayPal API origins, rejecting lookalike hosts, credentials in URLs, alternate ports and path/query additions.

## Dependency decision

The npm registry still lists Toolkit **1.11.0** as latest. Its pinned LangChain core 0.3.6 is affected by [GHSA-r399-636x-v7f6](https://github.com/advisories/GHSA-r399-636x-v7f6). The published fix within the same 0.3 line is **0.3.80**. A scoped, exact override applies that patch only below Toolkit 1.11.0. The main PayPal Server SDK remains **2.5.0**. The Toolkit's separate transitive SDK remains **1.1.0**; neither was silently swapped or downgraded.

Audit still reports **12 affected packages (11 high, one moderate)** through other advisories. The LangChain serialization advisory is removed from the current report; this is not an audit-clean claim. Remaining findings involve Zod 3, AI SDK 4/provider-utils/jsondiffpatch, mathjs, LangSmith and uuid. The registry offers no Zod 3 release fixing the reported collection issue, while the Toolkit bundles conversion code depending on Zod 3 internals. Forced major overrides or npm's suggested Toolkit downgrade to 1.3.5 were not applied.

A fresh-process import trace shows the actual OpenAI Toolkit path loading Zod and mathjs, but not LangChain, LangSmith, AI SDK or jsondiffpatch. This narrows the review; it is not a proof that every remaining advisory is unreachable. The patched LangChain adapter was also initialized successfully with only the two read tools.

## November 9 dependency review

A fresh lockfile audit still reports **12 affected packages: 11 high and one moderate**. The published registry still lists Toolkit 1.11.0. This bounded review found no applicable same-major repair for the dependencies loaded by the app, so package pins and the scoped LangChain override remain unchanged.

| Dependency | Advisory and available fix | Application-path finding |
| --- | --- | --- |
| Zod 3.25.76 | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5); fix in 4.6.6 | Toolkit loads Zod 3. The wrapper supplies bounded scalar read arguments, not unbounded collections. Version 3.25.76 remains the latest v3; forcing v4 would change Toolkit conversion internals. |
| mathjs 14.9.1 | [GHSA-29qv-4j9f-fjw5](https://github.com/advisories/GHSA-29qv-4j9f-fjw5), [GHSA-jvff-x2qm-6286](https://github.com/advisories/GHSA-jvff-x2qm-6286); fix in 15.2.0 | Loaded by Toolkit, whose published OpenAI entry uses `round` in order-creation calculations. No expression-evaluation path was found there. Our wrapper allows only `get_order` and `list_transactions`. Latest v14 remains 14.9.1. |
| LangSmith 0.3.87 | [GHSA-v34v-rq6j-cj6p](https://github.com/advisories/GHSA-v34v-rq6j-cj6p), [GHSA-fw9q-39r9-c252](https://github.com/advisories/GHSA-fw9q-39r9-c252), [GHSA-rr7j-v2q5-chgv](https://github.com/advisories/GHSA-rr7j-v2q5-chgv), [GHSA-3644-q5cj-c5c7](https://github.com/advisories/GHSA-3644-q5cj-c5c7) | Transitive alternative Toolkit integration; the app's `/openai` entry does not import it. |
| uuid 10.0.0 | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq); fix in 11.1.1 | Transitive alternative integration; not imported by the app's OpenAI Toolkit entry. |
| jsondiffpatch 0.6.0 | [GHSA-33vc-wfww-vjfv](https://github.com/advisories/GHSA-33vc-wfww-vjfv), [GHSA-j4fx-xxwh-2485](https://github.com/advisories/GHSA-j4fx-xxwh-2485); fix in 0.7.6 | Transitive alternative integration; not imported by the app's OpenAI Toolkit entry. |
| AI SDK 4.3.19 / provider-utils 2.2.8 | [GHSA-rwvc-j5jr-mgvh](https://github.com/advisories/GHSA-rwvc-j5jr-mgvh), [GHSA-866g-f22w-33x8](https://github.com/advisories/GHSA-866g-f22w-33x8); fixes in 5.0.52 / 3.0.28 | Toolkit's separate AI SDK adapter, not the OpenAI entry used by this app. |

Neither the inspected Toolkit OpenAI entry nor its locked declared dependency paths reference LangSmith, uuid 10 or jsondiffpatch; these reside under Toolkit's other integrations. The review followed both PayPal SDK versions and the entry's declared external dependencies. It does not rule out dynamic or undeclared imports.

These are static reachability findings, not exploit testing or proof of absence of exposure. The audit remains nonzero. Upstream fixes or an expanded tool/import allow-list require a new review; forced major overrides or a Toolkit downgrade would not be a justified repair here.

The review inspected `server/steward/paypal-tools.mjs`, the exact published Toolkit 1.11.0 source and current public registry/advisory metadata. One `npm audit --package-lock-only` used empty user/global npm configuration and a minimal environment; no packages were installed or runtime imports executed. Ignored evidence: `test-results/quality-followup-20261109/dependencies/`. Audit JSON SHA-256: `74fd2195c625fc3aeaf2339748878707e8559ccccccdf3a7c0e4842aa76ffcd3`.

## Original November 5 checks

- **40 focused cases passed:** Merchant, Treasury, SDK, uncertain outcomes, steward, and the new real-Toolkit contract cases. These use fake transports/example data.
- The real published Toolkit was exercised through its actual CommonJS Axios instance: one fake token exchange, one order read and one bounded transaction-list read; native network access was blocked. No create/capture/refund operation was enabled.
- Stalled/late reads, malformed replies, sandbox URL rejection and timeout settings were checked. A fake-model success claim after a timed-out exact-order read remained unverified, with unchanged ledger rows.
- Clean `npm ci --ignore-scripts --no-audit` installed 276 packages. Five targeted Toolkit/compatibility cases then passed again from that installation. The original 47-file art/palette/renderer/syntax guard passed. Existing browser suites were not repeated for unchanged UI.

Ignored local evidence: `test-results/dependency-review/{audit-before.json,audit-after.json,sponsor-contracts.log,clean-toolkit-verified.log,clean-install.log,import-and-versions.json,source-check.log}`. Those paths describe the original maintenance pass. [Release readiness](RELEASE-READINESS.md) records the later saved-runtime activation and historical sandbox verification; no saved runtime was changed during this November 9 review.
