# Consent, provider access and cost

Only the explicitly chosen source scope and reviewed data categories may leave this
installation for a provider. The owner selects a book edition, a scope and a
provider/model in study setup, reviews the transmission, then chooses **Send**.
Draft, revise or cancel does not transmit source text. New setup revisions and
changed provider/scope need a new grant; a restored grant is history only. Keep
user-provided private source and personal context out of shared fixtures and logs.

| Provider | Model in current catalog | Credential |
| --- | --- | --- |
| OpenRouter | Account-offered structured-output models | server-side `OPENROUTER_API_KEY` |
| Codex | Official App Server account-offered models | Official subscription sign-in, private backend-owned credentials |
| Anthropic | `claude-sonnet-4-6` | server-side `ANTHROPIC_API_KEY` |

OpenRouter replaces direct OpenAI API-key dispatch; Anthropic remains available.
Historical direct-OpenAI jobs remain readable but cannot dispatch or retry.
API keys are separate from chat subscriptions. Codex uses only the official
OAuth/App Server connection, never scraping or a coding token sent to api.openai.com.
Setup and Send recheck the exact offered model. The studio enforces a 32,000-byte
serialized request ceiling before dispatch and a 6,000 output-token ceiling.
Codex has no studio max-output protocol field: oversized replies pause after receipt.
The runner uses recorded per-job call/token budgets and usage receipts,
with a durable 64-call cap across jobs for the same setup;
**provider charges and prices are not estimated or guaranteed by this app**.
Inspect provider billing separately before granting a call. Avoid entering API
keys in browser forms, command arguments, terminal history or evidence files.

For local use, leave the optional key fields empty until a credential is
available, then edit the private root `.env` and restart the local launcher.
The hosted `deploy/compose.yml` forwards optional keys from private
`deploy/.env` to API and worker. Restart both after changing it. Do not assume
a selectable option proves dispatch or successful generation. Do not put a key
in `CANONICAL_ORIGIN` or `AUTH_SECRET`.

Setup review explicitly grants selected book text, derived study material and
reader context from a later *approved* brief for the exact setup. Old book-text-only
grants cannot dispatch downstream stages. Full book text outside the chosen scope
is not granted. The worker checks the current revision,
grant, owner and scope at dispatch; no hidden provider switch or SDK auto-retry
occurs. A malformed response may use a separately budgeted schema-repair attempt;
Rejected access, expired or revoked sign-in, rejected keys and provider limits pause
with a sanitized explanation and logged trace_id. An unknown outcome pauses for an explicit
owner retry/stop decision. A cancelled or unknown attempt can still cost money.

Synthetic protocol tests and `task-31-deployed.spec.ts` do not prove live model
accuracy. `bun run test:live` uses a synthetic source only, writes a report and
requires **both** a configured API key and `LIVE_SMOKE_CONSENT=yes` before any
paid call. Without them its result is BLOCKED, exit 2, `callCount: 0`, not PASS.
Task31's last saved live report is BLOCKED for lack of credentials. Do not run
this optional command just to make the documentation checks green. The remaining
Anthropic synthetic smoke is not OpenRouter or Codex live proof; its `f4` result
always remains BLOCKED. New-provider live checks use the ordinary owner studio.

## Official Codex connection

Install the official Codex CLI on the backend and set `STUDIO_CODEX_BINARY` if
it is not on PATH. In Setup choose Connect Codex, follow the official sign-in
link, then Refresh connection and models. Disconnect removes local access.
Credentials are stored below the private data root, separated by owner and
installation, and shared by API and worker. Never copy an existing personal
Codex home into the studio. Neither credentials nor book text appear in connection JSON.
An unavailable/rejected official route disables Send and blocks F4.

## Private F4 proof: currently BLOCKED

No permitted two-book inputs, lenses, credentials or private source checks were
supplied for this implementation. Protocol fixtures establish plumbing only.

1. Privately obtain permission for two distinct real books and their interview
   lenses, including the approved Deep Work audiobook EPUB case. Do not commit them.
2. In both local and hosted studio, sign in as the owner, connect official Codex,
   select an offered model, review studio caps and source scope, then approve Send.
3. Complete both studies through the normal workflow. Privately compare quotations,
   claims, qualifications, translation and teaching outputs to each source using
   the existing F4 rubric. A completed job alone does not establish source agreement.
4. Keep books, lenses, rubric, screenshots and provider receipts private. Share only
   F4 PASS/FAIL/BLOCKED. Record PASS only after both genuine studies agree with their
   sources; missing access, unavailable route or incomplete review stays BLOCKED.
