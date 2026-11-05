# Architecture

A small Node server (built-in `node:http` and `node:sqlite`) serves a framework-free browser app. Runtime dependencies are the official Anthropic SDK, PayPal's Server SDK and Agent Toolkit, and AG Grid Community for the ledger. The board renders through the original pixel pipeline; the server owns every financial fact.

```
browser                                   server (127.0.0.1)                        providers
───────                                   ──────────────────                        ─────────
index.html + app.css                      server/app.mjs  routes, Host/Origin
src/app/main.js   panels, approval  ──►   checks, CSP, static allowlist
src/app/bus.js    event bus               server/view.mjs  state view model
src/app/ledger-grid.js  AG Grid ledger    server/household.mjs  ledger, tiers
src/world/board-scene.js  3D board        server/planner/*  basis, validation  ──► Anthropic Messages API
  └ src/graphics/pixel-renderer.js        server/steward/*  read-only Q&A    ──► Anthropic Messages API (tools)
src/app/paypal-checkout.js  SDK v6  ──►   server/payments/*                         └► PayPal Agent Toolkit (get_order,
src/core/rules.js  shared pure rules        paypal-sdk-client  Server SDK   ──► PayPal sandbox      list_transactions)
                                            contributions  verify, credit       (Orders v2, Payments v2,
                                          SQLite file per payment mode             Webhooks v1)
```

`src/core/rules.js` is shared by both sides and has no DOM, Three.js or Node dependency, so tiers, board position, milestone cents and money parsing are tested directly in Node.

## Data model (SQLite)

| Table | Purpose |
| --- | --- |
| `households`, `members` | One local example household; solo or family example personas (adult/child). Not authentication. |
| `goals` | One active goal: target cents, currency, target date, chosen weekly amount. |
| `ledger_entries` | Goal-progress ledger. `kind` + `effect` are enforced by a CHECK constraint: starting progress and contributions +1, refunds −1, bills and gifts 0. `source_ref` is unique (one row per capture or refund). |
| `payment_orders` | Server-created orders with the expected household, goal, approver, amount and currency, plus a unique client request id. |
| `payment_captures`, `payment_refunds` | Provider ids (primary keys), status, whether credited, refunded cents. |
| `webhook_events` | Processed webhook event ids (deduplication). |
| `plans` | Proposed/accepted/superseded plans with their inputs, the arithmetic basis and the validated plan JSON. |
| `achievements` | Tier keepsakes (`tier:1..3`) and habit gardens (`garden:1..4`), unique per goal. |

Example mode and sandbox mode use different database files (`data/our-castle-example.sqlite`, `data/our-castle-sandbox.sqlite`), so simulated entries can never mix with PayPal-confirmed ones.

Current tracked progress = Σ effect × amount over the goal's ledger rows. Board position = ⌊progress × 20 ÷ target⌋, clamped to 0–20. Tiers are reached at 25%, 60% and 100% (milestone cents rounded up). The built home shows the highest tier ever reached (a keepsake); the travelers and amounts always show current progress.

## Payment states

```
            create (adult + explicit approval, amount ≤ remaining)
  ┌────────► created ──── buyer closes PayPal ───► approval_canceled  (no credit)
  │            │
  │            │ onApprove → server capture (PayPal-Request-Id = capture-<id>)
  │            ▼
  │   capture status COMPLETED + amount/currency/custom_id match ──► completed  (credit once, award tiers)
  │   capture status PENDING ─────────────────────────────────────► pending    (no credit until verified
  │                                                                  webhook or "Check with PayPal")
  │   DECLINED / INSTRUMENT_DECLINED ─────────────────────────────► declined   (no credit)
  │   mismatch (amount, currency, custom_id, order id) ───────────► rejected   (no credit)
  │   provider error ─────────────────────────────────────────────► failed     (no credit)
  │
  └ refund (adult approval → PayPal refund, or verified PAYMENT.CAPTURE.REFUNDED) ─► refunded /
    partially_refunded (subtract exactly the refunded cents once)
```

Crediting happens in one SQLite transaction: insert/upgrade the capture row, insert the unique ledger row, mark the order completed, award tiers. A second capture call for the same order returns `already_completed` without calling PayPal; concurrent calls share one in-flight promise; `ORDER_ALREADY_CAPTURED` reconciles through `GET /v2/checkout/orders/{id}`.

Webhooks are processed only when `PAYPAL_WEBHOOK_ID` is set and PayPal's `verify-webhook-signature` returns `SUCCESS`. Capture events are matched through the server's own order id mapping; refund events through the refund's `up` link to the capture.

## PayPal adapters

`createContributionService` talks to PayPal through one small interface (`createOrder`, `captureOrder`, `getOrder`, `refundCapture`, `verifyWebhookSignature`, `generateClientToken`). At runtime it is `server/payments/paypal-sdk-client.mjs`, built on PayPal's official Server SDK (`OrdersController`, `PaymentsController`, fixed to `Environment.Sandbox`). The adapter passes `paypalRequestId` and `prefer: return=representation`, and hands the service PayPal's raw REST JSON from the SDK response body. It maps the SDK's `ApiError` to PayPal issue names (for example `ORDER_ALREADY_CAPTURED` and `INSTRUMENT_DECLINED`). Webhook signature verification and browser client tokens are not in the Server SDK, so those two calls use `server/payments/paypal-client.mjs`, a minimal REST client with the same sandbox-only base URL. The payment test suite runs every scenario against both adapters.

## AI planner

1. The server computes a deterministic **basis** from the household's inputs: remaining cents, the weekly dates before the target date, the maximum reachable amount, planned total, shortfall, required weekly amount, a feasible alternative date and milestone targets.
2. With an `AI_API_KEY`, `server/planner/anthropic-provider.mjs` calls `claude-opus-5-5` through the official SDK with structured output (`output_config.format` JSON schema), `effort: medium`, and server-side refusal fallback (`fallbacks: "default"`). The prompt contains only the household's inputs, the basis and the list of dollar figures the prose may cite.
3. `server/planner/validate.mjs` checks the response: shape, exactly one entry per date, whole nonnegative cents within the chosen weekly amount, totals equal to the planned amount, truthful feasibility and shortfall claims, and no dollar figure that is not derived from the inputs. Invalid output is never stored; the household sees the reasons and can choose the labeled rules-based plan.
4. Household edits are re-validated and stored as a new "household-edited" plan with server-written arithmetic.
5. Without a key, the same basis produces a deterministic rules plan, labeled "Example plan (built-in rules, no AI)". It passes the same validator.

The planner proposes only. Each contribution still needs an adult's explicit approval in PayPal.

## House steward (AI + PayPal Agent Toolkit, read-only)

`server/steward/index.mjs` runs a short tool loop with Claude (`effort: low`, `fallbacks: "default"`, at most six turns, assistant turns appended unchanged). The tools it can offer:

| Tool | Source | Limits |
| --- | --- | --- |
| `read_household_ledger` | Our Castle database | Goal, progress, milestones, contributions with PayPal ids and statuses; bills and gifts marked "not savings" |
| `get_order` | PayPal Agent Toolkit | Only offered in sandbox mode; `order_id` is a JSON-schema enum of this household's PayPal order ids, re-checked by the server |
| `list_transactions` | PayPal Agent Toolkit | Only offered in sandbox mode; the server turns `days` (clamped 1–31) and a status into the toolkit's date range |

`server/steward/paypal-tools.mjs` constructs `PayPalAgentToolkit` with only `orders.get` and `transactions.list` enabled and `context.sandbox: true` (the toolkit defaults to production). It refuses to start if any other tool is enabled or if the base URL is not a sandbox host. No create, capture (`pay_order`), refund, invoice or subscription tool is ever offered. The model's arguments are never passed straight to the toolkit; the server rebuilds them.

The server records what the steward actually checked. For each `get_order` it computes a deterministic reconciliation between PayPal's order and the ledger: match, needs a "Check with PayPal" refresh, differs, or unavailable. It also flags any dollar figure in the answer that does not appear in the data the steward was shown. The steward never changes the ledger; a "Check with PayPal" button runs the normal verified capture path.

## Browser

- `main.js` renders server state into four keyboard-accessible journal tabs (House, Plan, Contribute, Ledger), the quest card, the district buttons and the board status, and talks to the board only through `scene.update()` and the event bus.
- `ledger-grid.js` lazily loads AG Grid Community (served by exact path from `node_modules`), themes it with the parchment tokens through the Theming API, and falls back to a plain HTML table if it cannot load. Household-typed labels are rendered as DOM text, not HTML.
- `board-scene.js` extends the original art-preview vocabulary (MiniBuilder instancing, layered trees, antlered deer, towers) with the household travelers (two figures for family, one for solo), milestone banners in crest colors and habit gardens. It also handles camera focus on a district, zoom, turn, pan and reset. Rendering is on demand: frames run only during walks and tier rises, and reduced-motion users get instant updates.
- The connected realm has three parts:
  - `src/core/realm.js` defines its geography: seven districts on a 228x132 map centred at (32, 0), seven drawbridges and the twenty-step route across them. It also derives which districts and bridges are open from earned achievements, so access is a presentation of server state, never a payment decision.
  - `src/world/realm-models.js` draws the woodland: one ground heightfield with the river channels of `REALM_RIVERS` (`src/core/realm.js`) cut over a shallow water bed, an instanced forest with flat Lambert paint that is built once and kept across rebuilds, the district clearings and the bridges. Locked districts keep their colours; their bridge leaves are raised and a gate closes the crossing.
  - `src/world/estate-models.js` holds the earlier home and estate architecture. `src/world/princess-palace.js` adds the original Rosewind model; `REALM_BOUNDS` aligns ground, forest, rivers, rain, clouds and camera framing.
- `src/core/journey.js` derives the family's one next step (and the "if the server confirms" projection in Contribute) from the saved state and the shared milestone rules. It is shared, dependency-free and never writes; the browser only switches tab and moves focus.
- `src/core/rewards.js` builds shared reward data for progression and deeds (condition, progress and evidence source for each addition) and is shared by the server and the browser. `src/core/court.js` and `src/world/court.js` define and draw the wandering royal court.
- The board lives between events: an idle loop at about 8 frames per second lowers the deer's heads to graze and flutters a few butterflies. It pauses for hidden tabs, and is off when the person prefers reduced motion. The board emits `scene:hop` and `scene:rise` on the event bus.
- `sound.js` synthesizes every cue with Web Audio: footstep taps, a confirmation chime, a tier fanfare through a generated-noise reverb, a sprout for gardens and a soft tone for declines. It is silent until the Sound toggle is pressed, and main.js routes bus events to it, so the board never calls audio directly.
- `paypal-checkout.js` loads the sandbox JS SDK v6, starts a one-time payment session with a server-created order, reports approval to the server and shows whatever the server decides.
- Test hooks: `window.__ourCastle.state`, `window.__ourCastle.scene()` (tier, position, animation and ambient counters), `window.__ourCastle.sound()` (enabled flag and recent cues), `window.__ourCastle.bus` (set `bus.log = []` to record events), `document.body.dataset.ready`.

## Security notes

- Server binds to `127.0.0.1`; requests with non-local `Host` headers are refused (DNS rebinding); state-changing requests must be JSON and same-origin.
- The app page sends a Content-Security-Policy that allows only itself and, in sandbox mode, the PayPal script/frame domains.
- Only allowlisted static paths are served; `server/`, `data/`, `.env*`, `node_modules/` (except two exact AG Grid files) and `package.json` return 404.
- Secrets come from the local `.env` (or the process environment) and are never echoed in responses or logs; only the public PayPal client id is sent to the browser.
- The PayPal Agent Toolkit pins dependencies with published advisories (see VALIDATION.md). Its OpenAI-format entry point only loads the Server SDK, axios, debug, lodash, mathjs and zod at runtime; the steward passes it only server-built arguments (a known order id, an ISO date range, a status letter), never model text.
