# Current build review cut

The owner's November 5 request to finish the release includes a new video. This cut replaces neither the older sources nor the missing live evidence. **It is a review cut, not a submitted video.**

The [gold fountain](../../GOLD-FOUNTAIN.md) was added after this recording. Its new animation is not depicted by the older footage; original media and hashes remain unchanged.

- Playback: [our-castle-current-review-cut.mp4](our-castle-current-review-cut.mp4), **2:42**, 1920×1080, 25 fps, offline synthetic Daniel narration.
- Edit: [timeline.json](timeline.json), [timeline.csv](timeline.csv), [narration.md](narration.md), [captions.srt](captions.srt), [captions.vtt](captions.vtt).
- Evidence: [source manifest](sources/manifest.json), [public-build recording report](sources/public-demo-capture.json), [render report](render-report.json).
- Missing insert: **1:08–1:36**, currently an explicit unfilmed slate. [Exact recording instructions](INSERT.md).

## What is actually shown

Current game footage comes from an anonymous public clone at `be73dfb`, installed with `npm ci` and launched using the actual `npm run demo` command. An empty development browser interacts with a fresh in-memory household. The family setup, plan acceptance, simulated contributions, deeds, selected Treasury receipt, refresh and later world progression are actual recorded interactions. No owner's browser profile, environment file, persisted household or provider key was used. Reduced motion was selected; this footage is not a river-animation performance demonstration.

The merchant image is the unchanged actual Channel3 desktop screenshot from November 4 PST. It shows the earlier real search; it is not a new search or a recording of saving an item as a goal. The Claude plan excerpt is the unchanged live recording from November 3 PST in the earlier interface. The PayPal report describes that date's hosted-link test and subsequent refund. Neither historical source proves today's in-app popup or same-order steward reconciliation.

The original continuous current recording and the failed first capture attempt are retained under ignored `test-results/judge-final-20261105T210813Z/`. The first attempt's capture driver used **Close all** when it should have used **Next** for a multi-deed queue; it timed out waiting for the next card. The corrected driver follows the real queue controls, uses the Los Angeles browser time zone and handles the phone journal's current visibility. The corrected run passed. These were recording-driver changes; no product source was changed or additional provider check run.

Selected derivatives retain normal playback speed. Their original ranges, hashes and any final-frame holds are explicit in the timeline and manifest. Source labels distinguish the current example game, historical live sources, report and unfilmed insert. No missing approval, receipt or model response was generated. There is no stock music.

## Rebuild the edit

Use the bundled fonts and source files. On a Mac with the Daniel voice installed, Python/Pillow, FFmpeg and FFprobe:

```sh
python3 docs/demos/woodland-review/prepare_audio.py \
  docs/demos/current-review/timeline.json docs/demos/current-review
python3 docs/demos/current-review/render.py
```

To record a new example source, use a separate unchanged public checkout with dependencies installed:

```sh
node docs/demos/current-review/capture.mjs \
  --app-root /path/to/public/our-castle \
  --out /path/to/ignored/capture
```

The recorder launches its own `npm run demo` process group, OS-assigned localhost port and fresh in-memory state. It blocks outside browser requests and checks example modes. It never takes over 3010, 3021, a user browser or a running payment. It needs the matching Playwright Chromium installed for development recording; ordinary judges do not need Playwright to play the game.

`build_kit.py` makes selected derivatives from a **passing** capture report and the existing real merchant screenshot. It does not create a Channel3 response or financial/AI outcome. `render.py` verifies source and narration hashes, measures the export, checks its frame count and fully decodes it. The prior 36-second world clip and all earlier review cuts remain unchanged.
