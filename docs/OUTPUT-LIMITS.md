# Source and output limits

Use EPUBs you are entitled to read and process. Intake requires an EPUB ZIP
upload, at most 50 MiB compressed, 200 MiB expanded, 5,000 entries and 20 MiB
per entry. EPUB3 navigation is preferred, with EPUB2 NCX fallback; main spine
chapters and supplementary material stay distinct. Non-spine assets, scripts,
styles and embedded media aren't treated as book prose. Missing or empty spine
text can mean partial coverage. ZIP64, split archives, encrypted chapter text,
unsafe paths and corrupt ZIP/XML fail closed. Font-only IDPF/Adobe obfuscation
can be retained; DRM-protected books aren't decrypted or bypassed. Chapter/page
labels and quotation offsets depend
on the imported **edition** and its available markup; reflow and different
editions don't guarantee stable printed page numbers. Verify each citation
against the edition you imported. A selected scope is not whole-book coverage.

Study questions guide the lesson, not a forced answer. Check source attribution,
exact quotation and qualifications during evidence review. An original example
must be labeled as an example, not presented as a quote from the book. A fixture
study uses an authored synthetic EPUB, not the user's copyrighted private book;
passing it cannot establish book-specific semantic quality or rights clearance.

Approved publication exports are a standalone `file://` HTML and a companion
PDF. HTML bundles its reader script, CSS and approved raster/font assets without
network calls; it keeps the teaching text, captions, alternatives, bilingual
labels and practice explanations visible when JavaScript or WebGL is unavailable.
JS can switch languages and practice states, but an offline file does **not**
generate new AI responses, sync answers or fetch missing book text. WebGL scenes
have static alternatives; PDF is separately composed from the same approved
projection and preserves required teaching states as static text/SVG, not current
animation frames or a viewer's current answers.

PDF rendering needs sandboxed Chromium. Missing fonts/assets, timeout or
incomplete content fail instead of returning a partial file. Current limits:
one active export per process, at most 60 seconds, 8 MiB per asset, 24 MiB
input/HTML/PDF, 20,000 DOM nodes and 200 pages. These are rejection caps, not
performance promises. Printing and PDF pagination may vary by environment.
See [asset licenses](LICENSES.md) before redistributing an export.
