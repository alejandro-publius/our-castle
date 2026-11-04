# The approved sandbox insert

The woodland/family review cut reserves **2:17–2:41** (24 seconds). It currently contains an explicit unfilmed slate. No footage in this kit establishes the in-app popup approval or same-order steward reconciliation.

The owner already authorized **one isolated $15 sandbox contribution and its necessary same-order steward check**. Do not ask for that payment approval again, and do not run the earlier paid verifier suites. This guide creates no new authorization for real money, unrelated orders/refunds, public deployment or submission.

## Resume the existing rehearsal

The coordination thread `01a1a60a-aa8b-707d-b23a-93dd7384f01f` remains the sole browser/checkout/recording operator. Read the current git-ignored `test-results/approved-sandbox-insert/RESUME.md` and `session.json` first.

- Existing rehearsal: **http://localhost:3021**, original server PID **67124**. Reuse it; **do not launch a replacement server or reset its database**.
- Database: `test-results/approved-sandbox-insert/data/our-castle-sandbox.sqlite` under the primary checkout.
- Preserve the owner's household and server on **3010**.
- The latest project-worker read-only check found **0 orders, 1 reported starting ledger entry and 0 plans**. No payment waiter, order ID, steward call or sandbox recording had been established by that worker. Re-check uncertain state before creating anything; if an order now exists, inspect and resume that order rather than creating another.
- The owner reports being logged into both sandbox and normal PayPal accounts. The project worker could not inspect that login because it has no supported browser controls. The operator must verify the **personal sandbox buyer** in its existing sandbox tab. A normal PayPal login is not the sandbox buyer.
- The configured server already has the required sandbox and runtime AI keys. Do not request another key, expose credentials, inspect a rejected credential source, or reuse coding-assistant authentication.

Confirm the app's **PayPal sandbox** and live-AI badges and the goal: **$300**, with **$60 reported starting progress**. Confirm every PayPal approval page is on `sandbox.paypal.com` / `www.sandbox.paypal.com`. The separate example demos are for simulated progression, not integration evidence.

The app's front-end artwork and family guidance have changed since the rehearsal server was started; the payment backend is unchanged. If no order is in progress, the operator may reload the same app tab to use the latest front end. Record both the server's startup source and current front-end commit accurately when they differ. Do not interrupt an active checkout to update visuals.

## Record one continuous original before creating the order

Keep login, developer dashboards, .env files, passwords and keys off screen. Set up continuous capture before pressing the payment button. If login, CAPTCHA, 2FA or another manual step blocks the operator, report the exact page and current order/waiter state; do not create replacements or retry blindly.

| Insert time | Actual interaction | Required evidence |
| --- | --- | --- |
| 0–8 s | Choose **$15**, explicitly approve as an adult, press the in-app PayPal button and complete buyer approval in its sandbox popup | Actual in-app origin and popup approval. A hosted approval link alone does not prove the v6 callback |
| 8–16 s | Return to the app and show the receipt and Manor bridge | Same order/capture IDs; **$15 USD**; matching household/goal; server-confirmed capture; one credit to **$75**; actual Manor bridge opening with the village retained |
| 16–24 s | Ask the steward to check **that exact household order** | A real read-only **get_order** result and the server-backed reconciliation. A ledger read, list_transactions or a fluent claim alone is insufficient |

Keep the untouched recording. Trim waiting only, documenting in/out ranges and source hashes. If any outcome is unverified, keep the unfinished slate. Do not reconstruct approval, receipts or tool results. No refund is required for this insert.

The default cut is **2:51**. Expanding this insert to **32 seconds** keeps it at **2:59**. A 40-second insert requires removing at least eight seconds elsewhere and regenerating timing/narration; never export it as an under-three-minute cut without rechecking its actual duration.

## Integrate only verified results

Replace the slate **and its instructional narration/captions** only when the recording and server evidence establish the outcome. Add source commit(s), UTC time, modes, matching order/capture identifiers, get_order reconciliation, original hash and exact edits to `sources/manifest.json` and provenance. Regenerate measured narration and captions; validate and decode the exported video. Update project validation without overwriting the preserved historical reports or original clips.

Keep example progression, historical sandbox/AI tests and the new sandbox insert distinctly labelled. Utility-provider verification remains connection-required. Keep the repo private and local; uploading or submitting still requires the owner's separate decision.
