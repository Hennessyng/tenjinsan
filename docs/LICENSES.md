# Bundled runtime and font licenses

Local PDF import uses Mozilla `pdfjs-dist` 6.4.299 (Apache-2.0). The installed
package contains `LICENSE`; this version has no separate `NOTICE` file. Preserve
the package's license and bundled asset notices when distributing the server.
The Docker dependency stage installs the frozen package and copies `/app`, including
its dependencies, into the API image; final image contents require container verification.
This server-side parser is not bundled into
exported lessons and does not add an OCR or PDF rendering capability to import.

An exported spatial-scene HTML includes the installed Three.js runtime and its
complete MIT license text; non-spatial HTML uses the smaller SVG reader runtime.
The PDF embeds locally installed Noto Sans JP 400 (`@fontsource/noto-sans-jp`
5.2.8), distributed under SIL OFL-1.1; its license is in that package's
`LICENSE`. Declared approved WOFF2 assets are embedded with their supplied
license text and must be reviewed before publication. Do not assume an uploaded
font, image or EPUB is freely redistributable just because it passes MIME/hash
checks. The Abel OFL font in `packages/export/tests` is a test fixture, not a
default production font; the synthetic single-pixel image is CC0.

This document describes bundled asset obligations, not a blanket license for
the user's EPUB, generated quotations, third-party images, or the complete
repository. Confirm rights for every book and extra asset before sharing an
offline HTML/PDF. See `packages/export/README.md` for the exact export boundary.
