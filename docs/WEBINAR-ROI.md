# Webinar ROI: what the four hackathon webinars are worth to Our Castle

Source: `test-results/webinar-notes.md` (paraphrased notes on W1–W4, Oct 6–13, 2026; ignored by git). Deadline is
**November 12, 2026, 12:00 p.m. PST** per the written rules. Judging: technical implementation, design, impact,
innovation, presentation (equal weight). Status values: `done on main`, `in the uncommitted diff` (this worktree,
branch `feature/webinar-roi`, not yet committed or tested in a browser), `proposed` (with a size S/M/L).

Ground rule for every item below: the steward stays read-only, money is credited only from a server-verified capture,
and nothing fakes payment proof. Items that would weaken that are not listed.

## W1. Start building with PayPal (Oct 6)

1. **Verify webhook signatures against the raw delivered body.** W1: "ALWAYS verify the signature so nobody can fake an
   upgrade." Status: in the uncommitted diff. Files: `server/payments/paypal-client.mjs` (`verifyWebhookSignature` now
   splices `rawBody` into the verify request instead of re-serialized JSON), `server/payments/contributions.mjs`
   (`handleWebhook` passes `rawBody`). ROI: a re-serialized event can change number formatting and make PayPal reject a
   genuine delivery; this is the one webhook defect that would show up in a live demo. Technical implementation.
2. **Surface the PayPal debug id for `explain-error`.** W1: `doctor` and `explain-error` "will be your best friends";
   support needs the debug id. Status: in the uncommitted diff. Files: `server/app.mjs` (warn log with debug id),
   `server/payments/contributions.mjs` (debug id kept on verify and client-token failures). ROI: cheap, and it is the
   evidence trail a judge or PayPal engineer asks for when a sandbox call fails.
3. **Negative-path coverage: declines, cancellations, refunds, reversals.** W1: "test unhappy paths... not just the happy
   path." Status: done on main. Files: `test/unit/payments.test.mjs`, `test/unit/paypal-unknown-outcome.test.mjs`
   (DECLINED/DENIED, PENDING, 5xx-unknown, REFUNDED and REVERSED webhooks, replay). ROI: already the project's strongest
   technical story; make sure `docs/SUBMISSION-DRAFT.md` "How we built it" names these cases in one sentence (S).
4. **Run the AI Toolkit `doctor` scan and record the result.** W1: `doctor` scans a codebase for integration mistakes.
   Status: proposed, S. Files: `docs/VALIDATION.md` (one dated paragraph, findings and what was fixed or declined).
   ROI: a sponsor-named tool applied to our own integration, with a written result, costs under an hour and reads as
   diligence under "technical implementation". Must be run by the owner on a machine with the plugin; it reads code
   only, so no order, refund or paid call is involved.

## W2. APIMatic Context Plugins (Oct 7)

1. **Bounded wait on every REST call.** W2: production-readiness checks (retries, outages, unexpected responses); the
   installed `typescript-configuration-resilience` skill. Status: in the uncommitted diff. File:
   `server/payments/paypal-client.mjs` (`AbortSignal.timeout(timeoutMs)` wrapper; no answer becomes a `PayPalError`
   with no status, which callers already treat as "unknown outcome"). ROI: the SDK client already had a 30 s timeout on
   main; this closes the same gap for webhook verification and client tokens, so the story "every PayPal call is bounded"
   becomes true end to end.
2. **Answer the APIMatic plugin question on the Devpost form.** W2: qualification is "use the plugin while building,
   then answer the plugin question." Status: done on main (prepared answer in `docs/SUBMISSION-DRAFT.md`, provenance in
   `docs/APIMATIC-CODEX.md`). ROI: the sponsor prize is gated on this one form field; nothing further to build.
3. **Close the plugin's plan -> build -> verify loop for this diff.** W2: the plugin mandates a plan first and a verify
   pass against best practices at the end. Status: in this branch. File: `test/unit/paypal-reconciliation.test.mjs`
   (verify body byte-identical to `rawBody`; timeout -> unknown outcome, with timeouts, unreachable hosts and
   programming errors kept distinct; dashboard refund applied once from `get_order` and its late webhook a duplicate;
   a capture first seen as REFUNDED never credited; `refund_pending` guard). ROI: without these the timeout, raw-body
   and refund changes were untested; with them "we used the context" is verifiable evidence for the APIMatic brief.

## W3. AG Grid / AG Studio dashboard (Oct 12)

1. **A real Studio data model: typed, described fields and a calculated field.** W3: sources are required; calculated
   fields and descriptions are what the engine and AI assistant read. Status: in the uncommitted diff. File:
   `src/app/treasury.js` (`AREA_FIELDS`, `AREA_EXPRESSIONS` with `shareOfThreshold = progress / threshold`, consumed by
   `NEXT_AREA_QUERY` and the meter width). ROI: moves the Treasury from "one untyped array" to the model shape James
   described, with the entitlement arithmetic still on the server. Matches the installed 3.0.0 typings
   (`expressions`, `divide`, `isMeasure`, `integerFormat`/`percentageFormat`).
2. **Browser check that the calculated field reaches the widget.** W3 demo: Studio evaluates expressions in its engine.
   Status: proposed, S. File: `test/e2e/treasury.spec.mjs` (assert `data-source="ag-studio"` and that the meter width
   equals progress/threshold from the server state). ROI: `npm run test:unit` cannot see this code; without it the diff's
   Studio change is unverified, and AG Grid judges read the tests section.
3. **Describe the Studio use precisely in the entry's tools section.** W3 (James): the tools section "is where prizes
   come into play"; they most want custom agents, custom tools and ideas they have not thought of. Status: done on main
   (`docs/SUBMISSION-DRAFT.md`: custom widget, parchment theme, custom `house-steward` runner in the native harness,
   no built-in-agent delegation claimed). ROI: nothing to build; keep the wording honest when the data model lands.
4. **Second source plus a calendar for the ledger.** W3: relationships and calendars let queries span tables and filter
   by month or quarter. Status: proposed, M. Files: `src/app/treasury.js` (a `records` source with `createdAt` as a
   date field and one `AgCalendar`), `server/treasury.mjs` (rows already exist as `state.ledger`). ROI: lets the
   steward run answer "this month's confirmed contributions" from Studio's engine instead of a hand-written filter.
   Only worth it if it stays behind the existing receipt/steward controls; the product rules forbid a generic dashboard.

## W4. Start building with PayPal, repeat (Oct 13)

1. **Reconcile dashboard refunds from `get_order` when the webhook never arrives.** W4: sandbox delivery lags, PayPal
   stops retrying after 3 days, missed events must be fetched from the API; "test a refund from the merchant side and
   check the app reacts." Status: in the uncommitted diff. File: `server/payments/contributions.mjs` (`applyOrder`
   walks `purchase_units[].payments.refunds`, applies each once by refund id; `applyCapture` treats a credited capture
   that reads REFUNDED as `already_completed` instead of `not_credited`). ROI: local runs have no tunnel, so this is the
   only way a merchant-side refund reaches the ledger in the demo; it is also the exact scenario the presenters named.
2. **Refuse a second refund while one is pending.** W1/W4 negative testing: refunds and reversals. Status: in the
   uncommitted diff. File: `server/payments/contributions.mjs` (`refundPreconditions` rejects with `refund_pending`).
   ROI: a pending refund has not reduced `refunded_cents`, so without this an adult could ask PayPal for the same money
   twice. No test covers it yet (see W2.3).
3. **Name the sandbox accounts and re-run the merchant-side refund once.** W4: "name the sandbox accounts so transactions
   are readable and look right in a demo"; default "John Doe" shows in transactions. Status: proposed, S (owner action,
   no code). Files: `docs/RUNBOOK.md` (sandbox setup step), `docs/SUBMISSION-SHOTLIST.md`. ROI: presentation is a fifth
   of the score and Best Demo Delivery is its own award; readable names in the receipt and PayPal activity are free.
   The refund re-run is only needed if the owner records new footage; it must stay in the isolated rehearsal.
4. **Refresh the token when PayPal rejects it.** W4: cache the token, or fetch a new one only when PayPal rejects it.
   Status: done on main for expiry-based caching (`accessToken()` in `server/payments/paypal-client.mjs`, 60 s margin;
   the Server SDK refreshes its own). Proposed, S: on a 401 from the REST client, drop the cache and retry once. Only
   verify and client-token calls use that client, so the retry never repeats a money-moving request.
5. **Keep even the client id in environment variables.** W4. Status: done on main (`server/config.mjs`, `.env.example`,
   CSP in `server/app.mjs` limited to the sandbox origin). ROI: nothing to do; mention in the README setup line.

## Suggested order (top 5 across all webinars)

1. W2.3: unit tests for the diff (timeout, raw-body verify, dashboard refund, pending refund). Done in this branch.
2. W3.2: one e2e assertion that the Studio calculated field drives the meter. S. The Studio change is still unverified
   in a browser.
3. W4.1 + W4.2: review the refund reconciliation and pending-refund guard (in this branch, tested by 1).
4. W1.4: run AI Toolkit `doctor`, record findings in `docs/VALIDATION.md`. S, owner machine.
5. W4.3: name sandbox accounts; add the step to `docs/RUNBOOK.md`. S, owner action, helps every recording.

Not recommended before the deadline: W3.4 (second source and calendar, M) unless 1–5 are done and there is time left.
