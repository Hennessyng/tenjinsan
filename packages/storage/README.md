# Storage

`@reading-studio/storage` persists shared contract records in SQLite. Writes parse
through `@reading-studio/contracts`; reads decode stored JSON through the same schema.
Immutable records are append-only, carry explicit parent references where the contract
has revision history, and are protected from SQL updates and deletes by migration
triggers. Every SQLite connection created by this package enables recursive triggers;
SQLite requires that connection-wide setting so `INSERT OR REPLACE` cannot bypass the
immutable delete triggers.

`openStorage` requires a caller-supplied database path and an absolute private data
root. `PrivateBlobStore` accepts only validated SHA-256 hashes and returns generated
content-addressed locations beneath that root. This package does not expose HTTP or
static-file serving.

```sh
bun run --cwd packages/storage build
bun run --cwd packages/storage test:integration
bun run --cwd packages/storage manual:qa
```
