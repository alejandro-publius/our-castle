# Gold fountain — major unlocks

Direct build against the existing Our Castle manor fountain, original 90-colour renderer, forest and owned miniature architecture. The owner asked for a small fountain overflowing with gold when large goals or areas open.

Reference lock: existing Our Castle is primary. Refero Wayfinder (`168f20ae-b58e-4781-b9b8-46b2d9b81b5f`) contributes a quiet, world-first setting; MekaVerse (`f5e5d282-4361-4654-aac2-c8b5cd8214b1`) contributes local light/colour emerging from the environment. Neither supplies fonts, UI colours, buttons or copied assets. Refero motion craft informs one short acknowledgement, with a static reduced-motion version. The game's 1.6-second coin arc is a deliberately expressive rare milestone, not a blocking interface transition.

| Decision | Source and purpose |
| --- | --- |
| Small stepped ivory basin, gold collars, carved buttresses and crowned spout | Existing fountain/architecture and owner's gold direction |
| A compact ornament at Manor, Market, Keep and Citadel | Existing major 25/40/60/100% courtyards; keeps paths, stable, tavern and stag sculpture clear |
| One short coin spill at the newly opened primary area | Owner's celebration request; shared 48-instance batch replaces the earlier 28 separate spark meshes |
| A little settled gold remains on earned fountains | Visible keepsake restored from existing area access on reload; no money or new financial reward |
| Static version with reduced motion | Accessibility; existing pixel deed remains the one reward card |
| No repeat on reload, pending payment, map visits or retained-area re-crossing | Existing authoritative progress/access and animation lifecycle |

No new screen, text, audio, dependency, payment route, provider call or reward threshold. All earlier buildings, rivers, bridges, weather and notices remain. The palace's existing water fountain is retained. Locked areas do not receive the earned fountain ornament. Geometry stays in the original renderer and palette.

## Checked

[Actual coin-spill frame](screenshots/gold-fountain-spill.png), captured from the running renderer during a simulated example contribution. The frame is unmodified; it is not a live PayPal recording or a generated illustration.

Four focused reduced-motion cases passed across Chromium desktop and touch-phone: completed credit versus pending, map visits, refund/re-crossing, reload, all four courtyards, night/rain and retained earlier districts. The normal-motion coin trajectory case and the existing post-animation deed/focus/reload case passed. A final focused rerun after enlarging the faceted two-tone coin faces also passed: 66 sampled states across eight distinct phases, one start/end pair, 48 live instances, no extra writes and a hidden live batch after completion. The 47-file original-art/palette/renderer/syntax guard passed. These are browser emulations, not physical-device benchmarks.

The first normal-motion attempt recorded zero intermediate coin samples on the slow software renderer. The reward now starts its visible clock with its first frame and bounds each progress step, preserving at least four intermediate steps; ordinary bridge/walk timing is unchanged. On fast hardware the intended duration remains 1.6 seconds; slower rendering can extend it. Reduced motion remains instant and static. The original failed trace is preserved under `test-results/gold-fountain/artifacts/`, with subsequent runs under `normal-after/` and `normal-polish/`. No failed run is relabelled as a pass.
