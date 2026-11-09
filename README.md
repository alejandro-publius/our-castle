# Our Castle

**One family goal, a realm you build together.**

A living pixel woodland turns shared progress into new places to explore. Keep the village, open the Manor, cross the rivers to the Keep, and reach the Royal Citadel, Rosewind Palace and two storybook towers. Nine districts, a campsite that grows with the shared goal, short deed cards, family avatars, roaming guests and changing light sit beside one compact household journal.

![The connected woodland realm and mountain border](docs/screenshots/mountain-border-day.png)

The reviewed source is **public on GitHub main**, including the scene and Treasury recovery fixes in PRs #34–#37 and the release checks in [PR #38](https://github.com/alejandro-publius/our-castle/pull/38). The preserved Mac apps still run the compass/receipt release `4082df5` at http://localhost:3010 and http://localhost:3021, with their existing records. [Release status and remaining video/submission steps](docs/RELEASE-READINESS.md). For an independent code review, use the [source map and evidence guide](docs/JUDGE-HANDOFF.md#6-for-source-reviewers).

## Try it locally

Use **Node.js 22.16+** (verified on Node 26):

```sh
git clone https://github.com/alejandro-publius/our-castle.git
cd our-castle
npm ci
npm run demo
# Open the local URL printed in the terminal.
```

The demo starts a fresh in-memory household on an unused localhost port. It ignores `.env`, configured keys and saved records. Progress survives refresh while the demo runs; closing it ends that session. Payments are simulated and the planner uses built-in rules, with their existing labels. For persistent local records and configured sandbox/AI integrations, use `npm start` and [the runbook](docs/RUNBOOK.md). [Short review route](docs/JUDGE-HANDOFF.md#2-a-short-review-route)

Several people in one family, each with their own passkey? `npm run family -- --port 3200` runs the opt-in shared-family mode with invitations, adult/child permissions and live updates across open pages. Unsaved edits stay in place; an approval is cleared if its goal or sign-in changes. This runner uses simulated payments and its own database. See [shared families](docs/FAMILY-ACCESS.md).

Contributing with Rachel? [Start here](START-HERE-RACHEL.md) for one small task, a clean demo and the branch/PR workflow.

## A connected family journey

1. **House:** name the house, choose a crest and set a shared goal.
2. **Merchant → Plan:** choose **Find an item** beside Goal in Plan, or visit Market Town. Search real products within a budget. **Use as goal** creates a draft; confirm before saving. **Check schedule** tries a weekly amount/date without saving; a suggested later date only fills the form. Claude can propose a weekly schedule that the server independently checks, and the family reviews it before using it.
3. **Contribute:** an adult approves the exact amount. In sandbox mode, the server verifies the completed PayPal capture and credits once. In example mode, contributions are explicitly simulated.
4. **Realm → Treasury:** a milestone opens a bridge, briefly spills coins from a small gold-trimmed courtyard fountain and announces a deed. Earlier buildings remain, while the campsite reflects current goal progress; **Visit campsite** in Plan brings it into view. The Ledger shows the next area, records and a receipt on selection. Its existing read-only steward can check that order.

Searching does not buy an item. This is goal progress, not a bank balance. Reported savings, bills, gifts, simulated contributions and PayPal sandbox receipts retain their sources. Verified utility-bill rewards require a provider connection that is not present.

The **compass beside View** lets you drag between homes at your current close-up scale; switch it off to turn the map again. The **Sound button at the top right** enables quiet retro RPG music and board effects. Every page starts muted; the music loads only when enabled. [Music source and CC0 licence](assets/music/README.md). After contributing, **Review the receipt** opens that contribution in Treasury, with its saved-check status and the single steward note. [Receipt walkthrough and desktop/phone captures](docs/RECEIPT-HANDOFF.md).

The walkthrough captures use isolated test households and simulated contributions:

| An area opens for the family | Treasury keeps the records |
| --- | --- |
| ![Manor deed arriving on another family member's page](docs/screenshots/shared-live-owner-manor.png) | ![Illustrated Treasury milestone, weekly plan and contribution records](docs/screenshots/sponsor-treasury-desktop.png) |

## Decide on a purchase together

In **Plan → Family choices**, shortlist up to three Market Town items, let each adult offer their own comfortable weekly amount, and let family members express a preference. Try an unexpected expense to see which item still fits the date and how much later the others finish. Choosing an item opens a goal draft for explicit review. **Save goal and propose this schedule** proposes the dated weeks it previews, keeping the expense and each adult's share, and **Use this plan** puts them in use. **Find options that fit** searches Market Town within the family's planning limit for its date, with optional must-haves from the catalog's own lists. It suggests only items the catalog confirms, and keeps why one was chosen.

This source-branch feature is awaiting integration into the preserved Mac demos. The capture uses invented tents and fake provider responses. [Walkthrough, worked example and research](docs/FAMILY-CHOICES.md).

![A family compares three purchase options beside the woodland](docs/screenshots/family-choices-desktop-three.png)

## Three sponsor integrations

| Tool | In the game | Implementation and evidence |
| --- | --- | --- |
| **Channel3** | Market Town merchant, up to three results, refresh, cheaper choices and explicit goal draft | Server-side API and budget checks; changed offers expire stale drafts. One real desktop search is separate from fake-provider freshness/journey checks. [Details](docs/CHANNEL3-MERCHANT.md) |
| **AG Grid / AG Studio** | Illustrated Treasury milestone, weekly plan, records and receipts in parchment | Studio 3.1 live data preserves the report; Grid 36.3 keeps selection and filters. The Agent Framework manages the existing steward through a scoped custom runner, with cancellation and cleanup. [Details](docs/TREASURY.md) |
| **APIMatic** | Behind the scenes | Official generated PayPal Server SDK 2.5.0 and eight installed, discovery-verified Codex context skills; real SDK serialization/auth/retry tests with fake transport, plus documented capture-recovery/read fixes. [Details](docs/APIMATIC-CODEX.md) |

PayPal JavaScript SDK v6 handles the browser session; Server SDK Orders v2/Payments v2 handle sandbox operations. PayPal Agent Toolkit enables only scoped read tools. Anthropic Claude (`claude-opus-5-5`) supplies runtime planning/steward answers; it cannot authorize, capture or refund a payment. Postman provides guarded walkthroughs.

## What is verified

- **Hosted release checks:** [the final PR #38 run](https://github.com/alejandro-publius/our-castle/actions/runs/42408146283) passed the source guard and 361 unit tests with one existing skip on each of Node 22.16.0, 24 and 26, plus 19 desktop/phone browser checks with one designed skip. The workflow runs on pull requests and main pushes using isolated data and fake providers; this is separate from the live evidence below. [Commands and limits](docs/VALIDATION.md#release-checks-workflow--november-7-2026)
- **Historical live sandbox:** hosted buyer approval, $15 capture, single credit, replay/mismatch checks, matching PayPal order and refund. [Original report](docs/LIVE-VERIFICATION.md)
- **Historical live AI:** feasible and impossible plans, ledger reading and PayPal transaction listing. [Original report](docs/LIVE-VERIFICATION-AI.md)
- **Current local checks:** family flow, merchant goal confirmation, world unlocks, Treasury and actual Studio framework on Chromium and Linux WebKit, with fake providers/simulated payments. [Exact runs](docs/VALIDATION.md)
- **Fresh public clone:** anonymous clone/install/source guard and ten current-build journey/phone checks passed using the actual isolated `npm run demo` command. [Recording and scope](docs/demos/current-review/sources/public-demo-capture.json)
- **Current in-app sandbox result:** owner-completed $15 contribution, one credit from $60 reported to $75, village/Manor open, and actual same-order `get_order` with server reconciliation `match`. A model compatibility fix passed 10 focused tests. [Evidence and recording limits](docs/IN-APP-SANDBOX-VERIFICATION.md)

No hackathon entry has been submitted. The existing [2:42 review cut](docs/demos/current-review/our-castle-current-review-cut.mp4) has narration, measured captions, editable sources and an explicit unfilmed checkout insert. It predates subsequent visual/interface changes and is not the final submitted video. [Release readiness](docs/RELEASE-READINESS.md) · [Entry copy](docs/SUBMISSION-DRAFT.md) · [Shot list](docs/SUBMISSION-SHOTLIST.md).

## Real PayPal sandbox and AI

Provider credentials belong only in the server-side, ignored `.env`, following [the runbook](docs/RUNBOOK.md#real-paypal-sandbox-and-ai):

- PayPal **sandbox** REST app: `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`.
- Anthropic runtime key: `AI_API_KEY` (`npm run set-ai-key` stores it privately).
- Channel3 merchant: `CHANNEL3_API_KEY`.
- AG Studio: your own `AG_STUDIO_LICENSE_KEY`. No key is bundled; the owner's trial is evaluation-only, not a production licence.

Live PayPal endpoints are unsupported. The default server binds to localhost. Owner records and keys are not distributed. No hosted real-money or authenticated multi-family service is claimed.

## Development

```sh
npm run check        # copied-art hashes, original palette/renderer wiring, JS syntax
npm run test:unit    # isolated databases and provider doubles
npm run test:e2e     # Playwright desktop/phone emulation, own example server
```

Provider tests and `verify:live` are explicit, potentially paid operations; they are not part of ordinary source checks. [Postman guards and commands](docs/RUNBOOK.md#postman) · [Architecture](docs/ARCHITECTURE.md) · [Family-flow review](docs/FAMILY-FLOW-REVIEW.md) · [Sponsor briefs and award scope](docs/AWARD-STRATEGY.md)

## Art and licences

Original Tiny Castle / Crown & Dust assets, the 90-colour palette and pixel renderer are preserved. Hollybrook Open and Nightshoal supplied general inspiration; their art/source is not bundled. The application code is MIT; original artwork, fonts, third-party code and commercial Studio terms retain their separate [notices](NOTICE.md). Public source availability does not grant a general Tiny Castle brand/art licence.

The old “Our House” name remains only in preserved references and the owner's unchanged local folder path.
