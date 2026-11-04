# The one owner-recorded insert

The draft reserves **2:00.36–2:24.36** for an honest recording of the three checks not yet captured together. It currently shows an unfilmed slate. Nothing in the existing footage proves these outcomes.

Do this only when the owner is available and chooses to create a new sandbox order and use the steward. It requires a sandbox buyer approval and a paid runtime AI request. **No order or AI request was created to prepare this draft.**

## Record in an isolated rehearsal copy

Keep the existing household on port 3010 unchanged. The configured Mac already has the required sandbox credentials and AI key; do not request another key or rerun the earlier paid planner/verifier tests.

```sh
cd ~/projects/our-house
OUR_CASTLE_DATA_DIR="$(mktemp -d)" PORT=3021 npm start
```

Stop on `EADDRINUSE`; never reuse the server on that port. This copy reads the existing `.env` but uses a fresh database. Confirm the badges say PayPal sandbox and live AI. Set up the demonstration household and the $300 goal with $60 **self-reported** starting progress. This is a goal-progress ledger, not a bank balance.

Use the current six-district overview. Do not switch to the owner's household if the button fails. Keep the owner’s developer dashboard, `.env`, API keys, passwords and other account information off screen. Sign into the sandbox buyer before the take if needed.

## Capture one continuous take, then trim only waiting

Record approximately 60–90 seconds continuously. Keep an untouched original. A 24-second insert can use three eight-second beats; it may expand to **40 seconds**, keeping the whole cut at approximately **2:52.36**. Mark removed waits in the source notes.

| Insert time | Actual action to record | Evidence that must be legible |
| --- | --- | --- |
| 0–8 s | Approve the $15 contribution as an adult, press the in-app PayPal button, and complete the sandbox buyer approval in its popup | Actual in-app origin and real approval interaction. A hosted approval page alone does not establish the v6 popup callback |
| 8–16 s | Return to the app and show the server-confirmed receipt and Manor bridge | Matching order/capture identifiers, $15 USD, confirmed provenance, tracked progress $60→$75, actual bridge lowering with the village retained |
| 16–24 s | Ask “Did PayPal confirm our last contribution?” in the Ledger tab | A real `get_order` check for that same household order and the server-backed outcome. A ledger read or `list_transactions` call alone is insufficient |

Do not claim success just because a redirect or PayPal confirmation page appeared. The app must verify capture server-side and credit once. If any step fails, retain the unfinished slate, record what failed, and diagnose it in the isolated copy. Do not paste in an imagined receipt, synthetic tool result, old capture or staged browser message.

The refund button is optional and is not needed in this short insert. Historical server-side refund evidence is already identified separately in the cut.

## After a successful take

1. Keep the untouched recording and note its source commit, UTC date, modes, order/capture IDs, tool checked and edits. Do not include credentials.
2. Replace the slate with the real excerpt and replace the **draft instructional narration and captions**. A possible narration, **only if the recording establishes it**, is: “Here is the sandbox approval from the app. This receipt matches the captured amount and its order. The steward checks that same order through PayPal’s read-only tool. The Manor bridge opens, while the village stays.”
3. Add the source hash and crop/time ranges to `sources/manifest.json`, adjust `timeline.json` and regenerate measured narration/captions. Confirm the export remains below three minutes.
4. Update the project validation and handoff with the actual result. Until then, the popup path and specific-order reconciliation remain unverified.
5. Owner review still precedes art licensing, publishing, uploading or submission. This guide does not authorize those actions.
