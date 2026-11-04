# Judge and demo handoff

Start here to run, evaluate or present Our Castle. State as of **November 4, 2026**: commit `7468b57` on the local branch `expansion/wider-estate`. It is not pushed: the GitHub `main` branch still holds only the original concept handoff (`5cf8363`). The repository is private, everything runs against the PayPal **sandbox**, and no hackathon entry has been submitted.

| Look at | Where |
| --- | --- |
| The running app (owner's Mac) | http://localhost:3010 |
| Finished 36-second world clip (silent, local only) | `test-results/realm-promotion/our-castle-connected-realm.mp4`; `test-results/` is git-ignored, so the clip is not in the repository and has not been uploaded |
| Live payment evidence | [LIVE-VERIFICATION.md](LIVE-VERIFICATION.md) |
| Live AI evidence | [LIVE-VERIFICATION-AI.md](LIVE-VERIFICATION-AI.md) |
| Every check run, with dates | [VALIDATION.md](VALIDATION.md) |
| Current world captures | [`docs/screenshots/realm-*.png`](screenshots/) |
| Talk tracks | [DEMO-SCRIPT.md](DEMO-SCRIPT.md) |

## 1. Run it

### On the owner's configured Mac

The app already runs at **http://localhost:3010**. It was started from `~/projects/our-house` with `npm start`, which reads the git-ignored `.env` (PayPal sandbox credentials and `AI_API_KEY`) and the sandbox household in `data/our-castle-sandbox.sqlite`.

- **Check it, read-only:** `curl -s http://localhost:3010/api/status` should report `"mode":"sandbox"` for payments and `"mode":"live"` with `claude-opus-5-5` for AI. The page header shows the badges **PayPal sandbox** and **AI planner · claude-opus-5-5**.
- **If it is not running:** `cd ~/projects/our-house && npm start`. It does not modify `.env` or any ledger or payment record. While the app is up, a second `npm start` fails because port 3010 is in use.
- **Current household:** House of Alder, $60.00 tracked, all of it reported starting progress. No PayPal contribution has been confirmed in this household yet; one early order attempt failed with a 401 before the new sandbox credentials started working. Hearth Village is open and the other five districts are grey.
- **A throwaway example-mode copy**, for touring or Postman without touching `.env` or the household (port 3020 is just an example):

  ```sh
  OUR_CASTLE_ENV_FILE=none OUR_CASTLE_DATA_DIR="$(mktemp -d)" PAYPAL_CLIENT_ID= PAYPAL_CLIENT_SECRET= AI_API_KEY= PORT=3020 npm start
  ```

### From a clean clone

Requires Node.js 22.16 or later and access to the private repository.

```sh
git clone <repository URL> our-castle && cd our-castle
npm install
npm start          # http://localhost:3010, example mode
```

- **Without `.env`:** payments are simulated and the planner uses built-in rules. Both are labeled "simulated" and "no AI" everywhere, and the steward is off. This previews the product; it does not demonstrate the PayPal or AI integrations.
- **For the real integrations:**
  1. Copy `.env.example` to `.env`.
  2. Add your own PayPal **sandbox** REST app's client id and secret.
  3. Run `npm run set-ai-key` in your terminal and paste an Anthropic Console API key.
  4. Restart.

  The README's "[Real PayPal sandbox and AI](../README.md#real-paypal-sandbox-and-ai)" section has the details.

### Names and paths

- **Our Castle** is the product and the private GitHub repository name, and `our-castle` is the package name.
- The owner's working folder is still `~/projects/our-house`. It was kept on purpose so local paths stay unchanged.
- The original art reference (`/art-preview.html`, `references/images/our-house-*.png`) keeps the old "Our House" name as a preserved reference.
- Other local checkouts: `../our-castle-connected-realm` and `../our-castle-living-court` are git worktrees used to build the realm and court before they were promoted. Both are at or behind `7468b57`.

### Which commands are safe on the configured Mac

| Command | What it touches | On the configured Mac |
| --- | --- | --- |
| `curl -s http://localhost:3010/api/status` | Nothing; read-only | Safe |
| `npm run check` | Nothing; hashes and syntax | Safe |
| `npm run test:unit` | Temporary databases and test doubles | Safe |
| `npm run test:e2e` / `npm test` | Its own example-mode server on port 3111 with `test-results/e2e-data`; ignores `.env` | Safe; takes several minutes |
| `npm start` | Reads `.env`, opens `data/our-castle-sandbox.sqlite` | Only when 3010 is not already running |
| The throwaway example-mode command above | A new temporary folder | Safe |
| `npx newman run … --folder "1 · …"` | **Writes:** tries a reset, founds a house, logs a bill and asks the AI. The environment file points at `localhost:3010` | Only with `--env-var "baseUrl=http://localhost:3020"` against the throwaway copy (see the [README](../README.md#postman)) |
| `npm run reset-demo` | **Deletes** `data/our-castle-example.sqlite`, if present | Avoid unless you mean it. **Never** add `--include-sandbox` (it deletes the sandbox household) |
| `npm run set-ai-key` | Rewrites `.env`, keeping the other lines | Not needed: the key is already configured |
| `npm run verify:live` | Creates a **new sandbox order** that a sandbox buyer must approve, and calls the AI | Owner's decision. It already passed (7/0/2); don't repeat it without a reason |
| `npm run verify:live -- --ai-only` | Paid Anthropic calls; overwrites `docs/LIVE-VERIFICATION-AI.md` | Already passed (6/0/1); don't repeat it without a reason |

## 2. What is verified, and by what

| Claim | Status | Evidence |
| --- | --- | --- |
| Server SDK sandbox order, buyer approval, capture verified and credited once | **Verified live** Nov 3, 2026. Approved through PayPal's hosted approval link | Order `5D424601H2372591L`, capture `72476659YH700454R`: [LIVE-VERIFICATION.md](LIVE-VERIFICATION.md) |
| Replay not double-counted; mismatched household refused; PayPal's record matches | **Verified live** | Same run |
| Sandbox refund reverses progress once | **Verified live** through the server path | Refund `9U925627HK881213A`: [VALIDATION.md](VALIDATION.md) |
| AI planner (Claude `claude-opus-5-5`, server-validated arithmetic) | **Verified live**, including an impossible target with a $160 shortfall | [LIVE-VERIFICATION-AI.md](LIVE-VERIFICATION-AI.md) |
| AI steward reads the ledger and lists sandbox transactions through the read-only PayPal Agent Toolkit | **Verified live** | Same run |
| JS SDK v6 eligibility and `<paypal-button>` rendering with the real client id | **Verified live**; the button was not pressed | [VALIDATION.md](VALIDATION.md), Nov 3 evening section |
| In-page v6 popup approval reaching the server | **Not verified** | Needs a sandbox buyer; see section 4 |
| Steward `get_order` reconciliation of a household order ("PayPal and the ledger agree.") | **Not verified live**; covered by unit tests with doubles | Needs one in-app payment |
| Ledger tab's "Refund in sandbox" button | **Not verified live** | The same in-app payment can test it |
| Webhooks | **Not verified live**; signature verification is implemented | Needs a public tunnel and `PAYPAL_WEBHOOK_ID` |
| Connected realm, rewards, court, previews, keepsakes | **Working**, in example mode and against test doubles | At `7468b57`: 104 unit tests passed, 1 skipped; 43 browser cases passed, 1 skipped ([VALIDATION.md](VALIDATION.md)). Not rerun for this documentation change |
| Bill-provider verification (e.g. SDG&E) | **Not built.** No provider is connected; bill rewards stay "Needs a provider connection" | [BILL-VERIFICATION-RESEARCH.md](BILL-VERIFICATION-RESEARCH.md) |

**Three kinds of money, never mixed.** The Rewards tab's evidence line names the source of every dollar:

- **Confirmed by PayPal sandbox captures:** test money. It counts only after the server captures the order and checks amount, currency, household and goal with PayPal. A redirect or click alone never counts.
- **Simulated example payments:** example mode only, labeled "simulated" on every badge, receipt and ledger line. This is what the finished clip shows.
- **Reported by you:** starting savings, bills and gifts typed in by the household. Starting savings count toward the goal and are labeled as reported. Bills and gifts never count as savings. Bills grow the self-reported habit garden and the Woodland Garden district, never a provider-verified reward.

## 3. The finished clip

`test-results/realm-promotion/our-castle-connected-realm.mp4`:

- **Format:** 36.36 s, 1920×1080 H.264, 25 fps, silent, burned-in captions. SHA-256 `33dd6531…eb2fc1`, as in `export-manifest.json`.
- **Source:** recorded from an **isolated example database on port 3134** (now stopped), not the owner's sandbox household. Its one contribution is **simulated**.
- **Reports:** `recording-report.json`, `timeline.json`, `export-manifest.json`, `promotion-report.json` and `main-smoke.json`, all in the same folder.

| Clip time | Section (on-screen title) | What happens |
| --- | --- | --- |
| 0:00–0:09 | 1/4 One connected realm, six distinct districts | Whole-realm overview; Hearth Village open, five grey districts beyond raised bridges |
| 0:09–0:16 | 2/4 Inspect the locked Royal Citadel | The camera focuses the grey citadel; its caption gives the 100% lock condition and the $240.00 still to go |
| 0:16–0:28 | 3/4 The Manor bridge opens at the 25% milestone | Contribute tab, $15.00 simulated payment; $60 → $75; "The Manor rises!", the Manor Gardens turn green and the bridge lowers |
| 0:28–0:36 | 4/4 The village remains as your realm expands | Overview: 2/6 districts earned, village and manor both open |

It is a world and progression demo. It does **not** show PayPal, the AI planner or the steward, and it is not proof of any live integration. It is not the hackathon video and has not been uploaded. A talk track timed to it, and the separate judge-demo plan, are in [DEMO-SCRIPT.md](DEMO-SCRIPT.md).

## 4. What remains, by who has to act

**A. Integration checks still unverified** (the owner must log in as a sandbox buyer):

1. The in-page JS SDK v6 popup approval, and its `onApprove` reaching the server's capture.
2. Steward `get_order` reconciliation of that household order.
3. The browser "Refund in sandbox" button.
4. *Optional:* webhooks through a tunnel; pending and declined captures through PayPal's negative testing; real phone, Safari/Firefox and screen-reader passes.

Items 1–3 can be closed by one payment (next actions, step 1).

**B. Submission decisions** (owner only; the owner currently wants private development). The requirements below come from the owner's pasted Devpost page, summarized in [HACKATHON.md](HACKATHON.md). Deadline: **November 12, 2026, 12:00 p.m. PST**.

- **A public repository with a visible license.** This means bringing the prototype onto the branch that is shared, because `main` lacks it today. It also means deciding how the original Tiny Castle art is licensed before public distribution ([NOTICE.md](../NOTICE.md)).
- **A public YouTube demo under three minutes** that shows the project working. The 36-second clip doesn't meet this on its own: it shows no PayPal or AI.
- **The Devpost text**, from [SUBMISSION-DRAFT.md](SUBMISSION-DRAFT.md), including confirming the coding-assistant disclosure.
- **Hosting is not required.** Run instructions in the repository satisfy the "functional demo" requirement.

**C. Provider-dependent, not buildable now:** confirmed-bill rewards (SDG&E or any utility). No authorized bill provider is available, so these rewards stay `connection_required` and the app cannot mark a bill verified.

**D. Optional production limitations** (not hackathon requirements):

- the household personas are not authentication;
- sandbox only, with no real money;
- not deployed;
- one goal per household;
- the Agent Toolkit's pinned dependencies carry `npm audit` advisories (see VALIDATION.md).

## 5. Next actions

1. **Owner: one in-app sandbox payment** (about 10 minutes; creates one sandbox order and uses a little Anthropic API credit). To keep the House of Alder records unchanged, run a rehearsal copy that uses the same `.env` with a fresh sandbox database:

   ```sh
   cd ~/projects/our-house && OUR_CASTLE_DATA_DIR="$(mktemp -d)" PORT=3021 npm start
   ```

   Then, at http://localhost:3021:
   1. Found the house.
   2. Ask the planner.
   3. Contribute $15 with the **PayPal button** and approve in the popup as the sandbox buyer.
   4. Check the receipt and the Manor bridge.
   5. In the Ledger tab, ask "Did PayPal confirm our last contribution?".
   6. Optionally, press "Refund in sandbox".

   Stop it with Ctrl-C. If the PayPal button does not appear on 3021, rehearse on 3010 instead; the House of Alder would then move to $75 in sandbox test money.
2. **Claude, after the owner reports the outcome:** record it in VALIDATION.md, the README status table and the SUBMISSION-DRAFT brackets. If the popup fails, the next code task is to diagnose it. The app currently has no in-page fallback to PayPal's hosted approval link, which is the path that was verified.
3. **Owner: record the judge demo** from [DEMO-SCRIPT.md](DEMO-SCRIPT.md) part B, after step 1 passes.
4. **Owner decisions, when ready:**
   - merging the prototype into `main`;
   - repository visibility and art licensing;
   - uploading the video;
   - submitting.

   Claude can prepare a local merge and the submission text on request, but must not push, publish or submit.

Nothing else is blocked on code. The bill-provider rewards stay locked until an authorized provider exists.
