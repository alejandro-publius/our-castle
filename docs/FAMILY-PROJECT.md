# Family project — the campsite in the west meadow

November 5 PST / November 6, 2026 UTC. Direct build in the current woodland, following the November 6 product note in [AWARD-STRATEGY.md](AWARD-STRATEGY.md): a shared family project with visible staged construction, in the spirit of FarmVille's build quests, with none of its paid speedups, spending streaks or penalties.

Since November 6 the family can also choose to build a **garden** or a **schoolhouse** on the same meadow; see [What the family builds](#what-the-family-builds). The campsite below is unchanged and remains the default.

## Reference lock

The existing world is primary: the original pixel renderer and 90-colour palette, the shared geometry/material batches, the district cottages, tents of the same gable prism as every roof, the Citadel stag's rod helper for logs, `models.cottage`/`roof`/`lantern`/`shield`/`bunting`, and the sword grove's quiet glint marker. The site is the existing unbuilt west meadow at (−98, 26), beside Hearth Village: flat, dry, 24×24 and not a district. Every district, building, bridge, river, cloud, animal and character is unchanged.

| Decision | Role |
| --- | --- |
| Stages come from the server's progress and goal through the existing rules (`tierForProgress`, `milestoneCents`) | No balance, reward entry, payment threshold or separate counter |
| Stage boundaries are the home milestones 0/25/60/100 %; the extra detail within a stage is the estate milestone that falls inside it (10/40/80 %) | Seven visible steps from thresholds the family already knows |
| The project follows **current** progress | A refund or a larger goal sets it back truthfully; earned homes remain the keepsakes |
| One small tent marker on the map; selecting it moves the camera and names the stage | Fits the existing legend pattern; no panel, card, catalogue or new text |
| Only `groups.project` is rebuilt when the stage or crest changes | The landscape, districts and bridges are not touched |
| Campfire flame and smoke move on the existing ambient clock | Reduced motion keeps them still; open cards pause them; nothing else is animated |

## The four stages

| Stage | Reached at | What is built |
| --- | --- | --- |
| Survey stakes | goal set (0 %) | Eight stakes and string around the plot, a stump with the rolled plan, a stone pile. At 10 %: the cleared path and a signpost with the household crest. |
| Under construction | 25 % | Stone foundation, timber frame, sawhorses and a plank, lumber, crates, wheelbarrow, water barrel. At 40 %: rafters, half walls and the family's first tent in the crest colour. |
| Furnished campsite | 60 % | The finished cabin (lit windows at night), two tents, a stone fire ring with a lit fire, log benches, picnic table and firewood rack. At 80 %: lanterns, flower boxes and a picnic blanket. |
| Gathering place | 100 % | Everything above, a ring of benches, an open pavilion with a tiled roof in the crest colour and a long table, bunting, a flagpole and one more lantern. |

Source: `src/core/family-project.js` (pure stage rule and site) and `src/world/family-project.js` (geometry and the two live parts). Wiring: `src/world/board-scene.js` (one group, rebuild on change, focus and marker projection) and `src/app/main.js` (the stage passed with the board state, the marker, the status line).

## How to try it

`npm run demo`, then **Journal → Plan → Visit campsite** (the line above the goal names the current stage), or **Whole realm** and the small tent at the west edge, or **Areas → Hearth Village** and look west. The example household starts at $60 of $300: survey stakes with the path already cleared. **Contribute** $15 (simulated) for the construction site; $120 more for the furnished campsite; $120 more for the gathering place. A simulated refund from the Ledger sets it back; editing the goal to a larger amount in **Plan** reopens an earlier stage.

## Actual checks

Captures: [before, whole realm](screenshots/family-project-before-whole-realm.png) · [before, village view](screenshots/family-project-before-village.png) · [after, village view](screenshots/family-project-after-village.png) · [survey](screenshots/family-project-survey.png) · [construction at 40 %](screenshots/family-project-construction-detail.png) · [furnished](screenshots/family-project-furnished.png) · [gathering place](screenshots/family-project-gathering.png) · [gathering place at night](screenshots/family-project-gathering-night.png) · [phone](screenshots/family-project-phone-gathering.png). All from fresh example households; none is a live payment.

Unit: `test/unit/family-project.test.mjs` sweeps every $0.50 of a $300 goal against the server's own tier and milestone arithmetic, pins the exact 10/25/40/60/80/100 % boundaries and their whole-cent rounding, checks a refund and a larger goal step back, invalid inputs read as an untouched survey, and the site is a flat, dry frontier meadow that overlaps no district or discovery.

Browser (`test/e2e/family-project.spec.mjs`, desktop 1440×1000 and 390 px touch phone, reduced motion): the four stages and the 40 % detail through simulated contributions with a reload between each, the status line and marker, no Areas entry, the fire still under reduced motion, a refund stepping back while the home tier stays at castle, a $1,000 goal reopening the survey, no page writes, no page errors and no horizontal overflow. A normal-motion case checks night glow and the campfire moving on the ambient clock with the household's records unchanged. A third case uses the Plan link by touch and keyboard: the journal closes, the meadow is focused, focus lands on the marker, the status names the stage, the line follows a contribution and nothing is written ([desktop Plan](screenshots/family-project-plan-visit.png) · [phone Plan](screenshots/family-project-phone-plan-visit.png) · [phone after the visit](screenshots/family-project-phone-after-visit.png)). On the merged branch the `treasury-status`, `payment-recheck`, `confirmation-history`, `journey` and `woodland-legends` suites pass (37 cases, 1 pre-existing skip), as do the `realm`, `earned-realm` and `realm-focus` suites from the earlier run. No full suite, provider call, payment or video was run.

## What the family builds

November 6, 2026. An explicit family choice in the existing Plan goal editor: **Build** — Campsite, Garden or Schoolhouse. It continues the idea of a shared goal becoming a visible place in the realm. It is a picture of the goal, not a reward, district, earning mechanism or claim about anything built or bought outside the game.

| Decision | Role |
| --- | --- |
| One compact native select labelled "Build", right after the goal's name | No wizard, preview banner, card or extra notice; 44 px touch target; keyboard order Goal → Build → amounts |
| Saved only with the goal's normal save: the Plan action (Make a plan / Ask the planner) or a confirmed market item (Save as our goal) | Choosing writes nothing and previews nothing; the world and the stage line show the saved choice only |
| The page sends the choice only when the family changed it | An untouched form never reverts a newer choice another member saved; "Load latest goal" refreshes an untouched choice like the other goal fields |
| `goals.project_kind`, additive migration 5: `NOT NULL DEFAULT 'campsite'`, `CHECK` to the three values | Every existing goal stays a campsite; nothing is inferred from goal names, merchant results or model output |
| Validated before any write; with changed figures it is part of the same validated goal update; alone it updates only the picture | Amounts, dates, starting report, plans (the accepted one too), milestones, roles, approvals, ledger and merchant provenance are untouched; a refused value changes nothing |
| Never part of the planner's basis or the steward's context | Provider calls are exactly what the Plan action already makes; the kind never reaches a model |
| Same site, same stages and the same 10/40/80 % details | Every place follows current server progress: a refund or larger goal sets it back; earned homes remain |
| Only `groups.project` is rebuilt when the choice changes; the camera frame and marker use each place's height | The schoolhouse bell tower and the garden's glasshouse ridge stay clear of the marker; travelers, homes, districts and the view are not reset |

Because the choice is saved by the normal Plan action, saving a Build change also prepares a fresh proposal from the same figures, exactly as pressing that action always does. The plan already in use stays in use (the server keeps it accepted) until the family chooses **Use this plan**; in live AI mode that save asks the planner as any Plan save would.

| Stage | Garden | Schoolhouse |
| --- | --- | --- |
| Survey stakes (0 %; 10 %) | The stakes, two seed sacks, a spade and a seedling tray. At 10 %: the signpost and the beds' and glasshouse's outlines cleared. | The stakes and a slate board on its easel. At 10 %: the signpost, the building's footprint and the yard cleared. |
| Under construction (25 %; 40 %) | The glasshouse's stone knee wall and timber frame, two stone-edged beds, glass panes waiting in a crate. At 40 %: rafters at the roof's pitch, the first glass (back wall and west gable), seedlings and the gravel path. | The same building's timber frame on its foundation, and the bell waiting on a timber cradle. At 40 %: rafters and ridge, red clapboard to sill height, window frames and the belfry's posts. |
| Planted garden / Finished schoolhouse (60 %; 80 %) | A glazed timber glasshouse (half-glass door, open roof vent), four stone-edged planted beds, gravel paths with a bird bath where they cross, a water butt, compost bin and pots. At 80 %: lanterns, flower boxes and a bench. | Red clapboard with cream trim, a slate roof, the bell hung in a belfry over the door, a porch with steps, three tall windows a side, a chimney, slate board and bench. At 80 %: lanterns, a tree and a second bench. |
| Garden in bloom / Gathering place (100 %) | Flowers on every bed, a rose arch over the path, two fruit trees, the household flag and bunting. | Swings, the household flag and bunting. |

At night the schoolhouse's windows, transom and gable window and the glasshouse's door pane light, with the existing lanterns. The garden and schoolhouse have no moving parts; the campfire stays the only live element, on the existing ambient clock.

Source: `src/core/family-project.js` (choices, names, heights), `src/world/family-project.js` (the two new places; the campsite model emits the same parts as before), `src/world/board-scene.js` (frame and marker per place), `src/app/main.js` + `index.html` + `app.css` (the Build field, labels, marker icon), `server/db.mjs`, `server/household.mjs`, `server/app.mjs` (storage and validation).

Captures (fresh example households, isolated no-key server, Chromium/SwiftShader; [provenance](screenshots/goal-projects-sources.json)): [Plan with Build](screenshots/goal-projects-plan-desktop.png) · garden [under construction 40 %](screenshots/goal-projects-garden-construction.png), [planted](screenshots/goal-projects-garden-planted.png), [in bloom](screenshots/goal-projects-garden-bloom.png), [at night](screenshots/goal-projects-garden-night.png) · schoolhouse [under construction 40 %](screenshots/goal-projects-schoolhouse-construction.png), [finished](screenshots/goal-projects-schoolhouse-finished.png), [gathering place at night](screenshots/goal-projects-schoolhouse-night.png) · phone [garden](screenshots/goal-projects-phone-garden.png), [schoolhouse](screenshots/goal-projects-phone-schoolhouse.png). These are example-mode pictures, not family playtest observations.
