# Development and verification

Node.js 24.19.0 runs the API, worker, Vite, Vitest and Playwright. Bun 1.4.2
owns workspace installation and script dispatch. Use `bun install --frozen-lockfile`;
do not change host trust settings solely to run an untrusted `mise.toml`. The
selected app stack is React/Vite, Hono, Better Auth, SQLite/Drizzle, persisted
worker jobs, Playwright/Chromium, and a Caddy reverse proxy in Compose.

| Command | Real scope |
| --- | --- |
| `bun run typecheck` | TypeScript project references |
| `bun run lint` | Biome checks; informational suggestions are not errors |
| `bun run test:unit` | Contracts, reader, ingestion, export and owner unit checks |
| `bun run test:integration` | SQLite, API, worker and provider protocol fixtures |
| `bun run test:e2e --workers=1` | Browser workflows, including deployed synthetic journeys |
| `bun run test:exports --workers=1` | Offline HTML, print and PDF browser checks |
| `bun run test:deployment --maxWorkers=1` | Real local/Compose readiness and isolation |
| `bun run test:live` | **Optional paid** synthetic live smoke, only with a provider API key and `LIVE_SMOKE_CONSENT=yes`; otherwise BLOCKED, exit 2 |
| `bun run start:local` | Loopback launcher for API, Vite and worker |

Run the browser/deployment suites sequentially. Shared SQLite fixtures and
ports can contend under parallel suites. `bun run build` builds all packages,
studio, API and worker. Install pinned Playwright Chromium before browser suites;
Poppler utilities and `age` plus `expect` are needed for export and lifecycle QA.
For normal owner use follow [LOCAL.md](LOCAL.md), not the standalone dev servers.

The root `.env` is loaded by Node using `--env-file-if-exists`; inherited values
take precedence. Missing or malformed fields fail before the server opens a
socket. `VITE_ENABLE_REACT_DEVTOOLS=1` enables development overlays only. Never
enable `STUDIO_SYNTHETIC_TEST_MODE=enabled` for a real owner's library: it is a
controlled synthetic test pathway, not a production provider.
