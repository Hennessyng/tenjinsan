# Bounded EPUB intake (Task 9)

`POST /api/imports/upload` accepts the original EPUB bytes with
`Content-Type: application/epub+zip`, an owner session, and the trusted Origin.
Multipart uploads are deliberately rejected (415); filenames are never used.

The server streams into a generated `import-*` directory (0700) under
`PRIVATE_DATA_ROOT`, retaining `original.epub` (0600) and its SHA-256.
Rejected or interrupted uploads are removed. No entry is extracted to disk.

Limits: 50 MiB compressed, 200 MiB decompressed, 5,000 entries, 20 MiB per entry.
Both declared sizes and actual streamed output are bounded. Encryption metadata
has a further 1 MiB cap. CRC errors, truncated/inconsistent ZIPs, duplicate paths,
traversal, absolute paths, symlinks, ZIP encryption, and encrypted text fail closed.
IDPF/Adobe font-only obfuscation is allowed for existing font paths. XML is read
locally with DTD/entities forbidden, without resource requests. ZIP64 and split
archives are unsupported. HTTP errors expose codes, not filenames or paths.

Success (202) returns a generated ID, original hash, byte counts, entry count,
and `state: "queued"`. The private `queued.json` receipt includes the owner ID;
it is synced and atomically published only after validation. This is an intake
queue, not a generation job: the generation-job contract requires a study setup
and transmission grant. The application now consumes accepted import receipts
in its source workflow. An abrupt process kill can leave an incomplete intake
directory without a queued receipt; it must not be treated as an accepted import.

The private root and its ancestors must be controlled by the server account;
the root itself may not be a symlink. Per-upload limits do not constitute a
global disk/concurrency quota.

```sh
bun run test:unit -- archive
bun run test:integration -- upload
node --experimental-transform-types apps/server/src/testing/upload-manual-qa.ts
```

Tests and manual QA use only synthetic EPUBs and loopback HTTP with a real owner
login. The QA driver removes its temporary database and uploads on exit.

## Read-only normalization (Task 10)

`@reading-studio/ingestion/normalize` exports `normalizeEpub(file: FileHandle)`.
The caller owns the open original file. The parser reuses bounded ZIP inspection,
reads container/OPF/spine, prefers EPUB3 navigation and falls back to the spine's
EPUB2 NCX. It returns ordered `chapters`, `navigation`, `pages`, `skipped` and
`coverage`; it does not persist sources or consume queued receipts.

Chapters retain `main-chapter` or `supplementary` roles (`linear="no"` and navigation
spine entries are supplementary). Blocks carry normalized plain text, heading
levels, fragment anchors and publisher page labels. Empty anchors are retained.
Text outside the spine is explicitly reported as supplementary/excluded rather
than silently joining the main chapters. Missing, non-text or empty spine content
makes coverage partial; non-spine assets and stripped elements are reported.

No DOM/browser, evaluator, resource resolver or network client is used. Scripts,
styles, embedded documents/media and foreign namespaces are omitted; attributes
other than text locators never reach output. Output is plain text, not trusted HTML:
consumers must render it as text, including literal angle brackets in book prose.
DTD declarations (including external entities), malformed XML, unsafe references,
encrypted text and invalid package structure fail closed with explicit errors.
Font-only obfuscation retains the Task 9 policy. XML is UTF-8, bounded to 128 nesting
levels and 100,000 elements per document; remote package references are rejected.

```sh
bunx vitest run packages/ingestion/tests/normalize.test.ts
```

The test driver writes synthetic ZIPs to isolated temporary directories, opens
them through the public parser and removes them on exit. It checks real hostile
XHTML, scripts/handlers/CSS/resource URLs, entity payloads, ordered navigation,
coverage failures, and encrypted chapters without loading a viewer or making
network requests. Application persistence, citation IDs and UI are separate
from this package API; see the root README for owner setup.
