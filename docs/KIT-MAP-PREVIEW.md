# Kit preview on the map — November 9, 2026

**Preview on map** shows a compared kit as a small, temporary arrangement beside the family's campsite in the west meadow, so a family can see what a plan changes before choosing it. It is a picture of a plan. Nothing in it is bought, saved or earned.

## Reference and decisions (written before the code)

**Primary reference:** the existing Our Castle world and journal. The original pixel world, its 90-colour rendering palette, the parchment journal, Uncial and Alegreya, and the compact brass controls all stay as they are. This is not a visual redesign.

Secondary references, and the one thing taken from each:

| Reference | Borrowed | Not borrowed |
| --- | --- | --- |
| [Cofounder](https://cofounder.co) (pixel pastoral machinery, Refero style `5fdd662c-cec5-4b8e-aa80-444dcbc3b7a0`) | The world stays the main explanation: the plan is shown as objects in the meadow, with one compact control beside them | Marketing layout, new fonts or colours, giant illustrations, panels |
| [Tapbots](https://tapbots.com) (toys with a purpose, `889337e0-2d2c-4980-a9b5-2bca2cb5394d`) | A useful action expressed through a small crafted object scene | Palette, enormous characters, landing-page layout, copied art |
| [Zendesk preview, then explicit save](https://refero.design/flows/1356) | A preview stays distinct from saved state until an existing explicit action saves it | A full editor, a sidebar, a discard dialog |

| Decision | Why |
| --- | --- |
| One **Preview on map** button on each compared kit, including the closest kit when none fits | The comparison already exists; the preview is one more way to read it. No second dashboard, wizard, chat or large dialog |
| The picture is driven by the server's comparison answer the page already holds | No canned kits and no new request to draw or clear it |
| A separate **plan ground** in the meadow: a pale groundsheet with stakes and pennants, on the strip behind the campsite's own plot, on its right | The temporary plan must never be mistaken for the funded campsite. The funded stage, progress, bridges, deeds and travelers are not touched. (First placed in front of the plot; the first render showed the meadow's front trees hide that ground, so it moved to the one strip that every stage of every project leaves empty and in view.) |
| One small plaque over the map says **Plan preview · Not bought**, with the kit's actual total, its finish or shortfall, and what was switched or kept | The language stays with the picture. It uses the existing ivory plaque style and sits under the map's toolbar |
| The example's six invented listings get their own simple shapes. Every other listing is a plain crate marker | Shapes may say only what the data says. A live or typed listing has no known shape, so none is invented |
| What the picture may vary by: the listing (example only), how many are bought, which shop, kept, switched, fits | These are facts in the comparison. Colour, size and quality of a real product are not, and are never implied |
| A kit that does not fit is drawn pale, with red pennants | An unaffordable plan must not look like an affordable one |
| The preview follows the kit the family asked to see. If that is their chosen kit and it stops fitting, the planner's smallest change is shown instead, labelled as a proposal, with the chosen kit left as it was | The saved choice never changes silently. Going back to an amount that fits shows the chosen kit again |
| If the previewed kit can no longer be matched to the current result, the preview closes and says how to preview the current one | No stale picture |
| The camera uses the existing campsite view, drawn closer to the plan while a preview is open. The compass and free navigation keep working | The strip is small, so the plan is drawn smaller than life and needs the closer view to be read. Closing the preview returns the ordinary campsite view. No new camera mode or control |
| Close with the button or Escape; focus returns to the button that opened it | Keyboard and screen-reader route |

Rejected: a new map mode, a full-screen or large modal, a second comparison table, product photos or product-exact models, automatic journal jumps, and any change to payments, progress or the server.

## Status: checkpoint, not finished

This branch was handed back to ROOT at a checkpoint on November 9, 2026, at the owner's request. The preview is implemented and was looked at once on the desktop through the family-trip example. It has no committed tests yet, the 390 px phone layout has not been looked at, and no hosted check has run. The handoff note with the exact state is in the ignored evidence folder `test-results/kit-map-preview-20261109/HANDOFF.md` of the worktree.
