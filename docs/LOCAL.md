# Local library setup — no application authentication

**Anyone who can reach the API or studio can access and change the library.**
Visitors can also request permitted provider work using configured server credentials.
This applies to both local and hosted operation. Origin/Host checks, body limits,
private-file URL isolation and worker safeguards are not user authentication.
Use external network restrictions if you do not want this exposure.

Use Node.js24.19.0 and Bun1.4.2. From the repository root:

```sh
cp .env.example .env
chmod 600 .env
# Keep DATABASE_PATH/PRIVATE_DATA_ROOT and trusted origins/ports aligned.
bun run start:local
```

Wait for `LOCAL_EVENT` `local-ready`, then open `http://127.0.0.1:8787/`
or the studio at `http://127.0.0.1:4173`. `/health` checks readiness.
No email, password, `AUTH_SECRET`, login or owner-provisioning command is required.
Old `/login` and `/logout` bookmarks return to `/`; authentication API endpoints
are retired with410. An optional `bun run owner` now initializes only the internal
library namespace and never prompts for or resets credentials.

The local launcher still requires `SERVER_HOST=127.0.0.1`, `TRUST_PROXY=0`, distinct
API/studio ports and `TRUSTED_ORIGINS` matching the API origin. Hosted startup retains
its separate canonical HTTPS-origin constraints. Legacy `AUTH_BASE_URL` and
`AUTH_SECRET` settings are ignored by application access configuration.

## Existing and fresh data

The existing singleton owner ID remains the library's internal data namespace.
No content is reassigned, and no users, credentials, sessions, studies or files are
deleted during this upgrade. Those legacy auth rows are inert for HTTP access.
A fresh library receives a persisted owner row, not a fake user/session/cookie.
Ambiguous owner state is an integrity error, not an invitation to pick or overwrite
an identity. Study-selection cookies remain preferences only, not authentication.

`Ctrl-C` stops the launcher and its owned children. Existing SQLite/private blobs
remain; restart with `bun run start:local`. Do not reset or delete a database to
repair access. For a physical snapshot stop all writers and retain SQLite WAL and
private blobs together. Never put real books in test fixtures or publish `.env`,
private data, provider credentials or screenshots of private content.

## Retained boundaries

- Mutations require an allowed Origin and supported content type; API and upload
  limits remain. Unknown/foreign resource IDs remain unavailable to the selected
  library namespace; arbitrary private filesystem paths are not public URLs.
- CSP, escaped source text, EPUB isolation and publication/evidence/approval fences
  remain. Removing login does not approve generation, external transmission or
  publication, and does not remove the worker's sandbox or lease/budget rules.
- Official provider/Codex authentication remains necessary for that external
  service. Keys/tokens stay server-side. See [provider consent](CONSENT-PROVIDERS.md).
- Backup/restore/deletion still require operator confirmation, passphrase TTY and
  maintenance/quiescence checks. These operator safeguards are not removed.

## Local security diagnostics

The launcher retains bounded allowlisted request-boundary events and prints its
temporary loopback diagnostic endpoint. Origin/size/resource failures keep a safe
UUID reference; no email/password/body/token/raw-error logging is added. No login
diagnosis, reason tracing or private checker is needed for this authentication-free
journey. Existing historical diagnostic artifacts do not describe current access.

## Verification

Disposable integration scenarios cover anonymous loopback and hosted-origin pages,
API access, password-free fresh setup, unchanged populated content/legacy auth rows,
retired login URLs and retained origin/size/file boundaries. Parent browser QA must
open hall and deep links without cookies, upload/read a synthetic EPUB, exercise
authoring and verify there are no login/logout/session-expiry gates. Do not use an
active installation or a private book as a test fixture.
