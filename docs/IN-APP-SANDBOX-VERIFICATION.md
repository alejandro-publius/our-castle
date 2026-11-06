# In-app sandbox contribution and same-order verification

Verified **November 5, 2026 PST / November 6 UTC**. This closes the outstanding runtime payment/steward check; it does not establish a recorded popup sequence or a submitted entry.

## Actual result

The owner completed the contribution manually in the existing isolated game at **http://localhost:3021**. Server records show:

| Check | Result |
| --- | --- |
| Environment | PayPal sandbox; test money only |
| Contribution | $15.00 USD, completed at 2026-11-06T02:36:31.265Z |
| Order / capture | One order ending `3763D`; one completed capture ending `3470B` |
| Credit | One persisted contribution entry, credited once; no refund |
| Goal | $60 explicitly reported starting progress + $15 sandbox = **$75 / $300** |
| Realm | Hearth Village and Manor Gardens open; later districts remain gated |
| Same-order steward | Actual Agent Toolkit `get_order`, then `read_household_ledger` |
| Server verdict | `match`; selected-order verification `verified`; no warnings |
| After verification/restart | Still $75, one order, one capture and one contribution credit |

The server's deterministic reconciliation checks the selected order identity, contribution reference, capture identity, amount, USD currency and credited ledger record. A model statement alone cannot produce the verified state. The runtime model was `claude-opus-5-5`; the successful response arrived at **2026-11-06T02:45:43.503930Z**.

The owner app on **3010** was inspected separately: its original $60 progress and failed earlier contribution remain separate from this rehearsal. No second payment, refund, planner suite or product search was run.

## Compatibility fix found by the real flow

The first selected-order steward request received a provider **400**, before any tool ran: Opus 5.5 rejects forced `tool_choice: tool` / `any`. [Current Anthropic documentation](https://platform.claude.com/docs/en/api/errors#forced-tool-use-not-supported) confirms this restriction.

Commit **`3f72609`** uses supported automatic tool selection with strict schemas and an explicit exact-order instruction. The existing server verification still requires the actual scoped `get_order` result. **All 10 focused steward tests passed**, including a transport that rejects forced tool choice, unknown household orders, unsupported actions, fluent unverified answers, timeouts and mismatched captures. These tests use fake transports; the runtime result above is separate evidence.

Only the 3021 server was restarted for that check, using the same database and local environment. Its new PID is **39365**. Financial rows match the before-fix snapshot; SQLite sequence counters can advance under startup `INSERT OR IGNORE`, so this is not a byte-identical database claim. One necessary steward retry after the concrete fix succeeded. No automatic payment retry or replacement order was created.

## Evidence and limits

Private evidence remains on the Mac under `~/projects/our-house/test-results/approved-sandbox-insert/verified-order-<order-id>/`. It includes the receipt/state snapshots, original failed response, successful response, activation report and verification summary. No runtime credential, raw household snapshot or full provider response is added to the public repository.

| Private evidence file | SHA-256 |
| --- | --- |
| `receipt-before.json` | `75e8c60d099bd1568385716f991697c0f48bc0720ef0aa758638a9032f193c62` |
| `steward-response.json` — original 400 | `db83802253167c51ba7cdf7d9db77dd58ea50dc739de7982da33c47a8a570487` |
| `steward-after-fix-response.json` | `8b0daee499a778c45ceaea5072bf3fb6ae16c200aa892e45dbfc9f5ff1a85546` |
| `state-after-verification.json` | `3b6f1232c686afbb577962439049df0734a3d59a485d1590212636431d36ba02` |

The owner operated checkout; Codex verified the saved receipt and made the subsequent local `/api/steward` request. No supported browser control was used by Codex. No continuous original recording has been located or confirmed, and the actual bridge animation/steward UI was not independently filmed. API evidence must not be presented as recorded interactive footage. The existing **2:42 review cut remains unchanged**, including its missing insert; no YouTube upload or Devpost submission is claimed.

Earlier hosted-approval replay/refund tests and older live planner results remain historical, not repeated here. Utility-provider connections, real funds and production deployment remain outside this sandbox result.
