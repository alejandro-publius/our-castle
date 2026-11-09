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
| A separate **plan ground** in the meadow: a pale groundsheet with stakes and pennants, in front of the campsite's own plot | The temporary plan must never be mistaken for the funded campsite. The funded stage, progress, bridges, deeds and travelers are not touched |
| One small plaque over the map says **Plan preview · Not bought**, with the kit's actual total, its finish or shortfall, and what was switched or kept | The language stays with the picture. It uses the existing ivory plaque style and sits under the map's toolbar |
| The example's six invented listings get their own simple shapes. Every other listing is a plain crate marker | Shapes may say only what the data says. A live or typed listing has no known shape, so none is invented |
| What the picture may vary by: the listing (example only), how many are bought, which shop, kept, switched, fits | These are facts in the comparison. Colour, size and quality of a real product are not, and are never implied |
| A kit that does not fit is drawn pale, with red pennants | An unaffordable plan must not look like an affordable one |
| The preview follows the kit the family asked to see. If that is their chosen kit and it stops fitting, the planner's smallest change is shown instead, labelled as a proposal, with the chosen kit left as it was | The saved choice never changes silently. Going back to an amount that fits shows the chosen kit again |
| If the previewed kit can no longer be matched to the current result, the preview closes and says how to preview the current one | No stale picture |
| The camera uses the existing campsite view. The compass and free navigation keep working | No new camera mode |
| Close with the button or Escape; focus returns to the button that opened it | Keyboard and screen-reader route |

Rejected: a new map mode, a full-screen or large modal, a second comparison table, product photos or product-exact models, automatic journal jumps, and any change to payments, progress or the server.
