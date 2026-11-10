# A shared project in the woodland

The **Village fund** button opens a leaf of the existing parchment journal. Its Project, Families and Records sections keep one shared goal together: a reviewed amount, voluntary family shares, and confirmed contribution records. Promises do not grow the schoolhouse. Its four stages use the server's net-progress projection, including refunds.

Each fund has one contribution type. Simulated dollars, PayPal sandbox test payments and valueless PYUSD devnet tokens have separate labels and totals. Sandbox approval opens only from an explicit link; returning from PayPal is not proof of payment. **Check payment** sends the server's local contribution ID. A devnet refresh begins only after an adult starts watching and the server advertises that connection as configured.

**Visit the shared square** switches the existing renderer to an opt-in view of the same neighborhood. Up to six homes surround a schoolhouse; every family remains available in the paper's list. The view reuses the original home, schoolhouse, layered tree, lantern and well models, the existing materials and the original pixel palette. **My realm** restores the household's camera and group visibility. No household balance is painted on a home. Sharing a family's actual crest and castle tier is an explicit adult choice; the default presentation is a starter home.

While the square is visible, the header ribbon shows that shared project's title, contribution type and recorded progress. Household contribution links are hidden until returning to **My realm**. A continuous woodland surrounds the clearing, using the same layered trees rather than a separate renderer or new art asset.

Presence is separate from membership and contribution records. A named family in the list is not an online person. Only server-reported people appear after **Join the square**. Four movement controls send bounded three-unit moves. Background reads and heartbeats do not extend the signed-in session. Hiding the page or leaving the square stops heartbeats; a delayed join response cannot restart them. The server owns the presence expiry and rechecks membership.

Published review links use `?villageFund=<id>`. After the normal family sign-in, an outside adult can review the published goal and contribute without receiving the neighborhood's family list, private receipts, presence or wallet-watcher controls. The server decides whether a project is published; the browser never turns a failed review into membership. An unpublished link can still expose **that adult's own** previously approved checkout for recovery.

Opening a PayPal sandbox fund reads the current adult's own unfinished orders before permitting another checkout. **Recover this checkout** resumes the original intent; **Check payment** keeps it unfinished until the server reports completion. An unavailable order lookup keeps new checkout disabled. These behaviors avoid silently replacing a pending payment after reload or a lost response.

In signed-in family mode, adults can expand **Connect a local assistant** under Records. Creating, copying and revoking a temporary read-only grant are separate explicit actions. The copied configuration uses `node /absolute/path/to/our-castle/scripts/mcp.mjs`; its path must be edited for that computer. The adapter accepts a local app address only. Tokens stay in memory, disappear when the fund window closes, and are never written to browser storage. This configures no assistant automatically and grants no payment authority.

## Design reference lock

The existing Our Castle parchment, forest-green ink, Uncial headings and original woodland are the primary reference. Refero research on November 10, 2026 supplied these narrower pattern references:

| Reference | Pattern retained | Deliberately left behind |
| --- | --- | --- |
| Ko-fi, “friendly paper playground” (style `4b6a8a0b-a5bf-473a-9b4f-4782b65a20c3`) | One clear invitation with friendly supporting copy | Its palette, cartoon graphics and promotional layout |
| Tapbots, “toys with purpose” (style `889337e0-2d2c-4980-a9b5-2bca2cb5394d`) | Expressive illustration beside plain functional controls | Its platform-specific styling |
| PayPal fundraiser preview (screen `0c1fef90-aa2d-4447-95b1-6b38df1a70b2`) | Goal, progress, date and one contribution decision | A second visual brand inside the journal |
| Hitchd contribution records (screen `67eba85e-80ef-4125-a645-dcc5b1712cd5`) | Compact dated entries and references | Decorative donor proof or assumed participants |

The result uses existing generated paper assets rather than drawing labels into a new illustration. Financial labels remain selectable, accessible text. On narrow screens the form and family rows become a single column; the modal retains its close button and the map controls remain touch-sized.

## Focused evidence and limits

`test/e2e/village-square.spec.mjs` runs the real application and renderer with explicitly invented API responses in a disposable local demo, at desktop and 390 px phone widths. It checks amount-specific approval, one simulated contribution, server-projected schoolhouse stage, all-family listing with a six-home scene bound, one renderer, shared-header restoration, opt-in movement, a delayed-join/exit race, exact return to the household view, separate devnet labels, outside review privacy, and pending-checkout recovery. A desktop-only module fixture checks explicit assistant grant/copy/revoke and token removal without browser storage. Browser requests outside each disposable origin are denied. Local screenshots are written under `test-results/village-world/`.

`test/unit/village-presentation.test.mjs` checks exact two- and six-decimal input and honest contribution-type formatting. These presentation checks do not prove backend authorization, real payments, real devnet deposits, physical-device behavior, or a human playtest. Backend and combined integration evidence must be reported separately.
