# Question-led Reading Studio

A single-owner, private reading workspace for EPUB study. The owner imports a supported
EPUB, chooses reading questions and source scope, reviews a brief and outline, approves
privacy and publication, then downloads bilingual HTML and PDF. Local operation and
private Compose hosting are supported. A synthetic-fixture journey is reproducible
without an AI account; that does **not** establish live provider success or authorize
using a private book in tests.

```text
browser -> React authoring app -> Node 24 Hono JSON API -> SQLite + private blobs
                              |
                              +-> worker -> approved provider calls / offline rendering
local: Vite on loopback       hosted: Caddy HTTPS -> internal API
```

## Choose an installation

- [Local owner setup](docs/LOCAL.md): Node.js 24.19.0, Bun 1.4.2, a terminal,
  enough disk space for EPUBs and outputs, and Chromium for PDF rendering.
- [Private hosted setup](deploy/README.md): Docker Engine with Compose on Linux
  amd64/arm64, browser sandbox support, an owner-controlled domain for public HTTPS,
  and persistent volumes. A local-CA Compose verification needs no public domain;
  it is not proof of public certificate issuance.

Both modes start with exactly one owner, provisioned from a real interactive terminal.
There is no public signup. Before first use, protect the local `.env` or hosted
`deploy/.env` and provide a random `AUTH_SECRET` of at least 32 characters. Never
pass a password, passphrase, or API key as a command argument. The owner password
must be 12 to 128 characters.

## Local quick start

From the repository root, with pinned Node and Bun on PATH:

```sh
bun install --frozen-lockfile
cp .env.example .env
chmod 600 .env
# Edit .env privately: set AUTH_SECRET; keep the loopback origins and ports aligned.
bun run owner
bun run start:local
```

At the owner prompt choose `p`, then type email, name, password and confirmation.
Open `http://127.0.0.1:8787/login` and sign in. API health is
`http://127.0.0.1:8787/health`; the separate Vite studio is
`http://127.0.0.1:4173`. Wait for the `local-ready` event before using either
surface. `Ctrl-C` stops the launcher and its children; the SQLite database and
private blobs remain. Run `bun run start:local` again to resume. Do not copy real
books into the repository or share `.env`, `data/`, screenshots of private content,
or provider receipts. See [local setup and fixture checks](docs/LOCAL.md).

## Verify the synthetic workflow

After installation, with Playwright Chromium installed and no other studio using
the default test ports, run these synthetic-only gates sequentially:

```sh
bun run typecheck
bun run lint
bun run test:e2e --workers=1
bun run test:exports --workers=1
bun run test:deployment --maxWorkers=1
```

The deployed fixture journeys are `tests/e2e/task-31-deployed.spec.ts` and
`tests/e2e/task-31-compose.spec.ts`. They create disposable owners, source text,
consent and offline outputs; the synthetic provider is **test-only**, not an
offline replacement for live AI. For the exact browser command see
[local setup](docs/LOCAL.md). Screenshot and receipt trees under `.omo/evidence`
are local QA output, not part of this repository.

The normal-deployment failure matrix is `tests/e2e/task-31-normal-matrix.spec.ts`.
It drives the actual API, worker, Chromium owner UI and loopback AI SDK wire in
both modes without `STUDIO_SYNTHETIC_TEST_MODE`. Run it with
`bun run test:e2e task-31-normal-matrix --workers=1`.

## Boundaries and operations

- [Consent, providers and costs](docs/CONSENT-PROVIDERS.md): OpenRouter/Anthropic
  server keys and official Codex subscription sign-in. Models are rechecked at Send;
  missing access disables transmission. Historical direct OpenAI work is inert.
- [Privacy and access](docs/PRIVACY-SECURITY.md): what remains local, what a grant
  sends externally, what a downloaded artifact contains, and deletion limits.
- [Backup, restore and deletion](docs/BACKUP-RESTORE.md): coordinated maintenance
  and age-encrypted logical archive to a separately provisioned owner, not a
  session migration.
- [EPUB and output limits](docs/OUTPUT-LIMITS.md): selective coverage, edition
  anchors, file:// HTML, static fallback and PDF limits.
- [Bundled licenses](docs/LICENSES.md) and [developer checks](docs/DEVELOPMENT.md).

There is no automatic sync, public account service, forensic erasure guarantee,
free cloud AI, production domain supplied by this project, or claim that a
synthetic lesson evaluates a reader's private book.
The normal API and worker now run the consent-bound stages and offline output
rendering without the synthetic flag. A local loopback protocol fixture verifies
that path, not live OpenAI/Anthropic success, private-book teaching quality or
public TLS. React/Vite owns the authenticated authoring flow, including `/jobs`.
Hono serves the built app and authenticated JSON APIs, not authoring pages.
Anthropic uses the backend Vercel AI SDK, OpenRouter its authenticated API, and
Codex the official OAuth/App Server. Ordinary local and Compose
journeys were verified with synthetic loopback wire JSON replies, not live model
semantics, paid calls or private-book quality. Real-book two-angle source studies
remain BLOCKED without private permission, two books/lenses and live source checks;
F4 is `[~]`. No live Codex/OpenRouter or two-book success is claimed.
