# PayPal AI Hackathon — source summary

Sources: the event overview text supplied by the owner on November 3, 2026, and the Devpost challenge page text the owner pasted later the same day ("PayPal AI Hackathon — Build what's next with PayPal and AI", managed by Devpost). No canonical URL was included in either paste. This summary is not a replacement for the official rules.

**Deadline: November 12, 2026 at 12:00 p.m. PST** (both pastes agree; the Devpost page showed "9 days to deadline" on November 3).

## Requirements (Devpost page)

Build or update an application that integrates the PayPal developer platform using the free sandbox, together with an AI tool, model or platform of your choice. The project should:

- meaningfully integrate at least one PayPal technology, API, SDK, product or developer capability ("PayPal integration is central");
- meaningfully incorporate AI into the experience or functionality;
- demonstrate a working prototype or proof of concept;
- be documented well enough for judges to understand and evaluate it;
- comply with the official rules. Existing projects are allowed if meaningful progress happens during the event. Sponsor AI tools are optional.

## Submission

- Text description of features and functionality.
- Functional demo: complete setup and run instructions in the repository, or a hosted demo URL. Mockups, static prototypes or non-functional demos do not qualify.
- Tools: identify the AI model/service used and explain how it is used. (Our House: Anthropic Claude via the Messages API, as the runtime milestone planner with server-side validation. A coding assistant's involvement in building the project is not the runtime AI feature.)
- Public code repository on GitHub, GitLab or Bitbucket with all source, assets and instructions, open source, with a visible license file.
- Demo video under three minutes, on YouTube and publicly visible, showing the project working on its target device, with no third-party trademarks or copyrighted music/material used without permission.

## Judging criteria

Technological implementation (thorough, skillful, non-trivial use of PayPal and AI); design (a complete, coherent product, not just a proof of concept); potential impact (a credible, specific problem and audience, addressed by what is demonstrated); innovation; presentation (end-to-end demo, clear problem/audience/why).

## Current owner decisions

The owner wants private development. Do not publish the repository, change its visibility, deploy, upload a video or submit an entry automatically. Making the repository public, choosing what to license publicly (see NOTICE.md about the original art), recording the video and submitting are later owner decisions.

## Implementation route chosen

- PayPal: Orders v2 (`POST /v2/checkout/orders`, `/capture`, `GET` order), Payments v2 refunds, Webhooks v1 signature verification — all against `api-m.sandbox.paypal.com`, server-side only. Browser: JavaScript SDK v6 from `www.sandbox.paypal.com/web-sdk/v6/core` (v5 is marked deprecated on PayPal's v5→v6 page). PayPal's v6 pages disagree on `clientId` vs client token and on the `createOrder` return shape; the client tries `clientId` first, then a server-issued client token, and resolves `{ orderId }`. This must be confirmed in the first live sandbox run.
- AI: Anthropic `claude-opus-5-5` with structured JSON output, validated by the server before use.

Useful official starting points:

- https://developer.paypal.com/sandbox-testing/overview
- https://developer.paypal.com/docs/api/orders/v2/
- https://developer.paypal.com/docs/api/webhooks/v1/
- https://developer.paypal.com/sdk/js/set-up
- https://developer.paypal.com/v5-v6

No real-money household pooling, savings custody or arbitrary bill-payment API support is asserted here.
