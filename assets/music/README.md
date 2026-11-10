# Optional realm soundtrack

Six original retro RPG recordings, requested one at a time from this app after **Sound on**. No streaming service, audio API, account or new player panel. Every page starts with **Sound off**, including after a reload. Hidden pages pause immediately.

| Recording | Composer / library | Realm selection | Licence |
| --- | --- | --- | --- |
| Peaceful Village | [HydroGene](https://hydrogene.itch.io/high-quality-16-bit-music) | Village / daylight | CC0 1.0 |
| Farm Life | [Bert Cole / Bit By Bit Sound](https://bit-by-bit-sound.itch.io/16-bit-starter-pack) | Village / market | Custom, attribution required |
| Wood Forest Town | HydroGene | Woods / village / night | CC0 1.0 |
| Spirits Forest | HydroGene | Woods / night | CC0 1.0 |
| Ancient Library | HydroGene | Night | CC0 1.0 |
| [Welcome to the Item Shop](https://opengameart.org/content/welcome-to-the-item-shop) | congusbongus | Market / village | CC0 1.0 |

Playlists rotate at a recording's natural end, with a short volume fade at each edge. Camera and sky changes choose the next playlist; they never interrupt the current recording. A single native media element prevents overlapping songs. Unsupported codecs are skipped; every playlist contains MP3 alternatives. The existing shop song remains included.

## Provenance and licences

- **HydroGene** publishes the 28-track pack under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Four original MP3s are copied unchanged. The artist's [original readme](hydrogene/README-original.txt) is retained.
- **Music composed by Bert Cole** — [bitbybitsound.com](https://bitbybitsound.com). The 37-track pack grants use in projects with attribution; its [original licence](bitbybit/LICENSE-original.txt) is retained byte-for-byte. It forbids resale/derivative works and applies to one person/company. Only the original, unchanged Farm Life Ogg is bundled. It is not CC0 or MIT. A fork's use of this game does not grant a separate music licence: obtain your own free pack licence from the artist before using it elsewhere. Composer credit and link also appear in the app footer.
- **congusbongus** publishes the current shop song under CC0. Its existing MP3 conversion and source hashes remain in [provenance.json](provenance.json).

[New recording provenance](soundtrack-provenance.json) records the public artist pages, exact archive entries, source archive SHA-256, original recording hashes and byte counts. No Nintendo or Pokémon audio is included or endorsement implied. Artwork retains its existing separate licence.

## Earlier Sound-control captures

These November 7 captures predate the current illustrated header. The control keeps the same placement and behavior: speaker icon at the far right, a Sound off/on label on desktop, and a 44 px icon target on narrow screens. Initial-state captures use isolated example data.

![Desktop: Sound off at the top right](../../docs/screenshots/music-header-desktop.png)

![Phone: muted speaker beside Journal](../../docs/screenshots/music-header-phone.png)

[Capture source hashes and check scope](../../docs/screenshots/music-sources.json).
