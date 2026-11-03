# Claude build plan and acceptance

## First complete slice

Keep the board/home as the main view. The first flow is: select solo/family example → choose a crest → inspect one shared goal → request/review an AI milestone plan → choose a planned contribution → approve PayPal sandbox payment → see server-confirmed receipt → watch the token advance and the home tier change → refresh and retain the same result.

Start with the supplied art scene and original fonts/palette. A Node server is already available for art preview. Add a small browser application and server endpoints rather than a large framework migration unless the implementation needs one. Use durable storage such as SQLite for order/ledger state. Keep credentials on the server. Preserve `/art-preview.html` for visual comparison.

## Milestones

1. Build household/goal/crest state and the board UI using synthetic data. Keep amount entry, errors, pending states and approvals readable in HTML.
2. Add a provider-backed AI planning route with structured-output validation and an honestly labeled example fallback.
3. Add real PayPal sandbox order creation/capture, persistent expected amounts and a durable idempotent contribution ledger. Confirm current official API support for the intended demo before picking an SDK/product.
4. Wire verified progress to the token, tier geometry, crest markers and a plain receipt. Handle canceled, pending, failed and duplicate events without false rewards.
5. Test meaningful behavior, mobile/keyboard access, repeated refresh/callbacks, and the actual sandbox/AI integrations when credentials are supplied. Record missing integration evidence explicitly.
6. Update run instructions, license/asset notices and a sub-three-minute demo script. Keep the repo private and prepare publication/submission as a later owner decision.

## Acceptance checks

- The actual bundled font/renderer/palette and miniature landscape survive implementation; the product opens as a scenic board, not a generic dashboard.
- One user can follow the whole goal/plan/approval/result path with keyboard and mouse. A 390 px phone has readable amounts/actions and no document overflow.
- The AI plan uses the supplied inputs, has coherent arithmetic, can be edited, and visibly handles an impossible target or invalid provider output.
- A real server-created PayPal sandbox order can be approved and captured. Its amount/currency/goal are verified server-side, with evidence from an actual test transaction.
- Cancel/pending/failure leaves progress unchanged. Replaying a capture or refreshing cannot double-credit it. A mismatched household/order is rejected.
- Ledger/progress persist after restart. Bill/gift entries do not count as savings; a processed refund updates credited progress exactly once.
- A confirmed milestone moves the token, changes the actual native house geometry, and adds a readable crest/achievement cue without hiding the receipt.
- Example mode, a real sandbox capture and a real AI response are clearly distinguishable. No keys appear in browser bundles or Git.

## Credentials and honest completion

Copy `.env.example` to a local server-only `.env` and supply sandbox credentials plus a runtime AI provider key. Do not request keys in chat, reuse the coding assistant's OAuth session, or commit them. The starter has no such credentials. Complete all independent work before reporting the remaining credential-dependent checks; do not claim them from mock output.
