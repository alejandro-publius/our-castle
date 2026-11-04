# Our Castle: private judge review cut

**A locally playable draft, not a submitted or fully live end-to-end demo.** The cut is **2:36.36**, 1920×1080 H.264 at 25 fps, with AAC narration, burned-in captions and editable SRT/WebVTT tracks. It contains a visible **24-second unfilmed owner-insert slate at 2:00.36–2:24.36**.

Open [the MP4](our-castle-judge-review-draft.mp4), or [the local player](review.html). The player does not autoplay. [Narration](narration.md), [timeline JSON](timeline.json), [timeline CSV](timeline.csv), [captions](captions.srt), [source notes](PROVENANCE.md) and the [owner insert guide](OWNER-INSERT.md) are editable.

## What is actually shown

- **Current connected realm:** the preserved 36-second recording, with genuine scripted app interactions in **example mode**. Its $15 progression is simulated. The village, five future districts, waterways and bridges are real app geometry.
- **Earlier recorded live AI:** cropped, clearly labelled excerpts of the real planner, checkout controls and steward. The original small-plot world and obsolete narration are omitted. The recording report confirms live AI, no completed checkout, unchanged tracked progress, and only plan/accept/steward POSTs during that earlier recording.
- **Historical integration evidence:** readable excerpts from the existing PayPal and AI verifier reports. These cards are reports, not newly filmed interactions or recreated PayPal/AI UI.
- **Unverified owner insert:** an explicit unfinished slot. No popup approval, in-app callback or household `get_order` reconciliation has been reconstructed.

Every scene carries a provenance label and “PRIVATE REVIEW CUT / NOT SUBMITTED”. The original 36-second clip is unchanged. No new order, payment, refund or paid AI request was made for this cut.

## Edit and render

The included `sources/` files are sufficient to reproduce the cut; the full earlier recording is not required. Source hashes and the original crop/time ranges are in [sources/manifest.json](sources/manifest.json). Both original recordings remain at their existing locations on the owner's Mac.

Requires Python 3, Pillow, and `ffmpeg`/`ffprobe` on PATH. Use an existing environment or install those tools deliberately; the renderer does not install anything or call a service.

```sh
python3 render.py --kit .
```

To revise the synthetic narration, edit `timeline.json`. On macOS, regenerate it offline using the installed Daniel voice:

```sh
python3 prepare_audio.py timeline.json audio-new
cp audio-new/narration.m4a audio-new/speech-timing.json .
python3 render.py --kit .
```

`prepare_audio.py` measures every spoken phrase and refuses to produce final audio when a phrase sequence exceeds its scene. Captions use those measured boundaries. The voice is **synthetic, offline macOS Daniel**, not the owner's voice. There is no music or cloned voice.

If a source, source crop or scene duration changes, update the timeline, provenance and hashes deliberately. The renderer checks its source hashes and narration hash before rendering. Replacing the insert also requires replacing its draft narration/captions and retaining an accurate recording note; see [OWNER-INSERT.md](OWNER-INSERT.md).

## Review limits

The finished cut was decoded and its duration, streams, frame count, captions, source hashes and representative frames checked. That does not validate an unfilmed application flow. The app's focused accessibility/device review is separate, in `docs/ACCESSIBILITY-DEVICE-REVIEW.md` in the project repository.

This cut uses realm footage from app commit `7468b57`; the later keyboard-focus fix at `d869f1b` changes focus/scroll behavior, not the depicted realm. Current app status remains PayPal **sandbox** with configured live AI. Example-mode world progression, self-reported starting savings and confirmed historical sandbox captures remain distinct. Utility-provider-confirmed rewards still require an authorized connection.

Original art and renderer notices remain in [NOTICE.md](NOTICE.md). Font licenses accompany the bundled fonts. Making the repository or artwork public, uploading a judge video and submitting to Devpost remain owner decisions.
