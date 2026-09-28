# Self-contained HTML export (Task25)

`@reading-studio/export/html` exposes `exportHtml(storedPublicationRevision, resolveAsset?)`.
It returns one UTF-8 HTML string; the caller owns writing or downloading that file.
This package alone does not publish or store files. The application now provides
an owner-scoped publication workflow with HTML/PDF jobs. Separate print
composition and PDF rendering are documented below.

```text
authoritative reviewed revision + approved asset bytes
  -> strict revision validation + asset digest checks
  -> escaped reader DOM + inline projection/CSS/assets + dedicated IIFE
  -> one network-free file:// document
```

## Trust boundary

Supply the authoritative stored `PublicationRevision`, never a caller-authored
approval or raw lesson, job, or reader context. The existing contract binds the
projection digest, reviewed string paths, passed privacy review, evidence digest,
and exact derived state/asset inventory. Missing, stale, blocked, or structurally
invalid records fail before any document is returned. Export does not create or
grant approval. Schemas cannot determine whether arbitrary prose is true or private;
the preceding evidence/privacy review remains mandatory.

Only `revision.projection` is rendered and serialized. Revision IDs, analysis IDs,
approval objects and privacy reports are not included. Hono escapes authored text
and attributes; the JSON data block also escapes `<`, `>`, `&`, U+2028 and U+2029.
No lesson text is interpreted as HTML, CSS, JavaScript, or a URL.

The optional resolver receives only a manifest content hash and returns bytes from
trusted asset storage. Every declared asset is required; bytes are copied and
SHA-256 checked before embedding. Raster image and WOFF2 signatures must match the
allowlisted MIME type. Hashes bind the reviewed bytes, including any metadata;
they do not anonymize images, fonts, or embedded metadata. Asset review must cover
the actual bytes, not just their description. SVG/HTML assets are not accepted.

## Offline delivery

- A dedicated esbuild browser IIFE imports only trusted scene entrypoints. No ESM
  imports, chunks, fetches, or external script/style tags are emitted.
- Three.js and its complete installed MIT license are included only for spatial
  scene documents. Other lessons receive only the small SVG runtime.
- Reader CSS and all declared raster/font assets are inline. Declared WOFF2 fonts
  use generated family names and data URLs; otherwise the existing offline-safe
  system font stacks remain. License text is escaped and included in the document.
- A document CSP permits only the exact runtime SHA-256, inline CSS and image/font
  data URLs. Connections, external resources, objects, base URLs and form actions
  are denied. Practice and language controls do not persist or submit anything.
- Static HTML contains every trusted derived teaching state, source note, caption,
  practice option and explanation. JavaScript and WebGL only enhance that content.

`ReaderDelivery` in the reader package is a trusted server-side composition hook,
not a new content schema. Its defaults preserve the private reader. The two browser
entrypoints are explicitly marked side-effectful so bundling cannot erase them.

## Verification

```sh
bunx vitest run packages/export/tests
bun run test:exports -- html
bun run typecheck
bun run build
```

The browser suite downloads the HTML from an ephemeral test-only server, closes
that server, then opens the downloaded file in real Playwright Chromium with
network disabled. It repeats with JavaScript disabled and with Chromium WebGL
disabled, inspecting actual bilingual DOM against an independent content fixture.
It checks runtime controls, image/font decoding, script-breakout text, private
canaries, no requests, and 375/768/1280px layout. Negative tests cover stale reviews,
missing state manifests, private fields, and mismatched/missing/executable assets.

`tests/abel-latin.woff2` is an unmodified OFL test font, not a default production
font. Retrieved from `https://fonts.gstatic.com/s/abel/v18/MwQ5bhbm2POE2V9BPQ.woff2`
via the Google Fonts Abel stylesheet; `tests/Abel-OFL.txt` preserves its license
from `https://github.com/google/fonts/blob/main/ofl/abel/OFL.txt`. Tests perform no
network font download. The synthetic one-pixel test image is CC0.

Evidence: `.omo/evidence/reading-studio/task-25/DoneClaim.json`.

## Static print composition (Task26)

`@reading-studio/export/print` exposes `exportPrint(storedPublicationRevision,
resolveAsset?)`. It produces a separate script-free document, not a snapshot of
the reader: annotated SVG sequences, every spatial alternative, every practice
choice and explanation, approved topic questions, and a sources appendix. No
active selection, animation time, canvas, language preference or local answer
enters composition. The same strict approval and asset boundaries apply.

`printReadiness(storedPublicationRevision, actualDocument)` checks a parsed print
DOM against trusted scene variants and content arrays, including exact bilingual
labels and explanations. It does not trust `data-print-states` or a submitted
"complete" manifest. Invalid approvals throw; incomplete DOM returns
`{ ready: false, issues }`. Callers must supply the actual document they intend
to print. This structural check does not certify arbitrary substituted CSS,
paper pagination, printer output or semantic approval authenticity.

The question collection uses only `kind: "topic"` practice from the approved
projection, not private interview questions. It preserves authored order and
feedback. No publication route, PDF engine, PDF artifact or Task27 work is added.

Verify with `bunx vitest run packages/export/tests/print.test.ts` and
`bun run test:exports -- print`. Evidence:
`.omo/evidence/reading-studio/task-26/DoneClaim.json`.

## Paginated PDF (Task27)

`@reading-studio/export/pdf` exposes `exportPdf(storedPublicationRevision,
{ resolveAsset?, timeoutMs? }?)`, returning PDF bytes without publishing or writing
an artifact. Supply the authoritative stored approval, as for HTML/print. This
boundary does not authenticate a caller-created approval or replace privacy review.

```text
approved revision -> separate static print composition -> bundled fonts
  -> fresh sandboxed Chromium -> actual content/font/readiness checks -> A4 PDF bytes
```

Each job has a fresh browser/profile and offline context, JavaScript and WebGL
disabled, service workers blocked, HTTP/WebSocket denial, and DNS-denial flags.
The browser receives a minimal environment rather than provider secrets or proxy
configuration. GPU frames, private preview selections, and saved answers never
enter rendering. Native text and static SVG remain searchable/vector content.
The sandbox is not disabled to accommodate an unsupported host: launch must fail.

Noto Sans JP 400 (`@fontsource/noto-sans-jp`, pinned at 5.2.8, SIL OFL-1.1) is
embedded from local package files, never downloaded at export time. Its license
is distributed in the dependency's `LICENSE`. Chromium decodes every declared font and
image decoding, checks actual static DOM against the revision rather than a
declared manifest, checks rendered text bounds, and rejects platform-font fallback.
Missing/corrupt fonts, incomplete text, or a deadline do not return a partial PDF.
Print-only A4 margins, heading/figure/state break rules and bilingual typography
leave the private reader and Task26 composition unchanged.

Limits: one active public export per process; a maximum 60-second total deadline
(callers may lower it), 8 MiB per asset, 24 MiB input/HTML/PDF, 20,000 DOM nodes,
and 200 output pages. Chromium is terminated on an in-flight timeout. Renderer
process count and V8 heap are constrained; these are **not** hard total Chromium
RSS/CPU quotas. A deployment should additionally impose container memory, CPU and
PID quotas and deny container egress. Page/output caps reject, never truncate.

Verification requires the pinned Playwright Chromium and Poppler's `pdftotext`,
`pdftoppm`, `pdffonts`, and `pdfinfo` on PATH:

```sh
bunx playwright install chromium
bunx vitest run packages/export/tests/pdf.test.ts
bun run test:exports -- pdf
```

The PDF suite extracts text against independent bilingual content/counts, checks
all font embedding flags, rasterizes every page for visual inspection, scans for
privacy canaries, and exercises missing/corrupt fonts, stalled readiness, omitted
explanations with an unchanged manifest, network denial, and size/node/page limits.
The literal script fragment on the synthetic first page is an intentional
escaping fixture, not executable PDF content or a real lesson.

`PDF_EVIDENCE_DIR` redirects PDF evidence, including for a container run. Docker
verification is conditional on a responsive daemon; the Task27 DoneClaim records
whether it was available. Evidence: `.omo/evidence/reading-studio/task-27/`.
The application publication endpoint, persistence and job wiring are separate
from this package API. See `docs/OUTPUT-LIMITS.md` for owner-facing limits.
