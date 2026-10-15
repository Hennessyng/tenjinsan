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

In the TTY, choose `p` to provision, then enter your own email, name and any
non-empty password twice. The limit is 128 characters. This command rejects
pipes and arguments.
Only one owner can be provisioned. If the password is lost, stop the running
processes and run `bun run owner` again, choosing `r` for reset. It invalidates
old sessions. Preserve the same `AUTH_SECRET` across restarts.

### Private owner recovery confirmation

Stop your installation with Ctrl-C or SIGTERM, wait for `local-stopped` and every
child to exit, then run `bun run owner` and choose `r`. Enter and confirm the
password privately: UTF-8 typing/paste and complete-character backspace preserve
the literal input, including spaces and non-ASCII characters. No normalization is
performed. The unchanged limit is 1–128 JavaScript string units (a supplementary
character uses two); mismatch, empty, over-limit or interrupted entry leaves the
working credential unchanged. Never pass credentials in command arguments.

Keep the same secret and aligned database/private paths. Run `bun run start:local`,
wait for `local-ready`, sign in at the API origin `/login` (by default
`http://127.0.0.1:8787/login`), and confirm authenticated `/api/library-context`
returns 200. A plain health response is not authenticated confirmation. Old sessions
are invalidated by reset, not by an ordinary restart; do not restore pre-reset
database snapshots or rotate the secret as a recovery workaround.

Automated disposable proof does not explain a historical failure or confirm your
private entry. Only you may change this allowlisted receipt from `pending` to
`confirmed` or `blocked`; omit optional diagnostic fields unless actually observed:

```json
{
  "revision": "reviewed revision / working-tree identity",
  "confirmation_stage": "pending",
  "reset_status": "pending",
  "start_status": "pending",
  "login_status": "pending",
  "protected_status": "pending"
}
```

Optional fields are `trace_id`, `category` and `status`. Never include email,
passwords, cookies, tokens, sensitive paths, private content or raw errors.

Failed form logins display a debugging reference (`trace_id`). It matches the
response's `X-Trace-ID` and `X-Request-ID` headers and the server's JSON login
event. Match that UUID in server output to distinguish invalid credentials,
validation, origin, session, rate-limit or internal failures. Logs never include
email, password, session cookies or raw authentication errors. A trace identifies
one HTTP request, not the owner account or the separate owner CLI invocation.
The public failure stays generic so it cannot reveal whether an email exists.

Run the isolated real CLI/server/browser regression with:

```sh
bunx vitest run tests/deployment/owner-login-journey.test.ts --maxWorkers=1
```

It uses a controlling terminal, temporary data and synthetic credentials; it
does not reset your owner. Sanitized receipts and failure screenshots are saved
under `.omo/evidence/reading-studio/owner-login-journey/`.

Wait for `LOCAL_EVENT` with `event: local-ready`, then visit
`http://127.0.0.1:8787/login`. An HTTP 200 at `/health` checks API/DB readiness;
`http://127.0.0.1:4173` is the Vite studio. Sign in at the API origin. The
launcher requires `SERVER_HOST=127.0.0.1`, `TRUST_PROXY=0`, distinct
`SERVER_PORT`/`STUDIO_PORT`, and `AUTH_BASE_URL`/`TRUSTED_ORIGINS` equal to
the loopback API origin. Relative data paths resolve from the workspace root;
absolute private paths (including spaces) work too. Preflight rejects unwritable
data paths, a missing owner and occupied ports before launching children.

## Live local diagnostics for agents

The local launcher prints `diagnosticEventsUrl` and `diagnosticEventsFile` in
its `local-ready` event. The API child stdout is also captured by the launcher;
allowlisted structured auth and security events are written as JSONL to
`PRIVATE_DATA_ROOT/diagnostics/events.jsonl`, with private directory/file modes.
The launcher exposes a temporary loopback-only HTTP reader. Query one trace without
reading the terminal scrollback or unrestricted process output:

```sh
curl --fail --silent 'http://127.0.0.1:<port>/events?trace_id=<uuid>'
```

Use the exact `diagnosticEventsUrl` from `local-ready` (append
`?trace_id=<uuid>`). The endpoint supports GET only, validates UUIDs, rejects
non-loopback Host headers, and returns only strict allowlisted fields. No request
bodies, credentials, cookies, tokens, or arbitrary startup logs are captured.
The JSONL file is capped at 2 MiB; events over 4 KiB or beyond the cap are dropped.
The temporary endpoint stops with the launcher; the file is truncated at the next
launch, not preserved across restarts. Delivery is best-effort and bounded: an
observed stdout UUID does not prove file retention. Query an observed failure
before restarting, and never infer a failure cause from absent evidence. Do not
delete a database or private library just to clear diagnostics. `bun run test:local-logs` checks filtering,
redaction, and loopback-host enforcement.

An agent running in the repository can query the captured trace directly from
the private JSONL file, without needing access to the launch terminal or
discovering the temporary reader port:

```sh
bun run local:logs -- --trace-id <uuid>
```

The command reads `.env` for the same private data root as the app and prints
only the requested safe event(s). Give it the browser's `trace_id`; it does not
accept or print passwords, cookies or request bodies.
Repository-local Bun command reporting is disabled so rejected argument values
are not echoed by the launcher before the diagnostic script can validate them;
script output and exit statuses are unchanged.
Successful retained evidence exits 0. Missing files or no matching retained event
return JSON with `evidence: "unavailable"`, `events: []`, generic before-restart
guidance and exit 1; this does not identify a retention/delivery or authentication
cause. Malformed arguments exit 2; corrupt/unallowlisted evidence fails closed with
a generic read error. The matching `requestId` and `trace_id` must be identical.

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
