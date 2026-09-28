# Local single-owner setup

Use Node.js 24.19.0 and Bun 1.4.2 on PATH. Chromium (via Playwright) is required
to render a PDF, and Poppler is used by PDF verification. The launcher runs only
on loopback, not as a service. Start in the repository root:

```sh
bun install --frozen-lockfile
cp .env.example .env
chmod 600 .env
# Set AUTH_SECRET to a random private 32+ character value in .env, not in argv.
# Optionally set DATABASE_PATH and PRIVATE_DATA_ROOT to private writable paths.
bun run owner
bun run start:local
```

In the TTY, choose `p` to provision, then enter your own email, name and a
12-to-128-character password twice. This command rejects pipes and arguments.
Only one owner can be provisioned. If the password is lost, stop the running
processes and run `bun run owner` again, choosing `r` for reset. It invalidates
old sessions. Preserve the same `AUTH_SECRET` across restarts.

Wait for `LOCAL_EVENT` with `event: local-ready`, then visit
`http://127.0.0.1:8787/login`. An HTTP 200 at `/health` checks API/DB readiness;
`http://127.0.0.1:4173` is the Vite studio. Sign in at the API origin. The
launcher requires `SERVER_HOST=127.0.0.1`, `TRUST_PROXY=0`, distinct
`SERVER_PORT`/`STUDIO_PORT`, and `AUTH_BASE_URL`/`TRUSTED_ORIGINS` equal to
the loopback API origin. Relative data paths resolve from the workspace root;
absolute private paths (including spaces) work too. Preflight rejects unwritable
data paths, a missing owner and occupied ports before launching children.

Stop with `Ctrl-C` or SIGTERM and wait for `local-stopped`. The data remains in
`DATABASE_PATH` and `PRIVATE_DATA_ROOT`; a second `bun run start:local` resumes
with the same owner. Repeated shutdown should not require deleting the database.
For a stalled startup, stop the launcher, inspect the named error field and
occupied ports, then correct `.env`; do not remove a live SQLite WAL file.

## Fixture check without a provider credential

The installed Playwright Chromium and PDF tools are needed. With the launcher
stopped, run:

```sh
bun run test:e2e -- task-31-deployed.spec.ts --workers=1
```

This test creates its own disposable data root and test owner, imports a synthetic
EPUB, grants **fixture-only** transmission, makes reading choices, approves brief,
outline and privacy, publishes HTML/PDF and opens the HTML after shutdown. It
does not use your `.env` library or make a paid provider request. It is not a
command to generate an AI lesson from your book. Keep the test-only
`STUDIO_SYNTHETIC_TEST_MODE` disabled for ordinary use. The equivalent hosted
fixture runs through `task-31-compose.spec.ts`; see [hosted setup](../deploy/README.md).

To move content between owners, follow [coordinated backup and restore](BACKUP-RESTORE.md)
instead of copying sessions. The most recent Task31 fixture evidence is the
versioned `DoneClaim-verifier-fix-v2.json`, not the historical unversioned PDFs.
