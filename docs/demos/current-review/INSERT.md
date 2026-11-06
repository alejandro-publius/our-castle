# One remaining recorded insert

**Runtime status, November 5 PST / November 6 UTC:** the owner has already completed the single approved $15 contribution. One credit gives $75/$300; Hearth and Manor are open. The actual same-order `get_order` check is verified after compatibility fix `3f72609`. [Evidence](../../IN-APP-SANDBOX-VERIFICATION.md). No continuous owner recording has been located or confirmed. Locate any existing original before editing; **do not create a replacement order or repeat the paid steward check to fill this slot**. The shot list below describes required source footage, not authorization for another transaction.

The current **2:42 review cut** reserves **1:08–1:36** for the actual sandbox checkout and same-order steward sequence. The slot is 28 seconds; it may expand to **40 seconds**, bringing the full cut to 2:54. Preserve all prior cuts and the continuous original. Do not upload this review slate as the finished demonstration.

## Before recording

The owner is the sole manual browser operator. The **3021** rehearsal now contains one completed order/capture, one contribution credit, the original $60 reported starting entry and no plan. Preserve that result; no payment waiter remains.

The owner app on **3010** and isolated rehearsal on **3021** use `~/projects/our-castle-reviewed`. Preserve the owner's records and `.env`. The same rehearsal database was backed up, migrated schema 1→3 and brought to reviewed source. Current rehearsal PID: **39365**, after a 3021-only restart for the steward fix; 3010 was not restarted. The gold fountain is frontend-only. Local `approved-sandbox-insert/session.json` and `RESUME.md` hold the current handoff.

The existing approval covers one **$15 USD sandbox** contribution against a **$300 goal** with **$60 explicitly self-reported starting progress**, plus the necessary steward check of that same order. It does not authorize live funds, another search, planner suite, unrelated refund or replacement orders. Existing local server-side keys are configured. No credential needs to be pasted into chat.

Finish any buyer login/challenge off camera. Confirm the app and checkout are sandbox. Start continuous capture **before creating the order**. Do not display passwords, developer credentials or keys.

## Shot list

| Shot | Target | Actual evidence needed |
| --- | --- | --- |
| Amount and approval | 3–4 s | $60/$300, Rowan adult, $15 USD, explicit consent, the real in-app PayPal button |
| Sandbox popup | 6–8 s | Real sandbox host and amount, buyer completes approval; no live payment page |
| Receipt | 4–5 s | Correct household/goal/order, server-confirmed completed $15 USD capture, progress $75 exactly once |
| Manor | 4–5 s | Actual bridge opening and deed; original village still present |
| Steward | 9–18 s | Select that same receipt, ask about it, show the genuine `get_order` result and server-backed reconciliation |

Preserve the original recording continuously. Waiting may be trimmed in the edit and documented; do not reconstruct the popup, receipt or answer. If approval times out, inspect the **same order's** server/PayPal status before any retry. Do not create another order while the outcome is uncertain.

## Proof before replacing the slate

- Exact order and capture identity, $15.00 USD, household, goal and order reference all agree with the server-confirmed receipt.
- One persisted credit gives $60 reported + $15 sandbox = $75, including after a refresh. The original village and new Manor remain.
- The steward genuinely calls scoped `get_order` for the selected household order. A ledger read, `list_transactions`, model prose or a fake-transport test is insufficient.
- A read-only evidence report and recording hash support those facts. No key, login or raw secret-bearing request is saved into the public package.

Then replace `owner-insert` in `timeline.json`, its instructional narration and captions, add the actual source ranges/hashes, update only the claims established by new evidence, and rebuild. Verify duration under 180 seconds, frame count, audio/caption timing, full decode and representative frames before the final public YouTube upload and Devpost submission.
