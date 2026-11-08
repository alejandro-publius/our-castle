# Review-derived scenarios for Our Castle

Collected 8 November 2026. This research produces test scenarios and product hypotheses; it does not establish demand, measure usability or audit the current behavior of another app.

## Corpus and limitations

The [45-record corpus](research/review-scenarios-20261108.json) contains review IDs, exact public dates, ratings, short paraphrases, source URLs and qualitative codes. It includes 18 complaint passages, 14 strengths, 3 requests and 10 mixed passages. Star ratings did not determine inclusion or whether a passage was coded as a complaint. Ten records concern services outside this prototype's scope and remain in the sample.

The intended sample was 15 newest US reviews each from Honeydue, YNAB and Greenlight. Only Greenlight's public feed returned entries. Goodbudget and Splitwise also returned empty feeds, including the public URL form without a page number. That is a retrieval limitation, not evidence that those services closed or have no reviews.

Before reading the remaining page content, the fallback rule became: retain Greenlight's 15 newest feed entries; take the first 10 unique dated reviews in displayed order from each public YNAB, Goodbudget and Splitwise review page. Dates came from the public inline Review.date field, including years omitted by the visible display. Expanded and collapsed copies were deduplicated by review ID.

| Source | Records | Review dates | Selection |
| --- | ---: | --- | --- |
| [Greenlight](https://itunes.apple.com/us/rss/customerreviews/page=1/id=1049340702/sortBy=mostRecent/json) | 15 | 23 October–6 November 2026 | Newest feed entries, every rating |
| [YNAB](https://apps.apple.com/us/app/ynab/id1010865877?see-all=reviews) | 10 | 25 July 2018–22 November 2025 | Public page display order |
| [Goodbudget](https://apps.apple.com/us/app/goodbudget-budget-planner/id471112395?see-all=reviews) | 10 | 21 September 2018–4 April 2024 | Public page display order |
| [Splitwise](https://apps.apple.com/us/app/splitwise/id458023433?see-all=reviews) | 10 | 20 November 2018–4 August 2026 | Public page display order |

This is a mixed convenience sample, not 45 uniformly recent reviews or a representative survey. Display order may favor helpful or featured reviews. One assistant coded it; there was no second coder, reviewer contact or independent verification of reported experiences. Counts describe this corpus only; multi-theme counts overlap. Raw text, reviewer names and public-page bootstrap data are not published.

Local acquisition evidence is in test-results/review-mining-20261108/ in the research worktree: sampling-plan.json records the amendments, private raw responses/page captures preserve acquisition evidence, and corpus-validation.json checks IDs, dates, ratings and published-field boundaries. Source hashes and retrieval times are in the corpus. Future feeds may change or remove reviews.

## What transfers to Our Castle

The recurring transferable pattern is understandable records with low effort. Payment meaning appears in eight records, record retrieval/verification in seven, navigation in six and shared context in six; these are overlapping qualitative labels, not prevalence estimates. Positive reviews also value visible progress, planning and a shared view.

Card authorizations, ATM access, custody, account closure, bank connectors, automatic allowances and subscription pricing do not map to capabilities this prototype offers. They do not justify adding cards, automatic payments or a wallet. In particular, a pending transfer complaint is a reason to test honest status language, not a claim that this app can speed up settlement.

## Concrete scenarios and current evidence

Production source inspected: 579b4f6995a407796b38cdda1f9600e80bb32e2f. These are source-inspected mappings to existing regressions, not new runs or findings of new application defects. Test names are included so another reviewer can distinguish an implemented check from a proposed human observation.

| ID / review leads | Our Castle scenario and observable expectation | Existing source / remaining evidence |
| --- | --- | --- |
| R1 · GL08, GL13, SW09 | A fake pending contribution contributes zero. Completion adds once. A completed refund reduces progress once, while a raised building is explicitly a keepsake. Pending is never presented as a confirmed failure or withdrawable balance. | [journey.spec.mjs](../test/e2e/journey.spec.mjs): “cancel, decline and pending outcomes…” and “a refund lowers progress…”. [paypal-reconciliation.test.mjs](../test/unit/paypal-reconciliation.test.mjs): dashboard refund / late webhook. Human explanation of the receipt is still unobserved. |
| R2 · GB04, GB10, SW04 | Open the selected receipt from its existing route; locate its amount and saved check, then reload. Search, filters and selection must stay useful, even when optional Grid/Studio assets stall. Display must not silently call a provider. | [treasury.spec.mjs](../test/e2e/treasury.spec.mjs): receipt route within eight seconds, live transactions preserve state, pending/refund behavior. [confirmation-history.mjs](../server/steward/confirmation-history.mjs) keeps saved evidence local. Source coverage is not proof a newcomer finds it. |
| R3 · SW05, YN02 | Start an unsaved Plan edit. Navigate to another journal tab, return, then receive another member's update. Preserve the draft and require explicit review of changed goal facts. Never save or pay on return. | [shared-live.spec.mjs](../test/e2e/shared-live.spec.mjs): “work in progress survives…”. [plan-check.spec.mjs](../test/e2e/plan-check.spec.mjs): loading a newer goal preserves chosen fields and invalidates stale checks. Real mobile OS eviction/backgrounding is not covered by those browser cases. |
| R4 · GB09, YN07, SW04 | Read how much remains and the next contribution amount without subtracting totals mentally. Bills/gifts must not become goal credit; reported savings must not look like a bank balance. | [server/view.mjs](../server/view.mjs) exposes remainingCents; [main.js](../src/app/main.js) renders server amounts and the honesty footer. Journey coverage includes separate bills/gifts. Whether a person understands the distinction remains a playtest question. |
| R5 · SW01, YN04, GL01 | One adult can start a house before inviting others. Joining the same family shows shared progress; a separate family cannot read it; a child cannot approve a contribution. Do not remove sign-in checks to imitate a spreadsheet. | [family-access.spec.mjs](../test/e2e/family-access.spec.mjs): owner/adult/child and a separate family; expired/broken invitations. [shared-live.spec.mjs](../test/e2e/shared-live.spec.mjs): live updates and reconnects. Invite discovery without coaching is unobserved. |
| R6 · YN03, YN08, GB03 | Try a smaller weekly contribution or later date around entered commitments. Show an explicit plan estimate; checking a schedule cannot save, invoke a model or move money. Entered income is not independently verified. | [plan-check.spec.mjs](../test/e2e/plan-check.spec.mjs): read-only trials, invalid dates, current-record review and Enter behavior. “Affordable” is conditional on entered facts; no financial-outcome claim follows. |
| R7 · YN10, GB04, SW02 | Complete core record search, selection and receipt reading at 390 px, including the optional-assets fallback. Do not require a desktop to reach evidence. | Treasury and family access browser specs include phone layouts. They are emulated Chromium checks, not iOS Safari, physical-device or human legibility evidence. Receipt photography/OCR and iPad split-screen are outside this scenario. |
| R8 · GL13, SW09 | A local read fails after credit commits. The error must not assert that nothing was credited; a retry must guide the adult to the latest record. Keep raw errors and private fields out of diagnostics. | This was already independently reproduced and corrected in unmerged [PR #44](https://github.com/alejandro-publius/our-castle/pull/44) at fe80d5f. Research supports its priority; it did not discover the bug. Main still lacks that pending change. |

## Decisions from the research

1. Keep confirmation and recovery in the existing receipt/ledger surface. The strongest next technical experiment is combinations of pending, duplicate, delayed and refund evidence, using an independent cent-based model. Task009 does that on the separately reviewed payment branch; this document does not claim its result.
2. Preserve draft continuity and the compact navigation. A complaint about clutter is not evidence to add a tutorial wizard, more dashboards or another panel. Implement a change only after an Our Castle failure or observation identifies the missing step.
3. Observe comprehension before changing the family story again. The highest-value questions in the existing [playtest](PLAYTEST.md) are “What did that payment do?”, “How much is still needed?” and “What can the steward do?”. Ask after the task, record exact words, and do not explain the answer first. No participant results were collected here.

## What was and was not validated in this change

The corpus was checked for 45 distinct app/review IDs, valid 1–5 ratings, explicit non-future dates, source provenance and paraphrases no longer than ten words. Every included passage was read, including positive and out-of-scope entries. The mappings above were checked against source on the named commit.

This change adds research only. It does not change app behavior, repeat existing green browser/payment suites, create a provider order, or demonstrate human learning, improved savings, conversion, usability or production reliability. Existing PLAYTEST.md results remain pending. No owner process, configuration, database or sandbox order was used.
