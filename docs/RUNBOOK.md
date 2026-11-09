# Local runbook

Commands and integration setup for Our Castle. Current state and live-proof limits are in [JUDGE-HANDOFF.md](JUDGE-HANDOFF.md); historical results are not a reason to repeat paid checks.

## Run it

**Fresh, no-credentials session:** after `npm ci`, run `npm run demo` and open its printed localhost URL. This portable command uses an unused port and an in-memory household; it never reads `.env`, inherited provider settings or saved data. Progress survives browser refresh until Ctrl+C ends the session. Start it again for a clean game. The owner's persistent 3010 app and separate 3021 rehearsal remain separate.

**Persistent/configured app:** use the commands below.

Requires **Node.js 22.16 or later** (uses the built-in `node:sqlite`).

```sh
npm ci        # exact versions from package-lock.json; needs npm registry access or a warm npm cache
npm start
# Open http://localhost:3010/
# The original art reference stays at http://localhost:3010/art-preview.html
```

If the app is already running on port 3010, a second `npm start` fails. To run a separate example-mode copy that leaves `.env` and the household untouched, see [docs/JUDGE-HANDOFF.md](JUDGE-HANDOFF.md#1-run-it).

With no `.env` file the app runs in **example mode**: payments are simulated by the server and labeled "simulated" on every badge, receipt and ledger line; plans come from built-in rules and are labeled "no AI"; the steward explains that it is off. Example mode previews the product. It is not proof of either integration.

### Merchant and Treasury settings

Optional `.env` settings: `CHANNEL3_API_KEY` enables search; `KIT_OPENAI_API_KEY` (its own key, never `OPENAI_API_KEY`) lets an adult read a photo of a kit list, which works fully typed without it; `KIT_COHERE_API_KEY` (its own key, never `CO_API_KEY`) lets an adult order the complete kits that fit by a preference, and every comparison works without it; `AG_STUDIO_LICENSE_KEY` applies a Studio licence. The owner's Mac already has its local settings; none are bundled. The supplied licence is evaluation-only. See [the connected handoff](CONNECTED-HANDOFF.md). APIMatic review adds no runtime credential or screen.

### Real PayPal sandbox and AI

1. Copy `.env.example` to `.env` (server-side only; it is git-ignored and never served).
2. PayPal: create a **sandbox** REST app at developer.paypal.com and put its client id and secret in `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`. `PAYPAL_ENV` must be `sandbox`; the code has no live endpoint (the Server SDK is fixed to `Environment.Sandbox` and the Agent Toolkit to `sandbox: true`).
3. AI: create an API key in the Anthropic Console (https://platform.claude.com/settings/keys), then run `npm run set-ai-key` in your own terminal and paste it.
   - The script hides the key as you paste and accepts Console API keys (`sk-ant-api…` or personal `sk-ant-usr-…` keys). It refuses Claude subscription/OAuth tokens, like the one Claude Code signs in with.
   - It writes `AI_API_KEY` to `.env` with owner-only permissions. Every other line, including the PayPal settings, is kept. `AI_PROVIDER=anthropic` and `AI_MODEL=claude-opus-5-5` are filled in if missing.
   - The server reads only `AI_API_KEY`. It never uses `ANTHROPIC_API_KEY` or a coding assistant's login.
4. Restart `npm start`. Startup and World settings → integration status identify sandbox payments and live AI; the Ledger's existing steward uses the read-only PayPal tools. Sandbox data is kept in a separate database file from example data.
5. Pay with a **sandbox personal (buyer) account** from the PayPal developer dashboard.

**One-command live check.** With `.env` filled in, run `npm run verify:live`. It runs:
- the AI plan, plus an impossible-target plan;
- a real sandbox order through the Server SDK: it prints PayPal's approval link and waits while you approve with a sandbox buyer;
- the capture, replay and mismatch checks, and PayPal's own record of the order;
- the steward's Agent Toolkit check;
- a refund.

It uses a temporary database and writes the evidence to `docs/LIVE-VERIFICATION.md`.

**AI-only check.** `npm run verify:live -- --ai-only` runs the AI plan, the impossible-target plan and a steward question that reads the ledger and lists recent sandbox transactions through the Agent Toolkit.
- No PayPal order is created, so nothing needs approval.
- It writes `docs/LIVE-VERIFICATION-AI.md`, leaving the payment evidence alone.
- Without `AI_API_KEY`, it reports the AI checks as pending and exits.

Optional webhooks: expose the local server through a tunnel, add a webhook in the sandbox app pointing to `https://<tunnel>/api/paypal/webhook` for `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED` and `PAYMENT.CAPTURE.REVERSED`, then set `PAYPAL_WEBHOOK_ID`. Without it, captures still complete synchronously; unverified webhook deliveries are always refused.

### Postman

Import `postman/our-castle.postman_collection.json` and `postman/our-castle.postman_environment.json`.

- **Folder 1** walks the example-mode API: found the house, plan, adult-approved contribution, replay safety, child refusal, bills not counting, steward status and the cross-site guard.
- **Folder 2** walks the real sandbox. Create an order through Our Castle and open its `approveUrl` to approve with a sandbox buyer. Then capture, replay, try a mismatched household, compare with PayPal's own `GET /v2/checkout/orders`, ask the steward to verify, refund, and confirm that an order created outside Our Castle is refused.

  Folder 2 is **off by default**. Its folder-level guard sends nothing, records a `BLOCKED … (not sent)` failure and stops the run unless `allowSandboxRequests` is exactly `yes` for that run.
  - **Opt in on purpose:** in the Postman app, set `allowSandboxRequests` to `yes` in the environment for that session, then clear it. With Newman, add `--env-var "allowSandboxRequests=yes"` to a `--folder "2 · PayPal sandbox walkthrough (needs sandbox credentials)"` run.
  - **What the opt-in is not:** it is only a developer test permission. It does not replace an adult's approval in the app or a sandbox buyer's approval in PayPal, and step 2.2 still creates a sandbox order.

Folder 1 writes. It resets the example household, founds a house, logs a bill, and asks the planner and steward. Run it only against a **throwaway example-mode server**:

- Folder 1 uses its own `exampleBaseUrl` variable (default `http://localhost:3134`). It no longer uses `baseUrl` (default `http://localhost:3010`), which folder 2 uses for the sandbox app.
- A folder-level guard checks `GET {{exampleBaseUrl}}/api/status` before every request. Unless the server reports example mode for both payments and AI, the guard does not send the request. It records a `BLOCKED … (not sent)` failure, stops the run, and Newman exits with code 1.

This blocks:
- sandbox payments, and live AI even with example payments;
- an unreachable server, a non-200 or non-JSON reply, and missing modes;
- a malformed `exampleBaseUrl`.

```sh
# Terminal 1: start a new example-mode server on a free port, with a temporary database and no keys.
OUR_CASTLE_ENV_FILE=none OUR_CASTLE_DATA_DIR="$(mktemp -d)" PAYPAL_CLIENT_ID= PAYPAL_CLIENT_SECRET= AI_API_KEY= PORT=3134 npm start
# Terminal 2: run folder 1 against that server.
npx --yes newman@6.2.1 run postman/our-castle.postman_collection.json -e postman/our-castle.postman_environment.json \
  --env-var "exampleBaseUrl=http://localhost:3134" --folder "1 · Example mode walkthrough (no credentials)"
```

**If terminal 1 does not show `Payments: EXAMPLE mode`, stop.** For example, it may print `Error: listen EADDRINUSE`, meaning another server already owns port 3134. Do not run Newman, and never point it at the server that already owns the port.

The guard confirms the server's modes, not that it is the server you just started. Pointed at someone else's example-mode server, folder 1 would still reset that server's example household.

Newman is pinned to 6.2.1, the version the guards were tested with. An unpinned `npx newman` would fetch whatever is latest.

Pass `--folder` anyway. A whole-collection run without the opt-in stops at folder 2's first request with a `BLOCKED` failure and exit code 1, and sends nothing to `baseUrl` or PayPal.

### Other commands

```sh
npm test              # integrity check + unit tests + browser end-to-end tests
npm run test:unit     # node --test (ledger, payments on both PayPal adapters, planner, steward, HTTP, Postman files)
PAYMENT_MODEL_SEED=2 PAYMENT_MODEL_ADAPTER=rest PAYMENT_MODEL_REFUNDS=credited node --test test/unit/payment-model.test.mjs
                      # replays one seeded payment sequence against its reference model: any seed 1-4294967295,
                      # adapter rest or sdk, refund scope credited or any (docs/VALIDATION.md)
npm run test:e2e      # Playwright, desktop 1440px and phone 390px, example mode
npm run check         # asset hashes, 90-color palette, renderer wiring, JS syntax
npm run solver:build  # the Rust complete-kit solver (solver/, Rust 1.99.1 via rustup, locked crates); without it the
                      # server uses the built-in reference solver. OUR_CASTLE_KIT_SOLVER=native requires the build.
npm run solver:test   # the solver's own Rust tests; KIT_SOLVER_REQUIRED=1 npm run test:unit compares it with the reference
npm run check:postman-guard  # proves both Postman guards with Newman 6.2.1, logging mocks and a throwaway example server
                      # (`npx --yes newman@6.2.1 --version` once, or set NEWMAN_BIN; never uses port 3010, PayPal or AI)
npm run set-ai-key    # store an Anthropic Console API key in .env, hidden as you paste (run in your own terminal)
npm run reset-demo    # erase the local example household (add --include-sandbox to also erase sandbox records)
npm run snapshot -- <existing.sqlite> <new.sqlite>  # a consistent, checked copy of one database file; never overwrites (below)
npm run art-preview   # the original static art preview server
```

### Household snapshots

`npm run snapshot -- <existing-database.sqlite> <new-snapshot.sqlite>` writes a consistent, point-in-time copy of one Our Castle database file, such as `<data>/our-castle-example.sqlite`, as a local backup or for a recovery rehearsal.
- **Paths:** both are required. It reads no `.env` and chooses no default file.
- **Running app:** it can run while the app is serving that file.

Rehearse it on a disposable household, never on someone's records:

```sh
# Terminal 1: a throwaway example household on its own port, with no keys. Make a simulated contribution in the browser.
OUR_CASTLE_ENV_FILE=none OUR_CASTLE_DATA_DIR=/tmp/castle-rehearsal PAYPAL_CLIENT_ID= PAYPAL_CLIENT_SECRET= AI_API_KEY= PORT=3134 npm start
# Terminal 2, while it runs:
npm run snapshot -- /tmp/castle-rehearsal/our-castle-example.sqlite /tmp/castle-snapshot-1.sqlite
# Output of one such rehearsal on a fresh schema-12 database (27 tables), after one simulated $15 contribution and
# one saved kit list. The page count, rows, SQLite and Node versions and the hash vary with the household and runtime:
# Snapshot written: …/castle-snapshot-1.sqlite
#   schema 12 · integrity ok · foreign keys ok · 27 tables · 75 pages
#   rows: households 1, ledger_entries 2, payment_orders 1, payment_captures 1
#   SQLite 3.53.4, Node v26.0.0
#   sha256 … (identifies this file; it does not replace the checks above)
node --test test/unit/household-snapshot.test.mjs   # the recovery checks, on fresh temporary databases
```

**How it works**
- **The source is opened read-only** through Node's built-in `node:sqlite`. It is never created, migrated, seeded or checkpointed, and its `-wal` file is left alone.
- **Changes still in the WAL are included.** Committed changes can sit in the WAL, which a copy of the `.sqlite` file alone misses. In an isolated example, with a committed $15 contribution still in the WAL, a copy of the main file read $60.00 where the database read $75.00. That was on both Node 22.16.0 and 26.0.0.
- **The copy uses SQLite's online backup API** through [`sqlite.backup()`](https://nodejs.org/download/release/v22.16.0/docs/api/sqlite.html#sqlitebackupsourcedb-destination-options) (Node 22.16), in one step.
- **Publishing never overwrites.** That function replaces an existing destination, so the command writes to a private temporary file (mode `0600`) beside the destination and checks it first. It then publishes it with a hard link, which fails rather than replace a file, including one that appears while it runs.
- **The checks:** SQLite's `integrity_check` and `foreign_key_check` must pass. The copy must also have the source's schema version and table and index definitions.
- **What it refuses**, writing nothing in each case:
  - a missing or non-SQLite source, or a database that isn't Our Castle's;
  - a schema newer than this build's;
  - the source itself, or its `-wal`, `-shm` or `-journal` file, as the destination;
  - a destination, or its `-wal`, `-shm` or `-journal` file, that already exists;
  - a missing destination folder;
  - a source locked for more than 5 seconds.
- **Output:** it prints counts only. The SHA-256 identifies the file; it is not a correctness check.
- **Cleanup:** on a refusal, a failure or Ctrl-C it deletes its own temporary files. A killed process can leave a hidden `.<name>.<random>.partial` file beside the destination. That file is never the destination itself and can be deleted.
- **SQLite's own files:** opening a database read-only lets SQLite create its usual `-wal` and `-shm` files beside it. The command never deletes the source's, because a running app may be using them.

**Limits**
- **Point in time:** a capture or refund that PayPal completes after the snapshot is not in it and is not recreated offline. Reconcile the live database with the existing explicit **Check with PayPal**.
- **Access state:** a family snapshot keeps its accounts, passkeys, memberships, invitations and sessions exactly as they were.
  - Serving it again is a separate security decision. It needs an explicit recovery procedure, such as ending every session and withdrawing every invitation first.
  - This command provides none, and a snapshot is not permission to reactivate old sessions.
- **No restore:** nothing replaces a database in place or starts an app on a snapshot. To rehearse recovery, open a snapshot as a new file in a temporary folder, as the test above does.
- **Runtime SQLite:** the summary prints the version in use.
  - **Node 22.16.0** bundles SQLite 3.49.1. That is inside the range affected by the [WAL-reset bug](https://www.sqlite.org/wal.html#the_wal_reset_bug): 3.7.0–3.51.2, fixed in 3.51.3. The bug is rare and needs two connections writing or checkpointing at the same instant. This command's connection only reads and never checkpoints.
  - **Node 26.0.0** bundles SQLite 3.53.4, and **Node 26.13.0**, used by the hosted release checks, bundles 3.54.0. Both have the fix.
- **Local tool only:** it is not a production or disaster-recovery guarantee. There is no schedule or off-site copy, and no testing of hardware failure or disk durability.
- **Hard links needed:** the destination must be on a file system that supports them; otherwise it refuses.

References: SQLite's [backup API](https://www.sqlite.org/backup.html), [the WAL file](https://www.sqlite.org/wal.html#the_wal_file) (it stays with its database) and [read-only WAL databases](https://www.sqlite.org/wal.html#read_only_databases).

## How it plays

**Your next step.** A single action appears when another step needs attention. It disappears when you are already there. Saved payment records remain one link away from House or Plan, and all records stay in the Ledger. A refresh keeps the chosen tab; a new visit resumes the next step. Navigation never submits a payment.

1. **House:** choose solo or family (example personas: Rowan, an adult, and Wren, a child), name the house and compose a crest (field color plus crown, leaf, stag or tower).
2. **Plan:** enter the goal, what is already set aside (self-reported), a target date, the weekly amount you choose, and bills you already pay (context only). The planner proposes a weekly schedule, shows the arithmetic and projects when the Manor, Keep and Castle are reached. Every week is editable; impossible targets show the exact shortfall and how to close it.
3. **Contribute:** enter an amount, explicitly approve that amount and use the PayPal button. Changing the amount clears the approval. Limits and errors appear only when needed. Sandbox/test-money or simulated mode stays labelled. The server still captures the order, checks amount, currency, goal and household, and credits it only after confirmation. The receipt and Ledger retain the full payment details.
4. **The realm answers:** the travelers walk to the new space. When a milestone is crossed, that district's bridge leaves lower over the river, its gate opens, and a celebration banner names it. Earlier districts stay. Refresh or restart, and the same result is there. Turn on **Sound** to hear synthesized footsteps, a chime for a confirmed payment and a fanfare when the home grows. All of it is generated in the browser; there are no audio files.
5. **Ledger and steward:** ask "Did PayPal confirm our last contribution?" The steward reads the ledger, looks the order up through PayPal's Agent Toolkit, and the server shows what was checked and whether PayPal and the ledger agree. The AG Grid ledger keeps goal progress, bills and gifts apart. Bills grow garden beds as a habit reward but never count as savings. A refund lowers progress exactly once and walks the travelers back; the raised building stays as an explained keepsake.

6. **District deeds:** a pixel card marks each newly opened area. Select an earned district on the map and choose **View deed** to reopen it. The face is just the area name, pixel art, crest and a short milestone line ([card](screenshots/deed-manor-simple.png)). Locked districts keep their condition on the map. No separate Rewards catalogue or future-tier tour is shown.

Default demo numbers (editable, synthetic): a $300 goal, $60 already set aside, eight weeks of $30, and a first $15 contribution that reaches the Manor at 25%.

## PayPal and sponsor tools used

| Tool | How Our Castle uses it |
| --- | --- |
| PayPal JavaScript SDK v6 | One-time payment session in the browser; the order comes from the server |
| PayPal Server SDK (APIMatic-generated) | Orders v2 create/capture/get and Payments v2 refunds, with `PayPal-Request-Id` idempotency |
| PayPal Agent Toolkit | The AI steward's read-only `get_order` and `list_transactions` tools (sandbox only) |
| PayPal Webhooks v1 | Signature-verified capture and refund events |
| AG Grid Community | The household ledger grid, themed in parchment |
| AG Studio | Custom next-area widget/data engine/theme; Agent Framework behind the existing scoped steward |
| Channel3 | Real merchant results → unsaved goal draft → explicit confirmation |
| APIMatic context | Eight installed SDK-specific Codex skills used for integration review and fixes |
| Postman | A runnable collection for the example and sandbox flows |
| Anthropic Claude (`claude-opus-5-5`) | Runtime AI: the milestone planner and the house steward |

## What keeps it honest

- Integer cents everywhere; amounts are real HTML text in Alegreya Sans, never pixel art.
- The browser cannot credit a payment. Redirects, callbacks, pending, canceled and declined orders never count.
- Unique capture and refund ids plus `PayPal-Request-Id` idempotency keys mean replays, double clicks and repeated webhooks cannot double-credit.
- A capture for a different household or goal, or with a different amount, currency or `custom_id`, is rejected. Orders created outside Our Castle are refused.
- The database refuses bill or gift entries that would count toward the goal.
- AI output is validated before it is shown or stored. For plans, the server checks the schema, whole nonnegative cents, exact dates, totals and feasibility claims. For both plans and steward answers, every dollar figure must come from the household's data or PayPal's. AI never authorizes, schedules or refunds a payment. The steward only gets read-only PayPal tools, limited to this household's order ids, with arguments rebuilt by the server.
- Secrets stay in the server `.env`; tests check that no secret reaches any page or API response. The server binds to `127.0.0.1` and refuses cross-site writes and rebinding hosts.
- The internal ledger is goal progress, not a bank balance, and PayPal does not see the household's other bills.

Architecture, data model and payment states: [docs/ARCHITECTURE.md](ARCHITECTURE.md). Judge handoff: [docs/JUDGE-HANDOFF.md](JUDGE-HANDOFF.md). Demo script: [docs/DEMO-SCRIPT.md](DEMO-SCRIPT.md). Submission draft (not submitted): [docs/SUBMISSION-DRAFT.md](SUBMISSION-DRAFT.md).


## Unexpected server failures

An unexpected failure can occur after a contribution commits. Check the latest records before retrying; the HTTP status does not establish payment truth. The response includes a generated request reference, also present in a bounded server log. See [failure diagnostics](FAILURE-DIAGNOSTICS.md) for the fields, reproduction and privacy limits.
