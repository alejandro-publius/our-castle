# Family choices

A family compares up to three items against the weekly amounts its adults choose to offer. Each member can express one preference. Trying an unexpected expense shows the resulting dates and which lower-priced choices still fit the goal's date. A chosen item and expense can then become a dated weekly schedule. The adults review it, and only "Use this plan" puts it in use.

This feature is in the source branch awaiting integration. The preserved owner and rehearsal demos have not been activated with it.

## Use it

1. Open Plan → Family choices. With Channel3 configured, choose Find an item, search in Market Town and use Add to family choices. Adults can replace or remove a choice.
2. Each adult enters and explicitly saves their own weekly offer. Offers are visible to the family, and can be withdrawn. Children can express a preference without making an offer.
3. Compare the price, finish date, deadline shortfall and each adult's weekly share. Preference counts express wishes; they never authorize a payment.
4. Try a one-off expense. It uses future weekly capacity once, beginning with the first week. Each item shows its finish with the trial and the date without it. Typing sends no request and saves nothing.
5. Review this choice fills the existing unsaved goal form and previews the family schedule: each dated week, what the expense takes and each adult's share. Save as our goal changes only the goal. **Save goal and propose this schedule** saves the goal and proposes those same weeks, together. Changed offers, prices or goal facts require another review.
6. In the Plan, the proposal is labelled **Family schedule**. Its table shows every week's amount with each adult's share or the expense note. **Use this plan** puts it in use, as for any plan; the next contribution and the Treasury's week then follow its dates.
7. **Propose this schedule** on the current goal makes a later proposal without changing the goal. Any one-off amount must be entered again; none is carried over.

Without Channel3, the current goal can still be compared with the adults' offers. No example catalogue is silently installed. The screenshots below use invented products served by fake transport, not live retailer quotes.

## Worked example

These are synthetic figures: November 8, 2026, $60 of recorded progress, a $30 household weekly limit, adult offers of $20 and $10, and a December 20 target date. Week 1 is November 15.

| Item price | Finish with no extra expense | Finish with a one-off $90 expense | Shortfall on December 20 after the expense |
| --- | --- | --- | --- |
| $120 | November 22 | December 13 | $0 |
| $150 | November 29 | December 20 | $0 |
| $180 | December 6 | December 27 | $30 |

The expense consumes the first three $30 weeks once. The adults' offers stay unchanged. A small expense can leave the same finish date; the interface says that instead of inventing a delay.

Choosing the $150 tent with the $90 expense saves this schedule. The previous handoff instead produced the ordinary built-in plan of $15 in each of the six weeks, which dropped the expense:

| Weeks | Dates | To the goal each week | Each adult's share | Note |
| --- | --- | --- | --- | --- |
| 1–3 | November 15–29 | $0 | — | Each week's $30 goes to the one-off expense |
| 4–6 | December 6–20 | $30 | Rowan $20 · Ash $10 | Covers the remaining $90 by December 20 |

The next planned contribution is week 4, December 6, $30. The Treasury plans $0 for an expense week (checked for the week of November 9) and $30 for the week of December 6. The $180 tent at the same December 20 date covers only $90 of $120, $30 short. Its review offers December 27, the earliest finish at the same offers, for the family to accept or change. No offer is raised.

| Comparing the options | Trying the expense on a phone |
| --- | --- |
| ![The family compares tent prices, dates and preferences beside the woodland](screenshots/family-choices-desktop-three.png) | ![The $180 tent finishes three weeks later with the $90 expense, with the original date shown](screenshots/family-choices-phone-one-off.png) |

[All four captures and source hashes](screenshots/family-choices-sources.json).

## Preview, proposal, plan in use

1. **Preview.** Review this choice fills the unsaved goal draft and lists the weeks it would propose. Typing the expense or reviewing writes nothing.
2. **Proposal.** Save goal and propose this schedule saves the goal and the same weeks as a proposal, in one save. Nothing is in use, so there is no next contribution yet.
3. **Plan in use.** Use this plan accepts it. Every family member, and a reload, then sees the same dated weeks and shares.

| Preview in the goal draft | Family schedule in use | The same plan on a phone |
| --- | --- | --- |
| ![The unsaved goal draft lists weeks 1–3 at $0 for the $90 expense, then $30 a week split $20 and $10](screenshots/family-schedule-desktop-preview.png) | ![The accepted family schedule: three $0 expense weeks, then three $30 weeks with each adult's share](screenshots/family-schedule-desktop-in-use.png) | ![The accepted family schedule on a 390 px phone](screenshots/family-schedule-phone-in-use.png) |

[All five captures and source hashes](screenshots/family-schedule-sources.json).

## How the plan is calculated

Weekly capacity is the lower of the household limit and the sum of active adults' offers. These are voluntary ceilings, not verified income or money held by the application. Each week's amount is split proportionally; whole-cent remainders use a stable member-order tie break. The final week takes only what remains, and the comparison stops at 52 weeks.

The expense is reserved from future capacity once. It is not subtracted from recorded progress, treated as a refund or deducted as a recurring bill. Listed household bills remain context.

The trial is local to that member, household and goal. An invalid amount keeps the last valid comparison visible, reports the supported range and prevents reviewing it until corrected. Editing or clearing also cancels any pending review so an older response cannot reopen a draft. A valid amount or Clear restores review. Neither action makes a provider request.

Review copies a suggested total, date and weekly ceiling into a draft, and previews the schedule those values give. The adult may edit those fields; an edited amount, date, weekly amount or starting report no longer matches the preview, so only Save as our goal remains.

**Save goal and propose this schedule** sends only the one-off amount and the preview's revision. The server recomputes every week from its own records. If any figure differs, the whole save is refused, so neither the goal nor the proposal is written alone.

The saved schedule has one row for each week up to the goal's date (at most 52):
- the amount for the goal;
- the part of that week's open amount that goes to the expense;
- each adult's share.

The weeks given to the expense stay in it as $0 goal weeks with a short note.

**Use this plan** is still the separate decision. A proposal is refused there if any of these changed: an offer, the active adults, the source item's price, the goal, progress or the date. An accepted schedule keeps its dates. A reload or a new day never takes the expense again, and the app never assumes the expense was paid. Ordinary built-in and AI plans are unchanged and do not include a one-off amount.

A family schedule is stored with the existing plans, as deterministic built-in arithmetic, never as AI output. It is not edited week by week, because a typed amount could exceed someone's offer. The family proposes a new one instead.

## Why this direction

- [Fidelity's 2026 Couples & Money study](https://newsroom.fidelity.com/pressreleases/fidelity--findings--most-couples-feel-confident-about-money%E2%80%94but-there-could-be-more-to-talk-about/s/3561728d-cc8f-4cbf-8c90-3090323e7708) surveyed 3,193 U.S. partnered adults; 58% reported unequal household contributions. That supports allowing individual comfortable amounts instead of assuming equal shares. It is sponsored self-report research, not validation of this app.
- [Airbnb's collaborative wishlists](https://www.airbnb.com/help/article/1236) already offer notes and voting. [YNAB Together](https://www.ynab.com/terms/ynab-together) already supports shared budgets. The feature's hypothesis is the connected choice-and-replanning loop; it does not claim those ingredients are new.
- [PayPal's 2025 Investor Day](https://s205.q4cdn.com/901458612/files/doc_downloads/transcript/PayPal-Investor-Day-2025_Full-Transcript.pdf#page=5) used shared camping costs and equipment shopping to illustrate its commerce strategy. This is relevant product context, not PayPal endorsement or proof that a described API is public.

The visual foundation stays the existing woodland and compact parchment journal. The design research adapted only comparable wishlist facts, clear own-member responses and an explicit final review from Onefinestay, SavvyCal and Airbnb. No third-party branding or artwork was copied.

## Boundaries and remaining questions

Prices retain retailer, variant, condition and last-check facts. Tax and shipping are extra. A stale or changed offer needs an explicit price check; review and save use the server's own item and comparison records.

Recorded progress is not a spendable family balance. This prototype's merchant sandbox captures do not buy the shortlisted retailer item. Who receives real funds and who completes the eventual purchase remain product decisions; no new pool, wallet or retailer payment is introduced here.

A schedule built from an offer is still a planning ceiling the adult chose to show, not a promise, income, a held balance, a mandate or a payment approval. Each contribution still needs an adult's approval in PayPal. A child can see the schedule and keep a preference, but cannot propose or use one.

The implementation adds three planning-only tables in schema 9. The family schedule adds no table or migration: it uses the existing plan records. Its tests use disposable databases, fake Channel3 responses, simulated payments and virtual passkeys. [Validation](VALIDATION.md) records the actual checks. No family playtest, physical-device validation or claimed improvement in family outcomes is implied.
