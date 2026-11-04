# Accessibility and device review: connected realm

November 4, 2026. A focused review of one judge path in the current connected-realm UI:

- keyboard use of the realm view controls;
- district inspection;
- the main journey tabs;
- the phone layout.

The review starts from commit `de147d4`; the fix described below is committed on top of it.

This is a **Chromium emulation pass**: headless Chromium through Playwright 1.64.1, with software WebGL (SwiftShader) and device emulation. It is **not** a real-phone, Safari, Firefox or screen-reader pass, and it is not a WCAG conformance claim. WCAG criteria are named only to explain why an issue matters.

## Setup

- **Audit server:** a new example-mode server on port 3136 with `OUR_CASTLE_ENV_FILE=none`, a fresh temporary `OUR_CASTLE_DATA_DIR` and empty PayPal and AI keys. Startup confirmed `Payments: EXAMPLE mode` and `Planner: EXAMPLE mode`. The server was stopped afterwards, and its temporary database was left in place.
- **Browser tests:** they use the repository's usual isolated Playwright server: port 3111, `test-results/e2e-data`, no `.env`, empty keys.
- **Viewports:** 1440×1000 desktop; 390×844 phone emulation (`isMobile`, touch, device scale factor 2); 320×568 narrow phone emulation.
- **Visual reference:** the current product and `docs/screenshots/realm-*.png`. The six districts, existing buildings, grey locked regions, waterways, raised bridges, renderer and palette are unchanged. No CSS or 3D code was edited.
- **Owner app:** the owner's app (3010) and the old preview (3020) were not touched, apart from read-only `GET /api/status` and `GET /api/state` on 3010 for the baseline comparison.

## What was checked, and what was found

| Check | Result |
| --- | --- |
| Viewport meta | `width=device-width,initial-scale=1`; zoom is not disabled |
| Focus indicator | A global `:focus-visible` outline: 3 px brass, or dark brown on parchment. All 23 tab stops from the top of the page to the journey tabs matched `:focus-visible` with a 3 px outline, and none was clipped by an `overflow: hidden` ancestor |
| Keyboard trap | None. Tab moves through the persona select, the sound and pixel toggles, six view controls, six map markers, six district buttons, then the journey tabs. Arrow keys inside the view-control group pan the map without capturing Tab |
| Journey tabs | Roving `tabindex`; ArrowRight moved focus and selection to Plan and showed its panel |
| Names | Icon buttons are labelled (Zoom out, Zoom in, Turn the estate left/right). District buttons are named by their text ("Royal Citadel Locked · 100%"). The canvas is `role="img"` with a live description of the six districts, bridges and guests. The focus status line is a polite live region |
| Text contrast | Computed 7.4:1 or higher for the realm's small and muted text: district lock labels, the view hint, focus status, marker labels, tier track, chips and eyebrows |
| Overflow | No horizontal page overflow and no element past the right edge at 390×844 or 320×568 |
| Touch targets (phone emulation) | Every interactive element is at least 24 px in both dimensions except one inline footer link (see the remaining observations). The view controls are 32×36 px and the board toggles 61–68×32 px: above the 24 px minimum, below 44 px |
| Errors and writes | No page errors, and no non-GET requests during any audit run |

## The issue fixed: keyboard focus left off-screen when the view moves to the realm

Two actions scroll the page up to the realm. Neither kept keyboard focus in view.

| Action (keyboard) | Before the fix |
| --- | --- |
| Rewards tab → "Preview in the world" | Focus stayed on the reward card, about 2,400 px (desktop) or 3,500 px (phone) below the viewport. The preview's only exit, "Return to my estate", was 21 Shift+Tab presses away. Activating it hid the button and dropped focus to the page body |
| District button → Enter | At 320×568 the board scrolled to its top and the focused button ended fully off-screen (top at 858 px in a 568 px viewport). At 1440×1000 its bottom edge was clipped (1009 px of 1000) |

**Fix** (`src/app/main.js`, `index.html`):
- **Shared reveal step:** the scroll to the realm is unchanged in intent (the top of the board) but limited so the control that has focus stays fully inside the viewport.
- **District selection:** focus stays on the button that was used. On phones the focused map's taller layout is applied before measuring, because the map grows from 280 to 400 px when a district is focused.
- **Reward preview:** focus moves to "Return to my estate" in the preview notice. That button now has `aria-describedby` pointing at the preview title and the note "Art preview · this does not unlock a reward or change your goal."
- **Return to my estate:** activated from the keyboard (a click with `detail` 0), it puts focus back on the reward card's preview button. A pointer return still leaves the page at the realm.

Nothing about money, rewards or server state changed. Previews still make no server request.

**After the fix** (same audit, same viewports):

| Viewport | District button after Enter | Preview: focus | Return: focus |
| --- | --- | --- | --- |
| 1440×1000 | Fully visible (bottom 992 of 1000), focused, pressed, status announced | "Return to my estate", fully visible, visible ring | Back on the castle card's button, visible |
| 390×844 | Fully visible (733–836 of 844) | Same | Same |
| 320×568 | Fully visible (458–560 of 568); the map close-up shows above it | Same | Same |

- **Tab order:** identical to before (23 stops).
- **320 trade-off:** at 320 px the focus status line scrolls above the viewport, but it is a polite live region and the map marker shows the same lock.
- **Screenshots:** before and after, in the git-ignored `test-results/accessibility-review/` (local only): `cmp-320.png`, `cmp-desktop.png`, and per-viewport `before/` and `after/` captures with `audit.json`.

## Tests

- **New:** `test/e2e/realm-focus.spec.mjs`, 4 tests × desktop and phone projects = **8 passed**. It checks:
  - keyboard district selection keeps the button focused, pressed and fully visible after scrolling settles, including at 320×568;
  - a keyboard preview focuses the visible, described exit, and returning restores the earned tier and focus;
  - a pointer return does not jump to the reward card;
  - no non-GET requests.
- **Against the pre-fix code**, with the committed `main.js` and `index.html` temporarily restored: **4 failed**. Those were the 320×568 district test and the keyboard-preview test, in both projects. The 1440×1000 and 390×844 district tests passed on the old code: the few-pixel clipping measured by the audit did not reproduce under the test runner, so that sub-case rests on the audit numbers above.
- **Existing tests that go through the changed code**, rerun: `realm.spec.mjs` and `court.spec.mjs` **10 passed**; the estate preview test **2 passed**. The full suite and the guard suites were not rerun.

## Remaining observations (not fixed in this pass)

1. **Duplicate tab stops for districts.** On desktop, the six floating map markers ("Inspect … on the map") sit in the tab order before the six district buttons, which do the same thing and include the lock status. The extra stops are harmless but slow; the markers could leave the tab order.
2. **Keyboard panning is not mentioned.** Arrow keys pan the map while focus is in the view-control group. The visible hint and its `aria-describedby` describe only pointer gestures.
3. **Target sizes.** The view controls (32×36 px) and board toggles (32 px tall) clear the 24 px minimum but are smaller than 44 px. The "Original art preview" footer link is 17 px tall; it sits inline in a line of text, which is the usual exception.
4. **Pointer return focus.** After a pointer click on "Return to my estate", focus falls to the page body, as before. Keyboard activation is handled.
5. **Not covered here:** real iOS/Android hardware, Safari and Firefox, VoiceOver/TalkBack/NVDA, 200% browser zoom, forced colors, the AG Grid ledger with a screen reader, and the PayPal button's own popup accessibility.

## Owner data

`.env` and `data/` SHA-256 hashes and modification times were identical before and after. Read-only `GET /api/state` on 3010 matched the saved baseline for household, members, goal, progress, ledger, contributions, achievements, plan, accepted plan and next step. The app still reports PayPal sandbox and live AI. No order, payment, refund or paid AI call was made.

## Suggested additions for the shared docs (owner/Codex)

- **VALIDATION.md:** a dated entry summarizing the fix and the test counts above, linking to this review.
- **JUDGE-HANDOFF.md:** where it lists unverified items, link this review and keep "real phone, Safari/Firefox and screen-reader passes" listed as not yet done.

## Addendum: woodland revision (branch `art/woodland-realm`)

The world art changed after this review: one green forest with rivers instead of grey islands (see VALIDATION.md). Under software rendering, the heavier first pass of that revision stalled the smooth scroll that brings the realm into view. The keyboard-preview check then failed even though focus moved correctly.

- **Fix:** a keyboard activation (`click` with `detail` 0) of a reward preview or a district now scrolls instantly, so the newly focused control is on screen at once. Pointer navigation keeps the smooth scroll; reduced motion was already instant.
- **Tests:** the assertions in `test/e2e/realm-focus.spec.mjs` are unchanged and pass 16/16 over two repeats.
