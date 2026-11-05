# Judge and demo handoff

Start here to run, evaluate or present Our Castle. State as of **November 4, 2026**, on the local branch `expansion/wider-estate`:

- **Latest owner direction:** expand the board and add a princess estate; video work remains paused. Rosewind is the seventh district on a 228x132 forest, with rose roofs, ivory spires, a flowing tributary/crossing, night lighting and its own short deed at the existing final milestone. All earlier buildings and financial rules remain. [Palace](screenshots/rosewind-palace.png) · [Expanded realm](screenshots/rosewind-expanded-realm.png) · [Night/rain](screenshots/rosewind-night-rain.png). Use Areas for all seven destinations; phone overviews keep one property plaque. Existing videos are historical.
- **Record to realm (817c19c):** select/search an AG Grid record, inspect its receipt and visit a calculated milestone district. Focused AI verification is scoped to the selected household order and checks order/reference/capture identity. [Award targets and actual integration](AWARD-STRATEGY.md). The 3010 backend was restarted for this code with all user-table digests and .env preserved; the existing 3021 rehearsal was not restarted or changed.
- **App:** the woodland realm is `ce43a0f`; the clearer family journey is `2a18bc5`, with the lazy-Ledger focus follow-up at `ecc7cc5`. District-deed cards are `da602b8`; time, rain and optional city weather are `feada574`; destination exploration language is `78033cc`. All are promoted to the primary local branch. The earlier `7468b57` island layout and preserved clips are historical.
- **Interface:** four journey steps (House, Plan, Contribute, Ledger). The owner removed the Rewards catalogue and future-tier tour banners. Unlock cards remain automatic; select an earned district and use View deed to reopen its card. A completed goal points directly to the castle. Unlock cards now have only their name, pixel art, crest and one milestone line ([current card](screenshots/deed-manor-simple.png)).
- **Current interface:** the realm is beside one collapsible journal with House / Plan / Contribute / Ledger. The header shows the goal once; Areas, View and World settings open on request. The footer has one general notice. Amount approval and actual receipt/ledger source labels remain. The pixel world, ivory district plaques, deeds, light/weather and gentle river current are unchanged. See [the reference lock](INTERFACE-DIRECTION.md) [Current desktop](screenshots/game-interface-contribute.png) · [whole realm](screenshots/game-interface-world.png) · [phone](screenshots/game-interface-phone.png)..
- **Not pushed:** the GitHub `main` branch still holds only the original concept handoff (`5cf8363`), so **cloning GitHub does not give you this prototype**. Review it from the owner's checkout or from the private offline review kit (section 1).
- **Status:** the repository is private, everything runs against the PayPal **sandbox**, and no hackathon entry has been submitted.

| Look at | Where |
| --- | --- |
| The running app (owner's Mac) | http://localhost:3010 |
| Current woodland/family review draft, 2:51 | [MP4](demos/woodland-review/our-castle-family-woodland-review-draft.mp4), [local player](demos/woodland-review/review.html), [editable kit](demos/woodland-review/README.md). The approved 24-second sandbox insert at 2:17–2:41 remains unfilmed; private, not submitted |
| Recorded gameplay demo, 17.60 s | [MP4](demos/gameplay/our-castle-gameplay-demo.mp4), [cut list and source notes](demos/gameplay/README.md). Actual isolated example UI at `78033cc`, before the Rewards catalogue was deleted; court, night and rain |
| New time/weather preview, 18.04 s | [MP4](demos/atmosphere/our-castle-time-weather-preview.mp4), [source notes and timeline](demos/atmosphere/README.md). Actual example UI; manual lighting/rain, no payment or live-weather footage |
| Earlier review draft, historical visuals | [2:36.36 kit](demos/judge-review/README.md), preserved unchanged |
| Historical 36-second world clip (silent, example mode) | [`docs/demos/our-castle-connected-realm.mp4`](demos/our-castle-connected-realm.mp4) ([provenance](demos/README.md)). Tracked in this private branch; not uploaded or published |
| Private offline review kit | `test-results/local-review/` on the owner's Mac: a source zip of a committed HEAD, with a manifest. Git-ignored and not published |
| Live payment evidence | [LIVE-VERIFICATION.md](LIVE-VERIFICATION.md) |
| Live AI evidence | [LIVE-VERIFICATION-AI.md](LIVE-VERIFICATION-AI.md) |
| Every check run, with dates | [VALIDATION.md](VALIDATION.md) |
| Current world captures | [`docs/screenshots/forest-*.png`](screenshots/) (woodland revision). The older `realm-*.png` captures show the superseded grey-island revision |
| Focused keyboard/device review | [ACCESSIBILITY-DEVICE-REVIEW.md](ACCESSIBILITY-DEVICE-REVIEW.md): 8 focused checks and 12 affected existing checks passed; Chromium emulation only |
| Talk tracks | [DEMO-SCRIPT.md](DEMO-SCRIPT.md) |

## 1. Run it

### On the owner's configured Mac

The app already runs at **http://localhost:3010**. Its main server was safely restarted for the weather CSP at `feada574`; its household records and saved keys are preserved. Refresh to load the atmosphere controls. **Auto** follows the device clock; manual Day, Afternoon and Night work with Clear or Rain. **Local weather** sends the town you explicitly search/choose to Open-Meteo; Disconnect forgets it in that browser. No PayPal address or GPS is used. The separate example lighting tryout is **http://localhost:3156**. The approved payment rehearsal on 3021 was not restarted; its old runtime CSP does not support the new optional weather hosts, so keep its weather Clear/manual during any coordinated recording.

The main app starts from `~/projects/our-house` with `npm start`, reading the git-ignored `.env` (PayPal sandbox credentials and `AI_API_KEY`) and the sandbox household in `data/our-castle-sandbox.sqlite`.

- **Check it, read-only:** `curl -s http://localhost:3010/api/status` should report `"mode":"sandbox"` for payments and `"mode":"live"` with `claude-opus-5-5` for AI. The page header shows the badges **PayPal sandbox** and **AI planner · claude-opus-5-5**.
- **If it is not running:** `cd ~/projects/our-house && npm start`. It does not modify `.env` or any ledger or payment record. While the app is up, a second `npm start` fails because port 3010 is in use.
- **Current household:** House of Alder, $60.00 tracked, all of it reported starting progress. No PayPal contribution has been confirmed in this household yet; one early order attempt failed with a 401 before the new sandbox credentials started working. Hearth Village is open and the other five districts are locked.
- **A throwaway example-mode copy**, for touring or Postman without touching `.env` or the household. Port 3134 is the Postman example folder's default; 3010 and 3020 are already in use on this Mac:

  ```sh
  OUR_CASTLE_ENV_FILE=none OUR_CASTLE_DATA_DIR="$(mktemp -d)" PAYPAL_CLIENT_ID= PAYPAL_CLIENT_SECRET= AI_API_KEY= PORT=3134 npm start
  ```

  If it prints `Error: listen EADDRINUSE` instead of `Payments: EXAMPLE mode`, stop. Something else owns the port; don't reuse it, reset it or run Postman against it.

### From the private offline review kit (another machine)

Cloning GitHub does not work for this yet: `main` has only the original starter, and pushing is the owner's decision. Instead, the owner can hand over the kit's zip. It is a source snapshot of one committed HEAD under a single `our-castle/` folder, with no Git history, `.env`, data or `node_modules`. Its adjacent manifest gives the commit and the SHA-256 hashes.

Requires Node.js 22.16 or later. `npm ci` installs the exact versions in `package-lock.json` and needs network access to the npm registry, or a warm npm cache.

```sh
mkdir our-castle-review && cd our-castle-review
unzip /path/to/our-castle-<commit>-source.zip      # creates ./our-castle/
cd our-castle
npm ci
OUR_CASTLE_ENV_FILE=none OUR_CASTLE_DATA_DIR="$(mktemp -d)" PAYPAL_CLIENT_ID= PAYPAL_CLIENT_SECRET= AI_API_KEY= PORT=3134 npm start
# open http://localhost:3134/
```

If the last command prints `Error: listen EADDRINUSE` instead of `Payments: EXAMPLE mode`, **stop**. Another server owns port 3134; don't use or reset it.

The kit also contains the finished clip at `docs/demos/our-castle-connected-realm.mp4`.

- **Example mode:** that command runs it, with `.env` ignored, empty PayPal and AI credentials and a throwaway database. Payments are simulated and the planner uses built-in rules. Both are labeled "simulated" and "no AI" everywhere, and the steward is off. This previews the product; it does not demonstrate the PayPal or AI integrations.
- **For the real integrations on another machine:**
  1. Copy `.env.example` to `.env`.
  2. Add your own PayPal **sandbox** REST app's client id and secret.
  3. Run `npm run set-ai-key` in your terminal and paste an Anthropic Console API key.
  4. Restart.

  The README's "[Real PayPal sandbox and AI](../README.md#real-paypal-sandbox-and-ai)" section has the details. This applies to another machine only: the owner's Mac is already configured and needs no new key.

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
| `npx --yes newman@6.2.1 run … --folder "1 · …"` | **Writes** to `exampleBaseUrl` (default `localhost:3134`): resets, founds a house, logs a bill, asks the planner and steward. A guard refuses to send anything unless that server reports example payments and example AI | Against the throwaway copy, with `--env-var "exampleBaseUrl=http://localhost:3134"` (see the [README](../README.md#postman)) |
| Postman folder 2, or the whole collection | Folder 2 creates sandbox orders on `baseUrl` (3010) and calls PayPal directly. It is **off by default** and sends nothing unless `allowSandboxRequests=yes` is set for that run | Don't opt in without the owner; a run without the opt-in stops with a `BLOCKED` failure |
| `npm run check:postman-guard` | Logging mock servers and its own temporary example server on free ports; never 3010 or PayPal | Safe; no PayPal or AI calls. Needs Newman 6.2.1 |
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
| Connected realm, rewards, court, keepsakes | **Working**, in example mode and against test doubles | At `7468b57`: 104 unit tests passed, 1 skipped; 43 browser cases passed, 1 skipped ([VALIDATION.md](VALIDATION.md)). Not rerun for this documentation change |
| Bill-provider verification (e.g. SDG&E) | **Not built.** No provider is connected; bill rewards stay "Needs a provider connection" | [BILL-VERIFICATION-RESEARCH.md](BILL-VERIFICATION-RESEARCH.md) |

**Three kinds of money, never mixed.** Payment records, the goal summary and district deeds name the source of every dollar:

- **Confirmed by PayPal sandbox captures:** test money. It counts only after the server captures the order and checks amount, currency, household and goal with PayPal. A redirect or click alone never counts.
- **Simulated example payments:** example mode only, labeled "simulated" on every badge, receipt and ledger line. This is what the finished clip shows.
- **Reported by you:** starting savings, bills and gifts typed in by the household. Starting savings count toward the goal and are labeled as reported. Bills and gifts never count as savings. Bills grow the self-reported habit garden and the Woodland Garden district, never a provider-verified reward.

## Current family journey and woodland review

The [new review kit](demos/woodland-review/README.md) uses the current green forest and the clearer next-step family flow, with actual scripted example-mode interactions, a simulated Manor unlock and the saved-record path after refresh. It keeps the earlier live-AI excerpts and historical sandbox verifier evidence distinctly labelled. Its approved sandbox insert is still unfilmed; source notes and [the current insert guide](demos/woodland-review/OWNER-INSERT.md) explain the exact remaining flow and the existing 3021 rehearsal. Do not start another rehearsal or order.

On the configured Mac, the owner can try the example-only family demo at **http://localhost:3140**; the configured household remains on **3010**. The existing coordination thread owns checkout on **3021**. This project worker has no supported browser controls; the owner reports login, but that session and the in-app payment/get_order result have not been verified here. No new key or repeated payment approval is needed to resume the already-authorized test with the browser operator.

## 3. The review draft and preserved world clip

### Earlier judge review draft (2:36.36, historical visual version)

The [new MP4](demos/judge-review/our-castle-judge-review-draft.mp4) is locally playable, with synthetic offline narration, burned-in captions, editable [SRT](demos/judge-review/captions.srt), [timeline](demos/judge-review/timeline.json) and [source notes](demos/judge-review/PROVENANCE.md). It clearly separates:

- current recorded **example-mode** realm footage and simulated progression;
- earlier recorded **live AI** planner/steward UI excerpts, labelled historical and cropped to omit the obsolete small world;
- **historical verifier reports** for PayPal's hosted approval/server capture/refund path and the live AI checks;
- an **unfilmed owner-recording slate at 2:00.36–2:24.36**. No popup approval or household `get_order` result is reconstructed.

The [precise insert guide](demos/judge-review/OWNER-INSERT.md) needs one owner-led isolated rehearsal recording. The slot can expand to 40 seconds while the full cut stays at about 2:52.36. No new payment order or paid AI call was made to prepare the draft. It is not the submitted video or a fully live end-to-end recording. The private source kit at `de147d4` remains an earlier pinned snapshot; use a newer kit's manifest when one is present.

### Preserved world clip (36.36 s)

[`docs/demos/our-castle-connected-realm.mp4`](demos/our-castle-connected-realm.mp4); see the [provenance note](demos/README.md).

- **Historical visuals:** recorded before the woodland revision, so it shows the earlier grey-island revision (six islands in open blue water, locked districts painted grey). The clip and the 2:36 judge draft are kept unchanged; neither shows the current forest and rivers.

- **Format:** 36.36 s, 1920×1080 H.264, 25 fps, no audio, burned-in captions. 1,932,194 bytes, SHA-256 `33dd65316e28ee6e059cb856deccaaebfe8eb071e00750ab18f4d3b51beb2fc1`.
- **Original:** `test-results/realm-promotion/` on the owner's Mac, with the capture reports (`recording-report.json`, `timeline.json`, `export-manifest.json`). That folder is git-ignored; the tracked copy is byte-identical.
- **Source:** recorded from an **isolated example database on port 3134** (now stopped), not the owner's sandbox household. Its one contribution is **simulated**.

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

The focused [Chromium keyboard/device review](ACCESSIBILITY-DEVICE-REVIEW.md) fixed focus left off-screen after moving to the realm. Desktop and 390/320 px emulation passed its targeted checks. It does not close the real-hardware, Safari/Firefox, screen-reader or PayPal-popup accessibility items.

Items 1–3 can be closed by one payment (next actions, step 1).

**B. Submission decisions** (owner only; the owner currently wants private development). The requirements below come from the owner's pasted Devpost page, summarized in [HACKATHON.md](HACKATHON.md). Deadline: **November 12, 2026, 12:00 p.m. PST**.

- **A public repository with a visible license.** This means bringing the prototype onto the branch that is shared, because `main` lacks it today. It also means deciding how the original Tiny Castle art is licensed before public distribution ([NOTICE.md](../NOTICE.md)).
- **A public YouTube demo under three minutes** that shows the project working. The 36-second clip doesn't meet this on its own: it shows no PayPal or AI.
- **The Devpost text**, from [SUBMISSION-DRAFT.md](SUBMISSION-DRAFT.md), including confirming the coding-assistant disclosure.
- **Hosting is not required.** Run instructions in the repository satisfy the "functional demo" requirement.
- **The private offline review kit satisfies none of these.** It is a private source snapshot for review, not a public repository, a YouTube video or a Devpost entry.

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

   Stop it with Ctrl-C. If the PayPal button does not render or the popup fails, stop there. Note what happened, and leave the House of Alder on 3010 untouched: diagnose the failure in this isolated copy.
2. **Claude, after the owner reports the outcome:** record it in VALIDATION.md, the README status table and the SUBMISSION-DRAFT brackets. If the popup failed, the next code task is to diagnose it, reproduced in an isolated rehearsal copy and never on the owner's household. The app has no in-page fallback to PayPal's hosted approval link, the path that was verified. Whether to add one depends on that diagnosis.
3. **Owner: finish the judge video** after step 1 passes. The [playable review draft](demos/judge-review/README.md) already includes the existing honest material; record its [one insert](demos/judge-review/OWNER-INSERT.md), replace the unfinished slate/narration/captions and review the result. [DEMO-SCRIPT.md](DEMO-SCRIPT.md) part B remains an optional full-take plan.
4. **Owner decisions, when ready:**
   - merging the prototype into `main`;
   - repository visibility and art licensing;
   - uploading the video;
   - submitting.

   Claude can prepare a local merge and the submission text on request, but must not push, publish or submit.

Scope of this conclusion: the documentation, the Postman guards and the recorded test runs were reviewed in these local handoff tasks, and none of them leaves a code change pending. That is not a claim that the rest of the app is free of defects. The open items above need the owner, a sandbox buyer or a provider. A failed popup rehearsal would become a code task. The bill-provider rewards stay locked until an authorized provider exists.
