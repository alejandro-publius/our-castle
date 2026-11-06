# Treasury (Ledger)

The owner asked for "a treasury that doesn't explain what opened the bridge… more simple the better". Journal → Ledger now opens with the Treasury, with:
- **one next-area milestone**: the district or districts that open next, progress toward that threshold, the amount to go, and "View on map";
- **This week**, a compact planned/recorded comparison with expandable record links;
- **the existing record grid**, searchable and filterable;
- **a receipt on tap.**

Bridges and districts open in the world itself, with the existing deed card. There is no explanation paragraph, question box, Explain button, chat or model label in the Treasury.

## What the family sees

- **Next area.** For example: "Next area · Manor Gardens · 25% milestone · $60.00 of $75.00 · $15.00 to go". Districts that open together are named together, for example "Stone Keep & Starfall Observatory". When every milestone area is open, it says so. "View on map" moves the camera to that district and focuses its map control. It writes nothing.
- **Every record.** This is the existing AG Grid Community grid: each record's amount, date and source (reported, simulated or PayPal sandbox) and whether it counts. Search and the All/Goal progress/Bills/Gifts filters only change what is listed. The pinned total and the next area always come from the server's canonical progress.
- **Selected record.** Tapping a row shows its short receipt: amount, status, source tag and, for a payment, order, capture and refund ids. It keeps the existing actions: complete a pending simulated payment, check a sandbox receipt, refund with adult confirmation. "Visit …" appears when that record crossed an area that is open now. "Check with PayPal" also leaves one quiet saved-check line on the record. The server saves it from the actual PayPal order read and its own reconciliation, never from a model answer or the browser, so it survives a reload; up to ten checks are kept, with earlier ones inside the closed "Payment details" control. A provider failure is saved as unavailable and appears immediately through a local state read, without a second PayPal lookup. Nothing is checked on load.
- **Saved-check status.** Every PayPal record carries one compact status, derived in `src/core/check-status.js` from the record and its newest saved check only: "checked, matches", "checked, pending" (a pending match is never a completed payment), "checked, refunded", "check failed" (PayPal did not answer, or did not match), "needs a check", or "no saved check" for a captured payment that was verified when paid but never separately checked. The grid shows it on the record's source line; immediately below the selected receipt's amount/status, the same pill appears with the check's time, server note and any recovery action. A newer failed check always outranks an older success. A refund ID alone never means a refund completed: pending refunds remain pending, partial refunds stay distinct, and later refunds are not presented as part of an older check. When only refund references were saved, the label separates the current refund record from the saved check. On a receipt that needs a check, the existing "Check with PayPal" button sits on that status line; otherwise it stays with the other actions. It runs only when pressed: opening records, searching, reloading and the local questions never trigger it.
- **Needs a check?** The steward's second local question, "Any contributions that need a PayPal check?", is answered from this household's active-goal records through the existing `/api/steward` request with no model or PayPal call, with or without an AI key. It names the pending, failed and uncounted contributions, mentions records with no saved check, says that no new check was made, and offers "Open receipt" links that only select the record. It never claims fresh verification.
- **House steward.** The existing read-only steward sits at the end of the Ledger in a closed disclosure. Its existing note says “Reads PayPal and household records. Cannot make payments.” (or household records only when PayPal tools are absent), before anyone asks a question. **Last confirmation** answers from saved order checks through the existing `/api/steward` request, with no model or PayPal call; it works without an AI key. Completed-capture identity, amount and currency must match the credited receipt before a saved time is described as a confirmation. Pending matches, refunds, later failed checks and absent history are distinguished, and no date is backfilled. Its **Saved confirmation** answer never becomes fresh payment verification. A receipt's existing **Ask the steward to verify** still performs the separate explicit provider-backed path. AG Studio's framework manages both through the same runner; no new endpoint, tool or panel is added.

## How it works

- **Server, read-only** (`server/treasury.mjs`). `treasuryFor(state)` reads the state the server already builds:
  - district `open` flags from the existing realm access, which follows earned achievements;
  - thresholds from the same `milestoneCents` rule that awards milestones.

  It returns one row per milestone district (the bill-habit garden is not a savings milestone) and the next locked group. It is attached to every state response as `state.treasury`. There is no browser-side entitlement rule, and nothing is fetched from PayPal or any provider.
- **AG Studio widget** (`src/app/treasury.js`). The Ledger loads the AG Studio UMD bundle on first open, from `vendor/ag-studio/ag-studio.min.js`, an exact-path map to `node_modules`. It creates one view-mode Studio page with:
  - no panels and a parchment theme, without Google fonts;
  - one custom widget, `nextArea`, built with `createWidgets` and the `init/getGui/refresh/destroy` component contract;
  - two synchronous data sources, `areas` and `week`, holding the server rows. Both declare `transactions: "all"` and a stable primary key.

  The widget asks Studio's own data engine for the next group with one filtered aggregate query (`areas.next isTrue`; first id/label, max threshold/progress/remaining, count). It passes a `queryId` so a superseded answer is dropped. When server state changes, a serialized queue sends stable-id add/update/remove deltas to `getDataEngine().applyTransaction`. Studio keeps the same widget and data engine. The Community grid likewise uses row transactions to preserve selection, sorting and filters. The latest state wins if another update arrives during an in-flight transaction. The widget fits its height to its content, because names wrap on phones.
- **Fallback.** If Studio cannot load, the same markup is drawn from the same `state.treasury`, so the Ledger never loses the milestone.
- **No requests on load, filter or selection.** No provider, model or write request is made. The page reads the Studio bundle and `GET /api/treasury/studio` once.

### Agent Framework: the existing steward, scoped to current records

`src/app/treasury-agent.js` uses the installed Studio 3.1.0 `createAiHarness` API and a custom `house-steward` runner. The Studio `ai` configuration installs this harness while view panels remain empty. This is real framework use, not an added model label or an unused dependency.

- One explicit ask creates one temporary framework thread and sends one `/api/steward` request. The server keeps the Anthropic conversation and PayPal read-only tools. It returns the same structured answer and checks used by the existing receipt UI.
- The runner emits AG-UI run, tool-result and answer events from that server response. These are returned server checks, not additional browser-executed PayPal tools. It does not delegate to Studio's built-in dashboard agents.
- Household, goal, progress, plan, member or selected-record changes cancel the scoped run. The browser aborts its fetch, discards late results and clears previous answers on selection changes. This does **not** promise cancellation of an already-running server/provider request.
- Completion, failure and cancellation close/delete the temporary thread. Errors do not retry automatically. If Studio cannot load, the original server-backed steward remains available and reports fallback internally.
- No question is asked merely by opening the Ledger, filtering, selecting a row or visiting the map. No model key moves into Studio/browser configuration.

## AG Studio package and licence

- **Package.** `ag-studio@3.1.0` and `ag-grid-community@36.3.0`, pinned together on November 6. Studio uses the compatible Enterprise Grid/Charts/Stack dependencies in the lockfile.
  - 3.1 live transactions replace whole-source resets. API signatures were checked against installed `agDataSource.d.ts` and `agDataEngine.d.ts`, plus the [official release notes](https://www.ag-grid.com/blog/whats-new-in-ag-studio-3-1/).
  - Only Studio's own bundle is used. Enterprise Grid or Charts features are not used outside Studio, and the licence is not assumed to cover them.
  - Six packages were added; the package licence is "Commercial".
- **Licence location.** The owner's evaluation licence is read only as `AG_STUDIO_LICENSE_KEY` from the server's `.env`. Browser licences are client-side by design, so `GET /api/treasury/studio` hands the page that one value and nothing else.
- **How it is applied.** The page calls `AgStudioLicenseManager.setLicenseKey` before `createStudio`, as documented at https://www.ag-grid.com/studio/javascript/licence-install/. The value is never logged, committed or put in tests.
- **Terms.** Evaluation only, one application, no production use. No deployment is authorized.
- **Validated locally on 2026-11-05.** Only that one assignment was loaded, in memory, into an isolated in-process app with a fresh example database.
  - `AgStudioLicenseManager.getLicenseDetails` from the installed 3.0.0 reports:
    - **valid: true**, with supplied type `STUDIO-PRO-AI`, `isTrial: true` and version `3`;
    - expiry "19 December 2026" (the owner's note says 20 December; the SDK's date is the conservative one), and not expired.
  - In the browser, licensed, there were no licence console messages and no external requests.
  - Unlicensed, the page logs AG's "License Key Not Found… unlocked for trial" notice, which is what tests show. The watermark element stayed hidden at this widget size in both runs, so the console messages and `getLicenseDetails` are the evidence.
- **Agent use.** The supplied licence includes the AI tier. The framework manages the existing explicit steward interaction; it does not introduce another model, dashboard chatbot or paid call on render.

Docs read: https://www.ag-grid.com/studio/javascript/quick-start/, `/custom-widgets/`, `/licence-install/`, `/ai-agents/` and its custom-runner/harness guidance, checked against the installed 3.0.0 type definitions. The webinar guidance for the grid session (published description: an async data source, and translating dashboard filters and paging into the real query contract) was applied as: records come from the server's confirmed ledger; filters never change canonical totals; no provider call on render. This comes from the published session description and chapters, not a watched talk.

## Evidence

- **Unit** (`test/unit/treasury.test.mjs`, three cases, real example-server states):
  - the next area through pending, canceled, completed, replayed and refunded payments, where the Manor stays open as a keepsake;
  - a bill that never counts;
  - grouped 60% districts, and nothing next after 100%;
  - a changed goal's thresholds;
  - `treasuryFor` taking open flags from server access;
  - the licence readable only on its route and absent from state, status and pages, alongside other secrets;
  - the bundle served by exact path, and other `node_modules` paths 404.
- **Browser** (`test/e2e/treasury.spec.mjs`, three cases × desktop/phone, own port, in-memory example data, unlicensed). All six passed:
  - the Studio-rendered milestone, its meter value and "View on map";
  - no question, Explain, AI or chat controls, and the steward closed;
  - filters and search leave the milestone unchanged;
  - a receipt on tap;
  - no writes or external requests on load, filter or select;
  - the ordinary Contribute flow opening the Manor, then the Treasury moving to Market Town;
  - "Visit Manor Gardens" from the receipt;
  - reload persistence;
  - pending changes nothing, and a refund keeps the Manor open while Market Town stays next;
  - the fallback when Studio is unavailable, and keyboard access to the map button;
  - no horizontal overflow.
- **Stills**, licensed local render with example data: [Ledger](screenshots/treasury-ledger.png), [phone](screenshots/treasury-phone.png).
- **Framework follow-up** (`test/e2e/studio-agent.spec.mjs`): actual Studio harness with scripted fake Anthropic/PayPal transports, covering one scoped request, cleanup, late-result suppression, explicit retry after failure, unavailable-Studio fallback and exact-order server proof. Current counts and browser scope are in [VALIDATION.md](VALIDATION.md). The separately verified in-app sandbox result is documented in [IN-APP-SANDBOX-VERIFICATION.md](IN-APP-SANDBOX-VERIFICATION.md); these fake-transport tests do not add live evidence.

## Not done / limits

- One application under an evaluation licence that expires December 2026. Production use needs a commercial licence decision by the owner.
- The 6.7 MB Studio 3.1 bundle loads on first Ledger open (local only). There is no hosting.
- PayPal sandbox records appear exactly as stored. No fresh `get_order` is claimed by the Treasury. The coordinated in-app popup → single credit → exact-order rehearsal belongs to its existing operator on 3021.

## Sponsor-depth design lock (November 6)

Keep the woodland map as the main view. Inside the existing parchment Ledger, use the bundled area-card artwork for one illustrated next-area strip, followed by a compact planned/recorded weekly comparison with expandable record links. Reference: the owner's AG Studio examples use meaningful pictures and linked detail; the Refero Wayfinder and Duolingo references support a scenery-first view and recognisable milestones. Do not copy their palettes, add another dashboard, or turn reported starting progress into a deposit. Existing Alegreya typography and parchment tokens remain authoritative.


## Sponsor-depth behavior (November 6)

The next-area strip reuses `assets/area-cards/` with the existing parchment palette. The two weekly bars compare the accepted plan dates against contribution/refund ledger entries in the Monday–Sunday UTC window; they do not allocate contributions to plan weeks or treat starting savings, bills, gifts, pending or canceled orders as deposits. No accepted plan displays “No plan”; an accepted plan with nothing due displays $0. Refunds can produce a negative net week. Closed record details identify the date basis and starting savings separately, then link up to five recent entries to the existing receipt. Simulated/sandbox sources remain distinguishable. This is a read-only local calculation, not a new provider reconciliation.

The original licence validation above is historical 3.0 evidence. The 3.1 browser checks use the unlicensed trial build and fake/example data; the owner’s key was not retrieved or revalidated.

The grid applies stable-ID row transactions, and Studio 3.1 applies live transactions to the existing `areas` and `week` tables. Neither is recreated for ordinary updates. Selection, search and sorting remain in place. If the live-data engine fails, the same local milestone stays visible and the disposed Studio agent is replaced by the existing direct steward runner on the next explicit request; there is no automatic model or provider retry. See [the current validation section](VALIDATION.md) for this pass's checks and screenshots; earlier counts above describe the initial Treasury implementation.
