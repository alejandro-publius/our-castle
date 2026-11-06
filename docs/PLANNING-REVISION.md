# Planning revision: fresh plans and the remaining-plan preview

Branch `claude/remaining-plan-revision`, from `main` 2e055c5. Backend only: there is no new screen, and `src/app/main.js`, `app.css`, `index.html` and the world files are untouched. Nothing here moves money, schedules a transfer, changes a contribution or grants a reward.

## 1. A plan must match the server's current facts

**Defect (reproduced first).** With the default $300 goal and $60 starting progress, `planner.proposeRules` built a proposal for $240 remaining. After a $15 example contribution, `planner.accept` accepted that unchanged proposal although only $225 remained.

**What the server compares.** A plan is built from these facts:
- household and goal;
- goal name, currency, amount, target date and weekly amount;
- reported starting progress, counted contributions (net of refunds) and tracked progress;
- the server's local calendar date.

The facts a plan used are read back from its existing `basis_json`, so there is no schema change or migration. `server/planner/facts.mjs` defines the facts, a `pf1_…` revision token (an optimistic-concurrency check, not authorization) and plain-language change messages.

**Behavior** (`server/planner/index.mjs`):

| Operation | Facts unchanged | Facts changed |
| --- | --- | --- |
| Accept a proposal | Accepted; other plans for the goal set aside (as before) | **409 `plan_stale`**, with `issues` listing what changed. Nothing is written: the plan in use, plans, ledger, payments and keepsakes are untouched |
| Accept the plan already in use | **No-op**: returns it and writes nothing (earlier code re-ran its updates and set aside any newer proposal) | Same no-op. An accepted schedule is history; `state.nextStep` keeps tracking contributions made since it was accepted |
| Edit any plan (makes a new proposal from its basis) | Validated and stored as before | **409 `plan_stale`**; nothing written |
| Propose (rules, or the AI provider after `await`) | Stored as a proposal | **409 `plan_facts_changed`**; the answer is dropped and no row is written. Facts are compared again inside the storing transaction |
| Goal edit (`updateGoal`, including a merchant goal save) | — | Unchanged: plans are set aside, so a later accept gets `plan_superseded` |

- **What makes a plan stale:** a counted contribution, a full or partial refund (simulated or PayPal-webhook), a starting-progress change made any way, a goal change, or local midnight.
- **What doesn't:** bills, gifts, pending, canceled or declined orders, member changes, and the other household's activity.
- **Scope:** every operation checks that the goal belongs to the household and the plan to the goal; a mismatch is a 404 and writes nothing.
- **Nothing is rewritten silently.** A stale proposal stays as it was, flagged, until the family asks for a fresh one.

**State.** `GET /api/state` (and every mutation's `state`) now includes `planReview` for `state.plan`:

```json
{
  "planId": "plan_…", "status": "proposed", "needsRefresh": true, "factsChanged": true,
  "changes": [
    { "code": "contributions", "message": "Counted contributions rose from $0.00 to $15.00." },
    { "code": "progress", "message": "Tracked progress is now $75.00; this plan used $60.00." }
  ],
  "planFactsRevision": "pf1_5f2546bd5ee2c34c2c6ee8d584bf75a1",
  "factsRevision": "pf1_50e1ffbc5fd4c69a3d976f4ff8ef61e8"
}
```

- **Change codes:** `contributions`, `progress`, `starting`, `target`, `target_date`, `weekly_amount`, `goal_name`, `currency`, `date`, `goal`.
- **Reading it:** `needsRefresh` is true only for a proposal. For the accepted plan, `factsChanged` is informational: it stays in use, and only an edit would need a fresh plan first.
- **No plan:** `planReview` is `null`.

`POST /api/plans/:id/accept` on a stale proposal:

```json
HTTP 409
{ "error": { "code": "plan_stale",
  "message": "This plan was made from earlier figures, so it can’t be used or edited as it is. Make a fresh plan from the latest progress and goal.",
  "issues": [ { "code": "contributions", "message": "Counted contributions rose from $0.00 to $15.00." },
              { "code": "progress", "message": "Tracked progress is now $75.00; this plan used $60.00." } ] } }
```

## 2. Remaining-plan preview

`server/planner/remaining.mjs` exports a pure `previewRemainingPlan({ goal, progress, today, weeklyBudgetCents?, targetDate?, planInUseId? })`. `planner.previewRemaining({ householdId, goalId, weeklyBudgetCents?, targetDate? })` adds the household/goal scope and current server progress.

**Route.** `POST /api/plans/preview` with `{ "weeklyBudgetCents"?: integer, "targetDate"?: "YYYY-MM-DD" }`. An omitted value uses the saved goal's own value. Previewing writes nothing and returns no `state`.

**What it returns:**
- **Schedule.** Exactly the built-in planner's schedule for those values. A test proves the preview equals `proposeRules` after `updateGoal` with the same values.
- **Rules:** whole cents and the existing 25/60/100% milestone rules. Dates are real calendar weeks from the server's local date; `addDays` is UTC-based, so daylight saving cannot shift them.
- **The chosen amount is a ceiling.** No week is planned above it. When it cannot meet the date, the preview reports:
  - the exact `shortfallCents`;
  - `requiredWeeklyCents`, for information only;
  - `reach`: when the chosen amount would cover the remainder.
- **52-week bound.** Weeks are capped at 52, and a `reach` longer than that is reported with `withinPlanningLimit: false` and no date.
- **Input limits** are the goal editor's own, so any previewed value can be saved unchanged:
  - a weekly amount of $0.00 up to the goal amount;
  - a date from 7 to 366 days ahead.
- **Outcomes:** `on_track`, `short`, `no_budget` ($0 a week: nothing planned; the remainder stays unplanned) and `reached` (empty schedule; `overfundedCents` when progress exceeds a lowered goal).
- **Nothing assumed:** the preview never infers income, bills or funds.

Request `{ "weeklyBudgetCents": 2000 }` after a $15 contribution (default goal, Nov 3, 2026):

```json
{ "status": "ok", "preview": {
  "kind": "remaining-plan-preview", "saved": false, "outcome": "short",
  "facts": { "factsRevision": "pf1_50e1ffbc5fd4c69a3d976f4ff8ef61e8", "today": "2026-11-03", "goalId": "goal_demo", "goalName": "Camping trip fund",
             "currency": "USD", "targetCents": 30000, "startingCents": 6000, "confirmedCents": 1500, "progressCents": 7500,
             "remainingCents": 22500, "overfundedCents": 0 },
  "savedSettings": { "weeklyBudgetCents": 3000, "targetDate": "2026-12-29" },
  "requested": { "weeklyBudgetCents": 2000, "targetDate": "2026-12-29", "weeklyBudgetChanged": true, "targetDateChanged": false },
  "weeks": 8, "planEndDate": "2026-12-29",
  "schedule": [ { "week": 1, "date": "2026-11-10", "amountCents": 2000 }, "… 6 more weeks at 2000 …", { "week": 8, "date": "2026-12-29", "amountCents": 2000 } ],
  "totals": { "plannedCents": 16000, "shortfallCents": 6500, "feasible": false, "remainingCents": 22500 },
  "requiredWeeklyCents": 2813,
  "reach": { "weeklyCents": 2000, "weeksNeeded": 12, "date": "2027-01-26", "withinPlanningLimit": true },
  "milestones": [ { "key": "manor", "name": "Manor", "percent": 25, "targetCents": 7500, "reached": true, "week": 0, "date": null },
                  { "key": "keep", "name": "Keep", "percent": 60, "targetCents": 18000, "reached": false, "week": 6, "date": "2026-12-15" },
                  { "key": "castle", "name": "Castle", "percent": 100, "targetCents": 30000, "reached": false, "week": null, "date": null } ],
  "planInUseId": null,
  "notes": [ "8 weeks of $20.00 by Dec 29, 2026 cover $160.00, leaving $65.00.",
             "Reaching the goal by Dec 29, 2026 needs at least $28.13 a week.",
             "At $20.00 a week the remaining $225.00 is covered by Jan 26, 2027 (12 weeks).",
             "This is a preview: nothing is saved, the plan in use stays as it is, and no money moves." ] } }
```

- **Re-previewing at `reach.date`** with the same $20.00 gives `on_track`: eleven weeks of $19.00 and one of $16.00, with Keep reached on Dec 15 and Castle on Jan 26.
- **Invalid input** is HTTP 400 `invalid_plan_inputs` with `issues` codes `weekly_amount` and/or `date`.
- **When the saved date is under a week away,** the preview asks for a new date rather than choosing one.

## Isolated example (no keys, no network)

```
cd ~/projects/our-castle-planning
node scripts/plan-revision-example.mjs          # readable walkthrough
node scripts/plan-revision-example.mjs --json   # every request and full response body
```

- **Environment:** a fresh in-memory example household on 127.0.0.1 with a fixed server date (Nov 3, 2026). It never reads `.env`, and calls no PayPal, AI or other provider. The single contribution is a labeled simulated example payment.
- **Steps it runs:**
  1. proposal;
  2. contribution;
  3. `planReview`;
  4. the refused accept;
  5. three previews and an invalid one;
  6. a table-by-table proof that steps 3–5 wrote nothing;
  7. a fresh $225 plan accepted.

## Frontend integration

The combined family-planning pass wires this contract into the existing Plan journal. **Check schedule** reads the current weekly/date fields and calls only the read-only endpoint; **Try [date]** changes only the form. The accepted schedule remains visibly **in use** until an explicit new-plan action replaces it. No model or provider call runs on typing, Enter in those two fields, calculation or reload.

A stale proposal cannot be accepted or edited. A refused accept/edit or an answer prepared against changed facts reads local state once and points to the existing Make-plan action, without retrying the model. A schedule check against newer server facts offers **Load latest goal**, retaining unsaved amounts, dates and bill rows. Merchant drafts immediately clear the old calculation and require their existing save/discard decision.

Implementation: `src/app/plan-check.js`, `renderPlan`, `refreshPlanGoal` and `showPlanError` in `src/app/main.js`. [Interface lock, independent review and focused integration evidence](FAMILY-PLAN-REVIEW.md). The table below records the original backend PR's checks, separately from those subsequent UI checks.

## Checks run (all local, fake or simulated transports)

| Check | Result |
| --- | --- |
| `test/unit/planning-revision.test.mjs` (new, 17 cases) | 17/17 pass |
| Same file against the original planner/view/app | 17/17 fail (the preview cases fail because the feature did not exist) |
| Five defects re-inserted one at a time | Each is caught by its targeted test, and all pass again after restoring. The five: no facts check before storing; no check on accept; re-accept re-running writes; no date comparison; no check on edit |
| Relevant unit contracts: planner, server, journey, merchant, Treasury, demo, steward, payments, plus the new file | 109 cases: 108 pass, 1 existing intentional skip (SDK OAuth caching) |
| Full unit suite (run once because `buildState` is shared) | 232 cases: 230 pass, 1 skip, **1 failure that also fails on unmodified main 2e055c5.** `member-avatars.test.mjs:56` expects schema version 3, but main has 4 migrations (`order_checks`). Not changed here |
| Browser: `family-journey.spec` and `connected-journey.spec`, desktop and phone, example mode | 16 passed, 4 viewport-specific skips |
| `npm run check` | 47 files, 90-colour palette, renderer wiring and syntax verified |
| `node scripts/plan-revision-example.mjs` | Output as described above |

**Regression coverage in the new file:**
- the reproduced defect;
- refused operations leaving every table byte-identical;
- full refunds (simulated) and partial refunds (fake-sandbox webhook);
- goal and starting-progress edits;
- local-midnight rollover;
- a scripted model answer arriving after a contribution, refund, goal edit, starting edit or midnight;
- accepted-plan history and idempotence;
- two-household scope;
- preview equality with the built-in plan;
- preview writes nothing;
- shortfall, reach, zero, reached and overfunded outcomes;
- the 52-week bound;
- odd-cent rounding;
- input limits;
- daylight saving, year end and leap day;
- the HTTP contract.

No PayPal order, refund or lookup, no paid AI or search call, no recording, and no deployment. The owner's 3010 app, the 3021 rehearsal and their data and `.env` files were not touched.
