# Edition-aware sources (Task 11)

`prepareSourceDocument(file, { title })` from
`@reading-studio/ingestion/source-document` hashes the original EPUB and runs the
bounded parser. The caller owns the immutable original file handle. Defaults are
`epub-parser-1` and `epub-normalizer-1`; parser/normalizer releases must bump the
corresponding revision when their output changes.

Pass the result to `storage.sources.persistDocument(document)`. SQLite commits
the edition, revision, ordered resources and blocks atomically. Repeating the
same original bytes and revisions reuses the source, including after restart.
Changing either revision creates a separate normalization; changing original
bytes creates a separate edition even if the extracted prose is identical.
Existing source content is immutable. A repeated title does not rename an edition.

Block IDs hash the original digest, normalizer revision, resource path, parser
revision and block position. Empty anchors/page markers retain their own blocks.
The existing intake retains original files; this adapter neither consumes its
queue nor copies/deletes those files.

`appendSpan(span)` validates the exact edition/revision/resource/block, nonempty
UTF-16 `[start, end)` range and publisher metadata, then stores the citation with
a deterministic digest ID. For blocks without an original anchor, use the
resource path as `originalFragment`; page labels must match the stored block.
`resolveSpan(id)` returns `{ span, text }` from persisted sources or `null` for
an unknown ID. Empty marker blocks cannot supply a nonempty citation.

Verification: `bunx vitest run packages/storage/tests/source-citations.integration.test.ts`.
Synthetic EPUBs exercise the actual parser and SQLite, including citation reads
from a fresh Node process, revision reuse/separation, rollback, forged metadata,
invalid offsets and cross-edition rejection. No viewer or provider is involved.
