# Consent, provider access and cost

Only the explicitly chosen source scope and reviewed data categories may leave this
installation for a provider. The owner selects a book edition, a scope and a
provider/model in study setup, reviews the transmission, then chooses **Send**.
Draft, revise or cancel does not transmit source text. New setup revisions and
changed provider/scope need a new grant; a restored grant is history only. Keep
user-provided private source and personal context out of shared fixtures and logs.

| Provider | Model in current catalog | Credential |
| --- | --- | --- |
| OpenAI | `gpt-4.1-mini` | server-side `OPENAI_API_KEY` |
| Anthropic | `claude-sonnet-4-6` | server-side `ANTHROPIC_API_KEY` |

ChatGPT or Claude chat subscriptions do not include API access or credit. Obtain
your own provider API access and check its billing and data terms. The owner
chooses from the catalog, not an arbitrary model. The configuration fixes
temperature 0, top-p 1, no seed, default reasoning and at most 6000 output
tokens. The runner uses recorded per-job call/token budgets and usage receipts,
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
429/5xx stops with an error, and an unknown outcome pauses for an explicit
owner retry/stop decision. A cancelled or unknown attempt can still cost money.

Synthetic protocol tests and `task-31-deployed.spec.ts` do not prove live model
accuracy. `bun run test:live` uses a synthetic source only, writes a report and
requires **both** a configured API key and `LIVE_SMOKE_CONSENT=yes` before any
paid call. Without them its result is BLOCKED, exit 2, `callCount: 0`, not PASS.
Task31's last saved live report is BLOCKED for lack of credentials. Do not run
this optional command just to make the documentation checks green.
