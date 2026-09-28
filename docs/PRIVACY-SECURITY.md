# Privacy and security boundary

There is one provisioned owner, no public signup, no automatic sync and no
public source library. Locally, the launcher binds to loopback. In Compose,
Caddy is the only published service; the API and worker share a private data
volume, while the proxy has no private-book mount. Protect host, Docker daemon,
`.env`, database, blob root, backups, logs and exported files with host access
controls and encrypted storage. TLS secures hosted transport but does not make
a compromised host or provider account safe.

Imported EPUBs, normalized text, choices, grants, receipts, generated lessons,
publication approvals and artifacts reside in local SQLite/private blobs. Content
may remain in WAL/freelist pages and host snapshots. A provider receives only
book-text windows selected by a current explicit transmission grant for that
provider/model/scope. This is external processing, subject to the provider's own
retention and billing terms. There is no implicit upload on import or preview.
Do not assume the application can verify that prose is truthful, anonymous or
non-infringing: inspect evidence, quotations, private details and visual assets
before publication.

Downloaded HTML serializes the approved cleaned publication projection plus
reviewed runtime/asset bytes, not account/session data, raw private interview or
unapproved source. The companion PDF is a static print composition. Both files
are portable copies: sharing or backing them up is your responsibility. Images
and fonts may carry metadata; byte validation is not anonymization. Do not
publish private source text, screenshots or credentials as fixture evidence.

Deletion via `bun run library` is a **logical** removal of a source or project
and its unreferenced blobs, not forensic erasure. Shared references remain;
SQLite pages, WAL, filesystem snapshots, swap, SSD remapping, downloaded files,
provider retention and old backups may retain copies. No automatic remote
deletion or sync is performed. See [backup/restore](BACKUP-RESTORE.md) for
quiescence, destination ownership and leftover staging after a crash.
