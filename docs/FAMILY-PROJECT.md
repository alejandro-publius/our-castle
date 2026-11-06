# Family project — the campsite in the west meadow

November 5 PST / November 6, 2026 UTC. Direct build in the current woodland, following the November 6 product note in [AWARD-STRATEGY.md](AWARD-STRATEGY.md): a shared family project with visible staged construction, in the spirit of FarmVille's build quests, with none of its paid speedups, spending streaks or penalties.

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

`npm run demo`, then **Whole realm** and the small tent at the west edge, or **Areas → Hearth Village** and look west. The example household starts at $60 of $300: survey stakes with the path already cleared. **Contribute** $15 (simulated) for the construction site; $120 more for the furnished campsite; $120 more for the gathering place. A simulated refund from the Ledger sets it back; editing the goal to a larger amount in **Plan** reopens an earlier stage.

## Actual checks

Captures: [before, whole realm](screenshots/family-project-before-whole-realm.png) · [before, village view](screenshots/family-project-before-village.png) · [after, village view](screenshots/family-project-after-village.png) · [survey](screenshots/family-project-survey.png) · [construction at 40 %](screenshots/family-project-construction-detail.png) · [furnished](screenshots/family-project-furnished.png) · [gathering place](screenshots/family-project-gathering.png) · [gathering place at night](screenshots/family-project-gathering-night.png) · [phone](screenshots/family-project-phone-gathering.png). All from fresh example households; none is a live payment.

Unit: `test/unit/family-project.test.mjs` sweeps every $0.50 of a $300 goal against the server's own tier and milestone arithmetic, pins the exact 10/25/40/60/80/100 % boundaries and their whole-cent rounding, checks a refund and a larger goal step back, invalid inputs read as an untouched survey, and the site is a flat, dry frontier meadow that overlaps no district or discovery.

Browser (`test/e2e/family-project.spec.mjs`, desktop 1440×1000 and 390 px touch phone, reduced motion): the four stages and the 40 % detail through simulated contributions with a reload between each, the status line and marker, no Areas entry, the fire still under reduced motion, a refund stepping back while the home tier stays at castle, a $1,000 goal reopening the survey, no page writes, no page errors and no horizontal overflow. A normal-motion case checks night glow and the campfire moving on the ambient clock with the household's records unchanged. The existing `woodland-legends`, `realm`, `earned-realm` and `realm-focus` suites still pass. No full suite, provider call, payment or video was run.
