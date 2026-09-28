# Private hosted installation

This procedure is for an owner-controlled host. It does not supply a domain,
certificate account, owner password or AI credential.

```text
Internet -> Caddy :80/:443 -> API (internal network)
                               |
                          private-data volume <- worker (separate network)
```

Requires Docker Engine with Compose, Linux amd64/arm64, and unprivileged user
namespaces enabled for Chromium. Do not disable the browser sandbox to accommodate
an unsupported host. Only the proxy publishes ports. SQLite is a file, not a DB
server. No Docker socket, host networking, host IPC, or privileged containers are used.

## First installation

Point your own domain's DNS at the host; allow inbound TCP 80 and 443. Set one canonical
HTTPS origin, with no path, trailing slash, credentials, query, or nonstandard port.
The API derives both its authentication URL and allowed origins from that value.

From the repository root:

```sh
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
# Edit deploy/.env privately: replace the example with YOUR HTTPS domain.
# Generate a 32+ character AUTH_SECRET privately (openssl rand -hex 32 is one option).
# Put it in deploy/.env using an editor, never in command arguments or logs.
docker compose --env-file deploy/.env -f deploy/compose.yml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.yml build
docker compose --env-file deploy/.env -f deploy/compose.yml run --rm --no-deps api \
  node --experimental-transform-types scripts/owner.ts
docker compose --env-file deploy/.env -f deploy/compose.yml up -d --wait
docker compose --env-file deploy/.env -f deploy/compose.yml ps
```

The owner command requires an interactive terminal and prompts for credentials;
never put a real owner password in command arguments or Compose settings. Choose
`p`, then enter your email, name and password twice. Visit `/login` on your
actual `CANONICAL_ORIGIN`. Check `/health` and that all three services are
healthy with `compose ps`. Caddy attempts automatic certificate issuance and
renewal for a reachable public domain; local `https://localhost` uses a local
CA and cannot prove public ACME issuance.
Missing origin/secret stops Compose; malformed origin/short secret stops the API
before listening. An unprovisioned owner also prevents API readiness.

Treat `deploy/.env` and Docker daemon access as privileged. `compose config` without
`--quiet` renders secrets; do not paste its output into tickets or public logs.
Keep the same secret when recreating containers to preserve existing sessions.
`deploy/.env.example` contains a documentation-only hostname, not a real domain.
Optional `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` values in `deploy/.env` are
forwarded to both API (setup availability) and worker (dispatch). Leave them empty
to disable calls. A key alone does not grant permission: each source scope still
requires the owner's explicit Send decision. No live provider success is claimed
without a credentialed, consented run. See [provider limits](../docs/CONSENT-PROVIDERS.md).
Standard Compose omits `STUDIO_SYNTHETIC_TEST_MODE` altogether, even if set on
the host. Only `tests/deployment/compose-synthetic.yml` opts fixture tests in.
Keys reach the API and worker, never React or Caddy.

## Isolation and readiness

- App/worker use UID/GID 1000, read-only root filesystems, dropped capabilities,
  no-new-privileges, private IPC and bounded tmpfs. The volume is owned by UID 1000
  with mode 0700; the launcher uses umask 077. Never serve `/data` as static content.
- API and worker have no published ports. The API network is internal; the worker
  has a separate egress network and no listener. It receives no authentication secret.
- Caddy also runs as UID/GID 1000, with owned certificate/config directories.
  It keeps its admin listener on container loopback only. Its only added
  capability is NET_BIND_SERVICE. Certificate/config volumes are separate from
  private project storage, which is not mounted in the proxy.
- API health checks the database and the canonical-host HTTP health endpoint.
  Worker startup launches real Chromium with `chromiumSandbox: true`, checks
  namespace/PID/network/seccomp status, then starts the persisted-job worker.
  Readiness checks both SQLite access and a fresh event-loop heartbeat. This does
  not prove successful provider output.
- CPU, memory, PID, shared-memory, log-size and shutdown limits are enforced by
  Compose. The proxy waits for healthy API and worker services.
- The worker syscall policy is the no-capability amd64/arm64 subset of
  [Playwright 1.63.0's Docker profile](https://github.com/microsoft/playwright/blob/v1.63.0/utils/docker/seccomp_profile.json).
  Namespace creation and namespace-local `chroot` are allowed; host capabilities
  remain dropped. Newer libc syscalls are included and clone3 returns ENOSYS so
  libc uses clone. Browser configuration/cache writes stay in tmpfs.
- Node 24.19.0, Bun 1.4.2 and Caddy 2.11.2 base images are digest-pinned. Playwright
  1.63.0 and its Chromium revision come from the frozen lockfile; Debian bookworm
  dependencies are installed with that exact Playwright version's installer.

## Persistence and recovery

From the repository root, use the same project and env file throughout:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yml down
docker compose --env-file deploy/.env -f deploy/compose.yml build
docker compose --env-file deploy/.env -f deploy/compose.yml up -d --wait
docker compose --env-file deploy/.env -f deploy/compose.yml ps
```

`down` stops without deleting volumes; `up` restarts with retained data.
**Never use `down --volumes` on a real installation.** For a physical volume
snapshot, stop all writers first and include SQLite's WAL and private blobs.
Preserve `private-data` (SQLite
including WAL and private blobs), `caddy-data` (certificates), `caddy-config`
and the separately protected `deploy/.env`. Keep the same Compose project name
and `AUTH_SECRET`. After rebuilding, check login, health and service status.
If startup fails, stop services and restore a quiesced volume snapshot with
UID/GID 1000 and the matching secret and certificate volumes. Do not copy an
active SQLite file without its WAL or remove it to clear a lock.

For a portable encrypted **logical** backup, keep the API and worker running and
use the age-enabled `library` CLI inside the API container from a trusted
interactive host terminal. From the repository root, after provisioning the
destination owner separately, run on the appropriate source or destination
Compose project (never restore onto an occupied domain library):

```sh
docker compose --env-file deploy/.env -f deploy/compose.yml exec -it api \
  node --experimental-transform-types scripts/library.ts backup /data/library.age
docker compose --env-file deploy/.env -f deploy/compose.yml exec -it api \
  node --experimental-transform-types scripts/library.ts restore /data/library.age
docker compose --env-file deploy/.env -f deploy/compose.yml exec -it api \
  node --experimental-transform-types scripts/library.ts maintenance-status
docker compose --env-file deploy/.env -f deploy/compose.yml exec -it api \
  node --experimental-transform-types scripts/library.ts maintenance-recover
```

`/data` is the private UID/GID 1000 volume shared by API and worker. The logical
archive shares a maintenance lock: it pauses new work, drains admitted activity
and freezes writes. An unresolved provider outcome blocks the backup. The CLI
needs an owner-controlled TTY and encryption passphrase. This isn't a physical
snapshot of the live volume. For crash recovery, stop all API and worker
processes and confirm the operator is gone; uncertain paid attempts remain.
Transfer
only the encrypted `.age` file between installations through a protected channel;
keep its passphrase separate. The container root filesystem is read-only, so
write the archive on that volume and move it using a trusted operator process
with volume access. Never expose that volume as a public download. Do not place
the passphrase or a noninteractive TTY override in arguments, Compose settings
or logs. Confirm no operator is still active before `maintenance-recover`;
an unknown paid attempt remains unknown.
Imported grants are inert; no old credentials or sessions migrate. Protect any
copies and verify the destination before retiring the source. This is manual
recovery, not a managed backup or automatic sync.

## Local hosted verification

```sh
bun run test:deployment -- hosted
```

The test builds real images, uses a unique project/volumes and ephemeral loopback
ports, provisions only synthetic credentials through the existing fixture driver,
and trusts Caddy's local CA explicitly with curl `--cacert` (never `-k`). It checks
HTTPS login, secure cookies, cross-origin rejection, HTTP-to-canonical-HTTPS
redirect, private file isolation, no app/worker port bindings, and surviving owner
sessions/private bytes after forced container recreation. It removes only its own
test volumes. Invalid/missing configuration is tested as well.

Production must use a real domain. Public DNS, ACME issuance, external firewall
behavior and production traffic remain unclaimed by the local-CA test.
React owns the authoring routes; Hono serves its built assets and authenticated
JSON APIs, not authoring pages. The backend worker uses the Vercel AI SDK for
analysis, questions, outline and bounded persisted lesson-section jobs, then
reassembles sections in order. The final serialized SDK request body is capped
at 32,000 UTF-8 bytes before reservation or network dispatch. A setup shares
at most 64 provider attempts across all stages, runs and lesson sections.
The owner `/jobs` ledger offers pause/cancel, retry and unknown-outcome stop or
retry decisions. A running cancellation needs explicit acknowledgment: an
accepted call may still incur a charge. An unknown call might have incurred a
charge too; retry requires an explicit owner decision and may spend another
attempt. The ledger excludes prompts, source text and provider responses. Known
token usage isn't currency; usage can be unknown. Ordinary local and Compose
journeys passed with synthetic loopback wire JSON replies, not live model
semantics, paid calls or private-book quality. Real-book two-angle source studies
remain blocked without consent and credentials; F4 is `[~]`. Public TLS is unverified.
