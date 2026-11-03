# Our House

A cooperative household savings adventure: travel through a pixelated medieval woodland, choose a family crest, and grow a cottage into a castle as you reach shared goals. Solo households work too. **Our House is a working name.**

This repository is a **Claude build handoff and runnable art starter**, not a completed payment application. It contains the user's concept, proposed product rules, implementation plan, acceptance checks, actual reusable art/code, and visual references from the user's Tiny Castle / Crown & Dust projects. PayPal and runtime AI are not integrated yet.

## Start in Claude Code

Open this folder in Claude Code and paste the contents of [CLAUDE-START.md](CLAUDE-START.md). On the Mac, double-click **Continue in Claude.command**. It opens Claude in this project with that prompt, using normal Claude permissions.

Read in this order:

1. [Concept and decisions](docs/CONCEPT.md)
2. [Art direction and reference lock](docs/ART-DIRECTION.md), then open the referenced PNGs
3. [Product rules](docs/PRODUCT-RULES.md)
4. [Build plan and acceptance checks](docs/BUILD-PLAN.md)
5. [PayPal hackathon requirements](docs/HACKATHON.md)

For Claude.ai, extract the source ZIP, attach `CLAUDE-START.md`, the four documents above, `references/images/pixel-battlefield.png`, `color-and-heraldry.png` and the art preview screenshot when present. For the full build, Claude Code or an explicitly authorized GitHub connection to this private repo can access every asset. Do not assume a chat attachment contains the whole repository.

## Run the art starter

Requires Node.js 20 or later. No dependency installation is needed for this preview; Three.js is vendored with its license.

```sh
npm start
# Open http://localhost:3010/art-preview.html
npm run check
```

The original native 3D scene previews a woodland board and four house tiers using the actual 90-color pixel pipeline. Tier buttons are **art previews**, not earned rewards or payment confirmations. The existing self-contained [pixel rendering study](references/pixel-rendering-study.html) is additional rendering reference, with historical Crown & Dust navigation.

## What is included

- Original 90-color palette, orthographic pixel renderer, depth outlines and Bayer dither.
- Actual Uncial Antiqua and Alegreya Sans font files and SIL OFL notices.
- Original Tiny Castle crests/brand images, eight medieval portraits and six GLB miniatures.
- Original scenery/procedural-model and heraldry source as reference, plus asset generation source.
- Approved scene/card/phone screenshots and the user's original knight/parchment concepts.
- A SHA-256 manifest linking copied files to the source commit.
- A sandbox-only `.env.example`; no secrets or real household financial data.

The new financial product uses a board journey, not the older game's RPS combat, army deployment, energy or three-minute matches. Existing projects remain separate. The repo should stay private until the owner chooses to publish it.

## Status

Ready: concept/handoff, reusable assets, art preview and integrity checks. Still to build: household/goal state, crest selection, AI planning, PayPal sandbox order/capture flow, durable idempotent ledger, progression and the working submission demo. Real-world savings custody, arbitrary bill discovery and real-money transfers are not implemented.

The MIT license covers application source; asset and third-party notices are in [NOTICE.md](NOTICE.md) and [assets/README.md](assets/README.md). The pasted hackathon page lists November 12, 2026 at noon Pacific; confirm final official rules before submission.
