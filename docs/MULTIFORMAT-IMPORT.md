# Local document import and coverage (TEN-18)

```text
original -> bounded local extraction -> reading + extraction omissions
                                            |
                                     reviewed text Send
                                            |
                              range receipts + stage outcome
```

The normal picker and raw-body upload API accept EPUB (`application/epub+zip`),
DOCX (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`),
UTF-8 TXT (`text/plain`) and selectable-text PDF (`application/pdf`). Filenames
only help the browser choose a media type; the server selects and validates its
parser independently. Multipart and other media remain unsupported (415).
Importing makes no provider call and grants no permission to transmit anything.

## Extracted text, not a summary

- EPUB retains spine order, headings, anchors, publisher labels and supplementary
  roles. Only chapter and EPUB3 navigation XHTML allow bare `<!DOCTYPE html>`.
  External identifiers, internal subsets and all metadata DOCTYPEs remain forbidden.
  Predefined/numeric XML references work; undefined entities fail. Executable,
  foreign and resource-bearing content is not rendered or executed.
- DOCX retains body paragraphs, heading styles 1–6, list-item/table-cell roles,
  tabs and line breaks. Body text comes first; headers, footers, footnotes,
  endnotes and comments follow as named supplementary parts in deterministic part
  order. Locations are the actual part and paragraph ordinal, not invented pages.
  Styles/numbering/settings/font/theme metadata are not book text. Other parts,
  including custom XML, embedded objects, text boxes, drawings, tracked deletions
  and fields' instructions, are inventoried as unsupported/removed rather than
  silently counted as extracted. External relationships reject the document;
  no relationship causes I/O. Editing protection and encrypted archives reject.
  DOCX normalizer 3 skips textless/whitespace-only paragraphs while keeping actual
  paragraph ordinals for later text. Prior normalization records remain readable.
- TXT uses fatal UTF-8 decoding. Text (including original line endings, whitespace
  and a UTF-8 BOM) is preserved exactly. UTF-16/32, malformed UTF-8 and NUL-bearing
  input reject. Locations contain original line starts and UTF-16 offsets.
- PDF uses locally installed `pdfjs-dist` 6.4.299 in a short-lived Node child,
  through the data-backed text-content API, without starting a viewer/script sandbox
  or rendering. External asset URLs are unset; font-face/system-font loading and
  worker fetch are disabled. The fetch guard is not a filesystem/OS sandbox.
  Only selectable text is extracted, in PDF text-content order.
  Physical page indices are one-based and are not publisher pagination or a
  promise of visual column-reading fidelity. Textless pages are visible omissions.
  There is no OCR, password collection, script execution or URL loading.

Whitespace-only/empty extraction rejects. Nonempty partial extraction remains
usable with visible omissions. Blocks above 100,000 UTF-16 units are split
losslessly (without splitting surrogate pairs), retaining format locators.
Version-2 identities (DOCX normalizer 3 after the blank-paragraph repair) distinguish these normalizations from historical EPUB data;
historical stored records and citations remain readable.

## Finite limits

| Format | Input / archive | Extraction limits |
|---|---|---|
| EPUB | 50 MiB compressed; 200 MiB expanded; 5,000 entries; 20 MiB/member | existing XML ceilings; total normalized text/block ceilings below |
| DOCX | 10 MiB compressed; 40 MiB expanded; 2,000 entries; 8 MiB/member | 128 XML nesting levels; 100,000 elements per XML part |
| TXT | 4 MiB original UTF-8 | at most 4 Mi UTF-16 units before splitting |
| PDF | 10 MiB original | 500 pages; 1,000,000 extracted UTF-16 units; 10 seconds wall time; 8 MiB child-output ceiling; 128 MiB V8 old-space ceiling |

All formats also cap persisted text at 8 Mi UTF-16 units and 20,000 blocks.
Upload configuration may impose a lower byte/archive limit. ZIP actual output,
not merely declared sizes, is bounded. Private directories/originals retain
0700/0600 permissions. No entries are extracted to filesystem paths.

PDF's V8 heap ceiling is **not a hard process RSS/native-memory or per-object /
decompressed-stream quota**. PDF.js does not expose those granular limits here;
the child is killed on time/output exhaustion and heap-abort is treated as a
resource failure. This is not an OS sandbox or a global import concurrency quota.
Do not confuse these import policies with PDF export limits. Operators needing
a hard total-process memory ceiling must additionally enforce it at the host.

## Send coverage and original files

Every new setup covers the whole extraction: **every extracted block of every
included resource**, main chapters and supplementary parts alike. There is no scope,
main-chapter or chapter choice, and the server rejects subset/main-only or chapter-list
creation requests without persisting a setup. The legacy literal `scope: "whole-document"`
is tolerated but does not control the selection. Resources omitted during extraction stay visible as honest
coverage disclosure on setup and review; a nonempty extraction with omissions proceeds
without a separate acknowledgement. An extraction with no text cannot create or send a
study. Setups and grants stored under an earlier scope choice keep their stored scope
unchanged; reconfiguring creates a new whole-document setup that needs a fresh Send.
This does not expand extraction, enable original attachments or establish that the
whole book was semantically processed.

Before saving Send consent, the API and queueing pipeline use the same preparation
planner: at most 128 windows of 12,000 UTF-16 units. Empty EPUB anchors remain in
the source but do not become zero-length analysis windows. An oversized or textless
selection returns safe 422 `scope-limit` with a `not-sent` coverage reason and the
entire selected range inventory, including locations. No grant/jobs/attempts are
created. Repeating the unchanged Send gives the same refusal rather than a stuck
409. Import a smaller source to continue; there is no smaller-scope option and nothing is
silently sliced. The later 64-call and wire budgets remain separate limits.

Every provider input includes source identity, format locators and exact UTF-16
ranges. Nothing is silently summarized or sliced to fit a request. Analysis stages
may explicitly request a bounded source window; receipts list reviewed, transmitted
and untransmitted ranges for that payload. The job view exposes these inventories,
omissions and safe failures without exposing response text. Identical payloads
from retries share a display entry; attempt counts/usage remain separate.

The existing 32,000-byte **serialized wire request** ceiling, source/output budgets,
64-call setup budget, retry, revocation and unknown-outcome rules still apply.
Exceeding a limit stops work. A response receipt or completed stage is not proof
of semantic whole-document processing; processing is explicitly `not-established`.
Old receipts without inventories remain readable but establish no range coverage.

Original EPUB/DOCX attachment support is **unavailable for every current route**.
No selected provider/model has verified exact-format support in this implementation.
Generic Files API upload support is insufficient evidence. Public SDK documentation
checked via Context7 describes PDF/plain-text document blocks, not an EPUB/DOCX
guarantee: [Anthropic message types](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts).
OpenRouter and Codex exact-format support is likewise unverified, not presumed.

Review explicitly names this limitation; text-only Send remains available.
`includeOriginal: true` is refused (415) without creating a grant. The wire input
remains text-only, so neither a legacy text grant nor an arbitrary attachment field
can send a binary. Enabling originals later requires verified model/format evidence,
identity-bound separate consent and a new dispatch-time capability check, including
the warning that originals can contain omitted or out-of-scope material. No working
original-file transmission or live-provider semantic success is claimed here.

## Refusals and retention

Known normalization failures return 422 JSON `{ "error": "safe-code" }`, including
`unsafe-xml`, `invalid-xml`, `invalid-package`, `unsafe-reference`, `invalid-encoding`,
`empty-text`, `protected-document` and `invalid-pdf`. Archive validation codes remain
safe 422s. Resource exhaustion is 413; unsupported media is 415; unexpected
infrastructure failures remain server errors. The UI allowlists refusal codes.

Normalization failure creates no source/study. It does **not** promise cleanup of
an already retained original or queued intake receipt, or rollback of later writes.
Successful production responses retain the intake receipt and additionally return
`normalizationRevisionId`; the picker uses that identity to show readiness honestly.

## Synthetic-only checks

`vitest run packages/ingestion/tests apps/server/src/multiformat-upload.integration.test.ts`
checks parsers and the real production intake/storage/reader path. Provider and worker
tests capture only local synthetic wire traffic. After `bun run build`, run:

```sh
./node_modules/.bin/playwright test --config tests/e2e/ten-18.playwright.config.ts
```

The browser fixture serves the built app on an ephemeral loopback port, uses real
upload controls and persistence, and records 375/768/1280px captures. Its provider
availability is synthetic and Send creates consent without a live call; actual
range serialization is independently exercised through loopback provider wire tests.
Chromium evidence is not actual Safari verification or live provider verification.

`packages/ingestion/tests/pdf-subprocess.test.ts` exercises a tiny real PDF at a
lowered character threshold, a non-completing child timeout, 4 KiB stdout against a
1 KiB budget, the real V8 heap argument, and real SIGABRT classification. The abort
fixture simulates the termination signal, not actual heap exhaustion or hard RSS
containment. No giant hostile allocation is used.
