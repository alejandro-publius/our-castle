# Rachel: start here

**rachelselbrede already has write access.** Your campsite PR #8 and its Plan integration PR #10 are merged, alongside the reviewed Treasury work. Continue any active branch/session first; preserve its uncommitted work. The next non-overlapping task is actual family playtesting, followed by one demonstrated blocker fix if needed. Use your own clone; no fork or runtime API keys are needed. [Current review/evidence guide](docs/JUDGE-HANDOFF.md).

## Run

Node 22.16+:

```sh
git clone https://github.com/alejandro-publius/our-castle.git
cd our-castle
npm ci
git switch -c rachel/family-playtest
npm run demo
```

Those commands are for a new clone. In the existing playtest clone/session, keep its branch and running demo; inspect `git status` before switching or pulling, and preserve uncommitted observations. Open the URL printed on **Rachel's Mac** in that Mac's browser; a localhost link points to the machine where it was started. This separate example game ignores credentials and saved households. Keep its terminal running; use another for Git. Repeat `npm ci` only when the lockfile changes. Start a fresh demo for the next person only after the observer has collected the current person's notes.

## Current task

| Work | Read/edit boundary | Finish line |
| --- | --- | --- |
| Observe the family journey | `docs/PLAYTEST.md`; manually run the game | Actual anonymous task completion, hesitation/help and quotes, including what the tester thought the payment did |
| Fix one demonstrated blocker, if found | Scope the reproduced issue before editing shared files | One focused correction, relevant verification and a PR; or a truthful report that no blocker was observed |

Keep the current Claude session. The campsite has a quiet **Visit campsite** entry in Plan; **Check schedule** tries amounts/dates without saving, and old proposals cannot be accepted after the facts change. Do not rebuild those pieces or rerun paid provider checks. Coordinate before changing shared app/server files; keep a focused branch and PR. The earlier tavern-detail suggestion is superseded. A playtest completion message alone is not an observation or proof of success.

## Paste into Claude

> Read AGENTS.md and START-HERE-RACHEL.md. Continue the existing rachel/family-playtest branch and running demo. Use the three tasks in docs/PLAYTEST.md without coaching the tester. Ask Rachel for actual observations, record them anonymously and leave missing results pending. If nobody is available or no notes have been supplied, keep the demo ready and wait; do not substitute an automated run or invent a result. Once observations exist, reproduce and fix only the most consequential blocker, if any, preserving the current art and payment rules. Run only verification relevant to that fix; documentation-only results need no product suite. Push this branch and open a focused PR with real evidence. Do not merge, deploy, submit, start another Claude session, add features or run paid services.

## Share

```sh
git diff --stat
git add docs/PLAYTEST.md
git commit -m "Record observed family playtest findings"
git push -u origin rachel/family-playtest
```

Run the share commands only after actual observations exist. Stage any reproduced fix files explicitly as well. GitHub: **Compare & pull request → base: main**. Include anonymous findings, the specific correction if needed and checks actually run; leave untested participants pending. Merge after review. Keep `.env`, household data and recordings out; never force-push shared branches.
