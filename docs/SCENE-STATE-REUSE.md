# Reuse an unchanged board state

The journal refreshes server state after planning and ledger actions. When that refresh carries the same board inputs, the existing scene can remain on screen. Previously, every scene update rebuilt the route meshes and submitted another complete frame, even when nothing in the world changed.

The scene now compares the proposed state with its current state **inside the update queue**. An unchanged update resolves without rebuilding or drawing. Waiting for earlier updates is essential: a duplicate queued behind an animated walk must wait for that walk and preserve its final position. Real changes still use the existing update and animation path. Camera controls, asset readiness, resize and ambient animation retain their own rendering paths.

This changes presentation only. The app still applies the server response and updates the journal, progress, records and next action. It does not skip requests, approve a payment, credit progress or alter the original artwork.

## Reproduction and checks

The standalone scene fixture uses Playwright's clock and instruments actual WebGL draw/allocation calls and scene callbacks. It performs only local GET requests, with no household or financial writes.

On base `579b4f6`, both added regressions failed:

| Fixture action | Before | After |
| --- | --- | --- |
| Three identical board updates | 2,514 GL draw calls, 24 allocations, 3 view callbacks | 0 additional draws, allocations or view callbacks |
| An identical update queued behind a walk | 828 GL draw calls, 8 allocations, 1 view callback | 0 additional draws, allocations or view callbacks; the walk finishes once at the correct position |

Those counts describe the specific fixture, not frame rates or a device benchmark. Normal movement and ambient life still render.

The full scene-lifecycle file passes all four desktop cases, including disposal during an unlock and resuming ambient life after a hidden page or covering card. The new two cases carry `@release`, so the existing release-check workflow selects them; phone skips in this file are intentional because these lifecycle invariants do not depend on viewport dimensions.

Run the focused checks with the repository's existing credential-free Playwright setup:

```sh
npx playwright test scene-lifecycle.spec.mjs --project=desktop
```

Local reproduction used a separate in-memory example server on an OS-assigned port. It did not use the owner or rehearsal apps. Before/after logs and the isolated runner are ignored under `test-results/scene-efficiency-20261107/`.

The connected family journey passes on desktop and a 390 px phone (four cases), including Merchant selection, goal confirmation, simulated contribution, world and Treasury refresh. The project-stage regression also passes (one desktop case; its phone case is skipped by design), exercising thresholds, refund reversal, a larger goal and switching project kinds. Hosted results are recorded separately in the PR. Browser emulation and software rendering do not establish human usability, physical-device performance or a hackathon score.
