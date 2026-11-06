# Rachel: start here

**rachelselbrede already has write access.** Use your own clone and one branch per task; no fork or runtime API keys are needed.

## Run

Node 22.16+:

```sh
git clone https://github.com/alejandro-publius/our-castle.git
cd our-castle
npm ci
git switch -c rachel/tavern-detail
npm run demo
```

Open the printed localhost URL. This separate example game ignores credentials and saved households. Keep its terminal running; use another for Git. On an existing clean clone, switch to `main` and `git pull --ff-only` first. Repeat `npm ci` only when the lockfile changes.

## Choose one task

| Suggested task | Read/edit boundary | Finish line |
| --- | --- | --- |
| **First choice: tavern detail** | `src/world/tavern.js`, `docs/TAVERN.md` and its screenshot | One restrained detail, such as carved mug-sign trim; preserve the house, table and three guests |
| Phone playtest | `docs/PLAYTEST.md`; manually run the game | Actual observations and one reproducible issue, or no issue found |
| Submission story | `docs/SUBMISSION-DRAFT.md`, `docs/IN-APP-SANDBOX-VERIFICATION.md` | Clear family problem; preserve the factual integration/recording limits |

Tell Alex your choice. Codex is currently handling fairy/terrain, payment, sponsor and shared app/core work; coordinate before editing those. Start a **single-task Claude session**, not a full-project rebuild.

## Paste into Claude

> Read AGENTS.md, CLAUDE.md and START-HERE-RACHEL.md. Use branch rachel/tavern-detail. Inspect src/world/tavern.js, docs/TAVERN.md and its screenshot. Make one small tavern improvement, preserving the renderer, palette, building and guests. Limit changes to two task files plus one screenshot; coordinate before touching shared files. Use no new dependency or runtime provider call. Run syntax and one relevant existing smoke check, show the actual result, then commit/push this branch and open a PR. Don't scan every document, rerun the whole suite, merge main, deploy or submit.

## Share

```sh
git diff --stat
git add src/world/tavern.js
git commit -m "Refine tavern mug-sign trim"
git push -u origin rachel/tavern-detail
```

GitHub: **Compare & pull request → base: main**. Include one screenshot and checks actually run. Merge after review. Keep `.env`, household data and recordings out; never force-push shared branches.
