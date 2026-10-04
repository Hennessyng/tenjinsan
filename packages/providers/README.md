# Controlled providers

Node-only package exports; never import this package from the browser. API keys are
read only on the server (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`). Chat subscriptions
do not provide API access. The explicit capability catalog currently permits
`gpt-4.1-mini` and `claude-sonnet-4-6`; arbitrary models, seeds, reasoning settings
or sampling overrides fail before reservation. SDK and request retries are both zero.

`WorkerRuntime` accepts a `structured` stage with a `ProviderRunner` and a Zod
output schema. The runner uses Task 4's SQLite claims, reservations, dispatch
markers, private response receipts, budgets and cancellation. Supply the current
installation and authenticated owner, plus the configured provider adapters.

Every dispatch reloads the exact setup, grant and source scope. Only selected,
persisted book blocks are sent. Downstream approved reader context and derived
study material require separate Send grant categories; the worker rechecks
the current setup, grant, versions and scope. The browser never owns provider
keys or stage instructions. The Vercel AI SDK measures the final JSON body:
32,000 UTF-8 bytes is the limit before reservation and at dispatch. All stages
and sections of one setup share at most 64 provider attempts.

Malformed output gets at most the persisted schema-repair allowance, with each
repair taking a new reservation. A 429/5xx receipt fails with a sanitized error;
only an explicit `retryProviderJob(jobId)` decision can queue another bounded
attempt. Unknown transport outcomes pause immediately, or on lease recovery
after a process crash. `resolveUnknownAttempt` records the owner's retry/stop
decision. Cancellation never turns an accepted unknown attempt into zero usage.
Receipts preserve per-attempt usage; job usage aggregates known receipts and
remains unknown if any dispatched attempt has unknown usage.

Source preview links to the React setup flow through authenticated Hono JSON APIs.
Drafts precede grants. Send binds the provider/model, revision, scope and book-text
category and approved downstream categories; Revise/Cancel invalidate that draft. New drafts supersede old setups.
Missing API credentials disable Send and are also checked server-side. Later
normal worker stages run analysis, questions, outline and lesson sections. Fixture
adapters remain available for tests; standard Compose forwards provider keys to
the API and worker but omits the synthetic flag. See
`docs/CONSENT-PROVIDERS.md` for owner-facing limits.

Verification:

- `bun run test:integration -- providers`: loopback protocol fixtures, real SDKs,
  real SQLite attempts, worker claims, authorization and setup routes.
- `bun run test:e2e -- study-setup`: real browser choices, approval, revision,
  cancellation and narrow-screen checks.
- `bun run test:live`: separate credential- and consent-gated synthetic-source
  smoke through the same persisted runner. Missing prerequisites report `BLOCKED` and exit 2,
  never pass. It does not read or send the protected book.
