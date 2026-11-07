# PayPal developer and sponsor research — November 6, 2026

Reviewed against main `86c8287`, sponsor PR #17 (`5b547bd`) and shared-family PR #19 (`62e230e`). Claude is separately integrating shared families, sponsors and reliable cross-device updates; this pass owns only the PayPal browser loader and its focused checks. No owner database, provider credentials, paid call or active Claude worktree was used.

## New reproduced failure and focused fix

PayPal's [JavaScript releases](https://github.com/paypal/paypal-js/releases) describe two relevant v6 improvements: [recover when the namespace exists but the load event was missed](https://github.com/paypal/paypal-js/commit/89827ba4dbee6c31f44b72f10bf53bae72bf7cec), and increase the per-attempt loading allowance to 60 seconds in 11.3.0. Our custom loader used a 20-second allowance and rejected a usable v6 namespace when its load event was missed.

An offline characterization of the actual main loader first reproduced the rejection with a virtual timer, synthetic DOM and SDK stub: ordinary load mounted one button; missing load event rejected despite a callable `createInstance`. There were zero network/payment calls. The new real-browser regression also failed before correction (`ok: false` instead of `true`). This is a controlled reproduction, not a claim that a real buyer experienced it.

The focused fix accepts a callable v6 namespace at the end of a bounded 60-second wait, retains explicit retry after genuine failure, and rejects a v5-only namespace. It neither creates an order nor retries a payment. Eight targeted Chromium checks passed on desktop and 390 px touch-phone: failed-download retry, stalled download with a v5 namespace, available v6 with missing load event, and a download finishing at 45 seconds. Every case checks zero provider operations and unchanged financial rows. The source/palette/renderer/syntax guard and diff check passed. No dependency or payment service changed.

Ignored evidence: `test-results/sdk-loader-review/{before.log,after.log,check.log}` and browser traces. The separate characterization source/result are in `/workspace/artifacts/our-castle-research-20261106/`. The browser fixtures use a scripted SDK and fake PayPal transport, not a real popup.

## Developer reports checked against official contracts

| Source | What it establishes | Our Castle consequence |
| --- | --- | --- |
| [Server SDK discussion #49](https://github.com/paypal/PayPal-TypeScript-Server-SDK/discussions/49) | A PrestaShop developer asks about optional response properties; a later reply explains the generated models follow the API specification | Keep runtime identity/amount/status validation. Existing raw-response parsing and the SDK transport contracts in PR #17 provide relevant coverage; TypeScript types alone are not payment proof |
| [Agent Toolkit issue #82](https://github.com/paypal/agent-toolkit/issues/82) | A contributor reports that the capture tool itself has no confirmation step and proposes an external provenance example | Our runtime steward deliberately has only read tools; adult approval and capture live in the server payment service. This is an issue author's report, not a PayPal security advisory or proof that all integrations are vulnerable |
| [PayPal webhook integration guide](https://developer.paypal.com/api/rest/webhooks/rest/) | Non-2xx delivery is retried up to 25 times over three days; raw bytes matter for signatures. Simulator mock events do not support verification through the postback endpoint | Current server-side postback verification must stay fail-closed. Existing fakes do not establish cryptographic verification of a simulator event or actual provider delivery. A simulator-only run cannot close the documented live webhook gap |
| [PayPal common errors](https://developer.paypal.com/api/errors/overview/) | An already-captured order should be read for its capture details | The service already handles `ORDER_ALREADY_CAPTURED` by reading the same order. Keep deterministic request IDs and unique credits; another order is not an automatic recovery step |

The legacy PayPal Community REST board timed out during this pass, and targeted searches returned no usable board discussion. This report therefore uses PayPal's public SDK discussion/issue trackers, community engineering articles and official API guidance; it does not claim an exhaustive survey of developer-forum opinion.

## Lessons from PayPal's own enterprise engineering

[PayPal's MCP Gateway article](https://developer.paypal.com/community/blog/PayPal_MCP_Gateway/) describes individual identity, authorization again at tool execution, and recorded outcomes. Apply that lesson to the family integration review: check how revocation during an asynchronous steward/model request is handled before a later tool executes. Permission at initial request admission and cancellation of the browser result are separate properties. No new defect in Claude's unfinished branch is claimed here; this needs a focused integrated-code review after handoff.

[PayPal's governed-skills article](https://developer.paypal.com/community/blog/agent_skills_at_enterprise_scale/) emphasizes owned, versioned packages, validation and review for updates. Our pinned APIMatic skill provenance and exact SDK versions support that approach. Keep actual skill use, API guidance and automated findings distinguishable; installing skills alone does not establish that they found every reliability issue.

## Sponsor fit and useful remaining work

| Sponsor brief | Actual use / evidence | Next useful step |
| --- | --- | --- |
| [AG Grid / Studio](https://paypalaihackathon.devpost.com/details/aggrid) | The brief asks for custom polish and framework use, including a custom harness option. Our typed milestone widget, original artwork, expression and custom steward runner are actual Studio use; PR #17 adds 3.1 transactions and weekly receipt links | Review the combined authenticated/live-update journey and preserve record selection. Native drill-through and user dashboard-building controls are not currently claimed |
| [APIMatic](https://paypalaihackathon.devpost.com/details/apimatic) | Eight installed/discovery-verified SDK context skills, documented uncertain-capture recovery, and PR #17's six actual-SDK transport cases | Keep the specific skills → code → test mapping in the prepared submission answer. Webhook signature guidance comes separately from PayPal. Form completion is still pending |
| [Channel3](https://paypalaihackathon.devpost.com/details/channel3) | A real API call must be meaningful to the experience. The historical live search meets that implementation pattern; explicit goal drafting/confirmation is covered with fakes. Refresh/similar endpoints have not been exercised live | Review household/role binding on new routes during integration. Keep catalog-read time separate from retailer stock confirmation; no extra paid call was made for this research |

Priorities after the current integration: review and integrate the isolated loader fix; verify authorization at actual tool execution; then decide whether an authorized public HTTPS webhook setup is useful. Deployment/provider testing is a separate task, not part of this pass. Additional dashboard panels or a new sponsor dependency are not required by these findings. No prize result or blanket qualification is asserted.
