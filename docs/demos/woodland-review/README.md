# Our Castle — family journey and woodland review

A private, local review draft using the green forest realm and the clearer family journey. **The sandbox popup and same-order steward insert remain unfinished.** This is not a submitted or fully verified end-to-end demo.

The checked export and editable timeline are **2:51**, with a visible 24-second unfilmed insert at **2:17–2:41**. The export was fully decoded: 4,275 video frames, AAC narration and 37 checked caption cues. The older 36-second island clip and 2:36 review kit remain unchanged as historical versions.

## Evidence in the cut

- **New recorded local app:** actual scripted interactions with an isolated example-only server and fresh test data. Planning uses built-in rules; the $15 contribution is simulated. The $60 starting progress is reported. This shows the product flow and world, not PayPal approval or a new AI response.
- **Historical live AI:** the preserved, labelled planner and steward footage and verification excerpts. No AI response is generated for the new recording.
- **Historical PayPal sandbox:** the verified hosted-approval/server capture/replay/refund report. It does not establish the in-app popup path.
- **Unfilmed insert:** the approved in-app sandbox payment and same-order get_order reconciliation still need the existing browser operator. See [OWNER-INSERT.md](OWNER-INSERT.md). Nothing is reconstructed.

The cut uses real app footage rather than mock screens. Every scene carries its source label, captions and “PRIVATE REVIEW CUT / NOT SUBMITTED”. Narration is synthetic **offline macOS Daniel**, not the owner's voice.

## Edit and reproduce

Requires the project dependencies for app capture, Python/Pillow, ffmpeg/ffprobe and macOS `say` for the supplied offline voice. No installation or service call is performed automatically. On the configured Mac, the existing Python 3.9 framework interpreter below has Pillow; the separate Homebrew Python does not. On another machine, use a Python environment with Pillow.

- `capture.mjs` starts its **own** key-free example server on unused port 3141 with a fresh data folder, and a separate headless browser. It refuses to reuse a listening server and checks both example modes before interacting. It never controls the owner's browser. Raw continuous video, state reports and exact recorder timing marks stay in git-ignored `test-results/family-woodland-capture/`; its temporary database is retained.
- `sources/manifest.json` records the included source hashes and actual edit ranges. The continuous original remains on the owner's Mac as described there.
- `timeline.json`, `narration.md`, `captions.srt` / `.vtt` and `timeline.csv` are editable. `prepare_audio.py` measures each spoken phrase and refuses narration that exceeds its scene.
- `render.py` verifies included source and narration hashes, then exports `our-castle-family-woodland-review-draft.mp4`. `render-report.json` and `validation.json` record actual checks.

```sh
node docs/demos/woodland-review/capture.mjs
# Review its report and choose actual source ranges; update the manifest and timeline.
cd docs/demos/woodland-review
python3 prepare_audio.py timeline.json audio-work-new
cp audio-work-new/narration.m4a audio-work-new/speech-timing.json .
/Library/Frameworks/Python.framework/Versions/3.9/bin/python3 render.py --kit .
```

The capture is deliberately a fresh example journey, not a payment verifier. Do not replace its local server with 3010 or 3021. Recording a sandbox insert is a separate approved task for the existing browser operator; do not run a second checkout or paid verifier.

Font, art and code notices remain in `NOTICE.md`, `SOURCE-LICENSE` and `fonts/`. Private source access, public licensing, publishing and hackathon submission remain separate owner decisions.

The downloadable editable ZIP contains the complete render inputs, narration, captions, source notes and scripts; the finished MP4 is provided separately. Put that MP4 beside review.html to use the player, or run the renderer. Run capture.mjs only inside the project checkout with its dependencies, not from a standalone edit-kit folder.
