# Architecture

A small Node server (built-in `node:http` and `node:sqlite`, one runtime dependency: the official Anthropic SDK) serves a framework-free browser app. The board renders through the original pixel pipeline; the server owns every financial fact.

```
browser                                   server (127.0.0.1)                     providers
───────                                   ──────────────────                     ─────────
index.html + app.css                      server/app.mjs  routes, Host/Origin
src/app/main.js   panels, approval  ──►   checks, CSP, static allowlist
src/app/bus.js    event bus               server/view.mjs  state view model
src/world/board-scene.js  3D board        server/household.mjs  ledger, tiers
  └ src/graphics/pixel-renderer.js        server/planner/*  basis, validation  ──► Anthropic Messages API
src/app/paypal-checkout.js  SDK v6  ──►   server/payments/* orders, capture,  ──► PayPal sandbox REST
src/core/rules.js  shared pure rules      refunds, webhooks                       (Orders v2, Payments v2,
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

Example mode and sandbox mode use different database files (`data/our-house-example.sqlite`, `data/our-house-sandbox.sqlite`), so simulated entries can never mix with PayPal-confirmed ones.

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

## AI planner

1. The server computes a deterministic **basis** from the household's inputs: remaining cents, the weekly dates before the target date, the maximum reachable amount, planned total, shortfall, required weekly amount, a feasible alternative date and milestone targets.
2. With an `AI_API_KEY`, `server/planner/anthropic-provider.mjs` calls `claude-opus-5-5` through the official SDK with structured output (`output_config.format` JSON schema), `effort: medium`, and server-side refusal fallback (`fallbacks: "default"`). The prompt contains only the household's inputs, the basis and the list of dollar figures the prose may cite.
3. `server/planner/validate.mjs` checks the response: shape, exactly one entry per date, whole nonnegative cents within the chosen weekly amount, totals equal to the planned amount, truthful feasibility and shortfall claims, and no dollar figure that is not derived from the inputs. Invalid output is never stored; the household sees the reasons and can choose the labeled rules-based plan.
4. Household edits are re-validated and stored as a new "household-edited" plan with server-written arithmetic.
5. Without a key, the same basis produces a deterministic rules plan, labeled "Example plan (built-in rules, no AI)". It passes the same validator.

The planner proposes only. Each contribution still needs an adult's explicit approval in PayPal.

## Browser

- `main.js` renders server state into four keyboard-accessible tabs (House, Plan, Contribute, Ledger), the quest card and the board status, and talks to the board only through `scene.update()` and the event bus.
- `board-scene.js` extends the original art-preview vocabulary (MiniBuilder instancing, layered trees, antlered deer, towers) with route stones that brighten as they are visited, milestone banners in crest colors, the household travelers (two figures for family, one for solo), habit gardens, a brook with a plank bridge and a small hamlet. Rendering is on demand; frames run only during walks and tier rises, and reduced-motion users get instant updates.
- `paypal-checkout.js` loads the sandbox JS SDK v6, starts a one-time payment session with a server-created order, reports approval to the server and shows whatever the server decides.
- Test hooks: `window.__ourHouse.state`, `window.__ourHouse.scene()`, `window.__ourHouse.bus` (set `bus.log = []` to record events), `document.body.dataset.ready`.

## Security notes

- Server binds to `127.0.0.1`; requests with non-local `Host` headers are refused (DNS rebinding); state-changing requests must be JSON and same-origin.
- The app page sends a Content-Security-Policy that allows only itself and, in sandbox mode, the PayPal script/frame domains.
- Only allowlisted static paths are served; `server/`, `data/`, `.env*`, `node_modules/` and `package.json` return 404.
- Secrets come from the local `.env` (or the process environment) and are never echoed in responses or logs; only the public PayPal client id is sent to the browser.
