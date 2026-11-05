# PDF runtime notices and provenance

The adjacent verbatim license files are distributed with the ingestion source/build layout:

- `embedpdf-runtime-LICENSE.txt`: `@embedpdf/engine-runtime@3.0.0-next.16`, published npm archive `LICENSE` (Apache-2.0).
- `embedpdf-wasm32-LICENSE.txt`: `@embedpdf/engine-runtime-wasm32@3.0.0-next.16`, published npm archive `LICENSE` (Apache-2.0).
- `detect-libc-LICENSE.txt`: `detect-libc@2.1.2`, published npm archive `LICENSE` (Apache-2.0).
- `PDFium-LICENSE.txt`: verbatim core source license, including PDFium BSD redistribution conditions and the fork's Apache text, from https://github.com/embedpdf/runtime/blob/e65ef204673221bb597ab3a7db38bb9b2ea4e2c3/LICENSE .

Package tarballs are integrity-pinned in `bun.lock`. The locked runtime graph deliberately selects only the explicit WASM payload and required `detect-libc`; native optional payloads are not part of this selected graph. Use frozen installs and review this exclusion when updating the runtime. The product always supplies local WASM bytes and verifies WASM kind/platform; no native fallback or cloud product is used. `pdfjs-dist` remains development-only for historical diagnostics.

The source pin documents the APIs and core license examined. Upstream npm metadata does not establish reproducible source-to-published-WASM equivalence or provide an audited complete component manifest. We do not fabricate that assurance or claim independent third-party license clearance. The supplied licenses and core BSD/Apache conditions are retained verbatim; upstream component/provenance disclosures remain limited.

The lock entry is intentionally narrower than the published runtime manifest, which declares optional platform packages. A non-frozen install/update can restore native payloads on disk even though the loader still forces WASM. `bun run check:pdf-runtime` (also run by the workspace build) rejects forbidden `engine-runtime-*` records except `wasm32` in both the lock and the local installed trees. It does not delete packages or rewrite the lock. A Linux/container frozen install has **not been verified** here; no Linux/container installation was performed.

Known extraction limitations: unrepresented repeated Forms, astral-only replacement scopes without an anchor, and missing Form-contained whitespace can cause explicit partial-page omissions. Unmarked literal ligature identity is not generally recoverable through the processed public text API. Generated CJK/kana wraps are joined only under the approved narrow rule; punctuation, Hangul and source-authored/ActualText newlines are not joined.

Native RTL mirroring/order and line-end-hyphen transformations are characterized with synthetic PDFs. Any unmarked Hebrew/Arabic/bidi risk or object-order disagreement excludes the **whole page, including its other text**; frequency on real books is unmeasured. A line-end hyphen is recovered only when a supported copy-only singleton probe verifies the same source object, unchanged prefix, exact U+002D/U+00AD and a changed baseline. It emits that observed character plus LF, never a dehyphenated join. Unsupported/fragmented provenance, Form geometry or more than sixteen such probes still excludes the **whole page**. Authoritative ActualText remains literal. This is not generalized verification for every RTL script, reading order or hyphen layout. The worker preserves safe omission codes without emitting raw glyph/object/probe traces or source text in diagnostic receipts.
