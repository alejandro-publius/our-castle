# Sponsor marks

These SVGs were retrieved unmodified from the sponsors' own public sites on November 6, 2026 Pacific. They identify the integrations already used by Our Castle. All lettering is outlined in the files; no brand font is substituted or bundled.

| File | Official source | SHA-256 |
| --- | --- | --- |
| `ag-grid.svg` | https://www.ag-grid.com/images/ag-logos/svg-logos/AG-Grid-Logo_Dark-Theme.svg | `970654b7276c318f41a2b2ae4bf89d3921b4641b2071cad459f5be5073a269e4` |
| `channel3.svg` | https://trychannel3.com/logos/channel3/channel3-logo-wide-dark.svg | `0d5dcb888187ae85a11bfafb54223ba3b5b936ee07bb10d54769ed22901d0d67` |
| `apimatic.svg` | https://www.apimatic.io/hubfs/APIMatic-logo-white.svg | `0185ef794ec58f58dd553085ed62602a68915de448a8fbacab97e94078806f7e` |

AG Grid's file is referenced by its official documentation/package README. Channel3's wordmark is referenced by https://trychannel3.com/ and APIMatic's by https://www.apimatic.io/ . Each file is self-contained, without scripts, external fonts or images.

The game uses the marks as texture faces on small wooden guild signs, preserving their aspect ratios and colours in the source artwork. They pass through the existing world lighting and pixel/palette renderer like other painted surfaces. Front and back prints retain readable lettering rather than mirroring the mark.

`ag-grid.png` is a transparent 952×280 raster of the unchanged official SVG (4× its viewBox). Chromium renders the SVG correctly as a document, but its viewBox-only source loaded as a blank WebGL texture during the first visual pass. The PNG is a headless Chromium screenshot of that same locally served SVG, with a 952×280 viewport and `omitBackground: true`; no mark, lettering, colour or spacing was redrawn. Runtime uses this local PNG for AG Grid and the original SVGs for Channel3 and APIMatic. PNG SHA-256: `8e3f4859094361b44edc94ccd125983ffaa4d94fcf01daca5ce962175405f17c`.

The names and logos remain their respective owners' trademarks and are excluded from the project's MIT code and original-art licences. Display identifies the tools used; it does not claim sponsor endorsement or an awarded prize.
