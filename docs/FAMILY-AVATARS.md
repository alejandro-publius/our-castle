# Family avatars

Each existing member chooses one of eight original pixel characters in Journal → House. An explicit Save persists only that member's avatar; Cancel/Escape leave it unchanged. The same miniature, outfit and skin/hair colours appear in the traveling party. Choices are cosmetic and available to every role.

Reference lock: the existing Our Castle miniature world, original 90-colour renderer, Uncial/Alegreya and ivory/ink/brass controls remain primary. Bounded Refero review: Wayfinder (168f20ae-b58e-4781-b9b8-46b2d9b81b5f, https://wayfinder.nfb.ca) supplies unobtrusive controls around the world; TinyFaces (b6bd232f-d070-4748-8b2a-110c7ffe60ec, https://nft.tinyfac.es) supplies consistent original character framing only; HBO Max's avatar picker (9869a42a-163a-46f2-9ae5-b0e2536e925e) supplies image-led choices, a selected ring/check and keyboard focus. None supplies imagery, fonts, colours, marketing layout or a new permanent panel.

| Decision | Source | Boundary |
| --- | --- | --- |
| Named portraits inside House; one chooser at a time | Owner's family-avatar request and existing quiet journal | No top-bar crowding or new destination |
| Original model-rendered portraits, matching the map | Existing code-native pixel world; TinyFaces framing | No third-party character images or photos |
| Native radios, explicit Save, Escape/Cancel, focus return | HBO Max selection pattern and Refero craft guidance | Keyboard/touch support; no writes while browsing |
| Existing member IDs and roles; nullable additive avatar column | Current household model | No new accounts, permissions, progress or payment behavior |

assets/member-avatars/generate.mjs reproduces the eight portraits from src/world/member-models.js through the untouched PixelRenderer. provenance.json records exact source/image hashes. No credentials or external art services are used.

The local app still has its existing solo/family member model. This adds appearance choices, not account invitations or authentication.
