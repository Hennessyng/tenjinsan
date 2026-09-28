# Private source viewer (Task 12)

After signing in on the API origin, use **Read your sources** on the owner home page.
React renders the owner source library and reader on the authenticated origin;
Hono serves the built app and owner-scoped `/api/source-library` and
`/api/source-reader/:revision` JSON data. No executable EPUB pages are embedded.

```text
/sources
  -> owned books / normalization revisions and pending import receipts
/sources/:revision?chapter=0
  -> chapter in persisted resource order (zero-based URL index)
/sources/:revision?citation=:sha256
  -> persisted citation, exact highlighted offsets and keyboard focus
```

Only editions associated with the signed-in owner's studies are readable. A citation
must belong to the requested normalization and edition. Invalid, missing, ambiguous
or unowned references return a recoverable 404; anonymous requests return 401.
React escapes source text, page labels, titles, paths and exclusion reasons by
default. The JSON responses are private/no-store; EPUB scripts and remote
resources are not loaded into the reader.

Page labels are publisher labels, not screen pagination. Missing labels and excluded
resources are explicit. Text is selectable; native links, details and focus targets
work in React. Citation offsets retain the storage contract's UTF-16 units.

Queued imports remain visibly **Awaiting normalization** until an owned normalized
edition exists. The source viewer reads committed receipts; separate import,
setup and worker routes handle normalization, provider selection and generation.

Run `bun run test:e2e -- source-viewer` for real owner login, SQLite-backed references,
keyboard navigation, hostile-text/invalid-link checks and responsive screenshots.
Tests use synthetic text and temporary databases only, never the protected EPUB.
