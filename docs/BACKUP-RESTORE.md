# Logical backup, restore and deletion

These are terminal-only operator commands, not HTTP endpoints. Keep the API and
worker running against the same SQLite database and private-data root. A command
requests maintenance, drains admitted requests and jobs, freezes writes, then
takes the logical snapshot or performs the restore. New requests are refused
while maintenance is active. The command itself makes no provider call, but a
previously dispatched call may still complete or incur a charge.

Install `age` on PATH (tested with 1.3.2). Run from a real controlling terminal:

```sh
bun run library backup /private/location/library.age
bun run library restore /private/location/library.age
bun run library delete-project STUDY_ID
bun run library delete-source EDITION_ID
bun run library maintenance-recover
```

`bun run library --help` prints usage without a TTY. Every real operation
requires a controlling TTY; passing a noninteractive override cannot bypass
the terminal check or the age passphrase prompt. Deletion requires
typing `delete-project STUDY_ID` or `delete-source EDITION_ID` on the controlling
terminal; piped confirmation is not accepted.
`DATABASE_PATH` and `PRIVATE_DATA_ROOT` select the library, as for the application.
Initialize and provision the destination owner with `bun run owner` first. Restore
requires an empty **domain** library; existing destination owner credentials,
sessions and installation identity are allowed and are not imported or replaced.
Deletion is irreversible at the application level. Back up first if needed.
The archive transfers content between **separately provisioned owners**, not
sessions or credentials. Hosted operators use the trusted API container with
the shared private-data volume and an interactive terminal; see the exact
[Compose command](../deploy/README.md#persistence-and-recovery). Do not copy
the database out of a running container to run this CLI elsewhere. For a
separate physical volume snapshot, stop all writers first and preserve the
entire private-data volume, SQLite WAL included, with UID/GID 1000, plus
protected Compose secret and certificate volumes. A physical snapshot does
not remap owner identity.

The maintenance request waits at most 30 seconds to acquire the writer and
drain admitted work. In-flight requests, running jobs and uncertain or
dispatching provider attempts block the freeze; timeout fails without an
archive or committed restore. Check job status and provider billing before
deciding whether to stop or explicitly retry an unknown paid attempt. Never
assume a timeout means the provider was not called. A failed command normally
releases maintenance. If the operator crashes and leaves the gate draining or
frozen, first confirm no maintenance operator is still running, then use
`bun run library maintenance-recover` at a controlling TTY and type the
requested confirmation. Recovery clears the gate and admitted-request markers,
not uncertain attempt history. It refuses recovery while a restore is active;
do not force a reset or delete the SQLite WAL. After recovery, inspect job
status and retry the backup only when safe.

## What the archive contains

The age-encrypted payload is a version-1 logical JSON archive for storage schema 10.
Its explicit table **and column** allowlist contains source/project/revision data,
saved interviews, normalized source indexes, attempt metadata and referenced
immutable blob bytes. Inline attempt responses and published output bytes become
hash-addressed archive blobs. Unreferenced files are not collected.

The archive has a manifest SHA-256 plus SHA-256 validation for each referenced blob.
It is not a copy of SQLite, a WAL file, a filesystem directory, or a SQL dump.
Authentication identities, account/password records, sessions, verification tokens,
API configuration/secrets, source installation identity and lease tokens/fences
are never exported. Source owner links become the constant, non-identifying
`historical-owner` handle; destination ownership is assigned during import.
This does not anonymize text or source documents the reader entered themselves.

The age CLI owns the passphrase prompt on the controlling TTY. Logical archive
bytes pass through process pipes; no plaintext archive file is staged. The application
does not accept a passphrase argument, environment variable, stdin pipe or config
field. It neither reads nor logs the passphrase. Keep the passphrase separately:
there is no password recovery. Existing archive paths are never overwritten.

## Restore behavior

```text
age decrypt -> private staging -> schemas + relationships + hashes
                                    |
                                    v
                    empty-library check under writer lock
                                    |
                                    v
                 verified immutable blobs -> atomic domain commit
```

Staging uses a newly constructed validation database, not an imported physical
database. It checks strict record schemas, duplicated column/index consistency,
foreign keys (including historical publication records), source scope/span
relationships, manifest completeness and blob hashes. Unknown versions, tables,
columns, path-like hashes, duplicate entries, dangling references and content
collisions fail closed. Existing destination blobs are verified, never overwritten.
New blob files are synced and linked before the single domain commit; handled
failures roll back domain rows and remove newly linked files. Authentication rows
are never written. A process/host crash can leave unreferenced staging files or
blobs, but cannot commit a domain row pointing to a not-yet-installed blob.

Every imported job and generation run is paused. Jobs carry historical grants,
no lease, and reason `restored`. Existing workers cannot claim them or authorize
them with a historical grant. Create fresh destination consent and a new job to
perform cloud work; this command does not silently resume/retry interrupted calls.
Unknown external outcomes remain unknown.

Brief/outline/publication decisions, privacy reviews, released publication
snapshots and output metadata remain in the non-authorizing `backup_history`
table, wrapped with the historical owner handle. Their referenced output/asset
bytes are preserved, but imported publications are **not live downloadable
releases**. Rebuild a publication through the destination review workflow.
Imported evidence drafts have `privacyReviewed=false` and `keepPrivate=true`.
Fresh destination privacy review and publication approval are mandatory.
Historical approvals embedded in immutable content are provenance, not newly
inserted approval rows. A later backup retains that history.

## Deletion and retention limits

Project deletion removes the project and its dependent relational records; it
retains the source and sibling projects. Source deletion also removes dependent
projects. Shared blobs still referenced by retained domain/history records remain.
The `sharedBlobs` result lists hashes still referenced by retained domain/history
records (including unrelated retained content). Unreferenced blobs are unlinked
after the domain deletion commits; any failed
unlink is reported in `retainedBlobs`, not silently described as erased.
Authentication and owner records are outside the deletion allowlist.

**Logical deletion is not secure erasure.** SQLite freelist/WAL pages, filesystem
snapshots, SSD remapping, operating-system caches, swap and existing backups may
retain copies. Restore validation staging is private (directories 0700, files
0600) and is unlinked on normal completion/failure, not securely wiped. A crash
can leave private validation or ciphertext staging directories (`.restore-*`,
`.age-backup-*`); remove these offline after confirming no operation is running.
Use encrypted storage and manage backup/snapshot retention separately. Do not
claim that deleting a source removes copies in older encrypted archives.

The current archive implementation buffers JSON/blob base64 in memory; provision
memory/disk for the logical payload and private staging. This is not a streaming
backup service or an online migration protocol.

## Verification

`bun run test:integration` includes real SQLite tests and real age CLI pseudo-TTY
tests. Install `expect` as well as `age` to run the latter; missing executables
fail tests rather than silently skipping encryption coverage. All content is
synthetic; no live providers or private reference inputs are used.
`bun run --cwd packages/storage lifecycle:qa` exercises backup help, TTY
backup/restore, owner reads and confirmation with disposable synthetic libraries.

Evidence: `.omo/evidence/reading-studio/task-30/DoneClaim.json`.
For current synthetic deployed export evidence see Task31's
`DoneClaim-verifier-fix-v2.json`; its original DoneClaim remains historical
and `reconciliation.md` explains the reused unversioned PDF paths.
