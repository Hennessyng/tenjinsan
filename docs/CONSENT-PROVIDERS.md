# Consent, provider access and cost

Only the reviewed source text and data categories may leave this installation for a
provider. The owner selects a book edition and a provider/model in study setup; every
new setup covers the whole extracted document (there is no scope, main-chapter or
chapter choice). The owner reviews the transmission, then chooses **Send**.
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
serialized request ceiling before dispatch and a 6,000 output-token check when usage is reported.
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

## TEN-21 local tool-managed subscriptions

Local ChatGPT and Grok Send now use official tools under the user-approved
tool-managed execution contract. The current behavior, residual risks, observed
identity binding and verification limits are in [Local subscriptions](LOCAL-SUBSCRIPTIONS.md).
Budgets count Tenjinsan-issued generation attempts, not all internal provider/tool
requests; they are not hard cost or generation caps. Review and job-result screens
disclose this before and after Send. Claude and live-study verification remain incomplete.

<details>
<summary>Historical investigation under the superseded strict contract</summary>

The notes below record earlier investigation, not current enablement requirements.
The user subsequently accepted tool-managed execution. The current contract is the
linked local-subscription guide above.

Local Setup supports managed ChatGPT sign-in through the official `codex app-server`
stdio protocol. The user follows the official URL; only a matching successful
`account/login/completed` event permits account/model discovery. Codex owns the tokens
inside a fresh installation-local home; Tenjinsan never reads or copies its token file.
The connection persists across API restarts. Refresh account and models asks Codex to
refresh its session and returns the tool's offered catalog, not a hard-coded list.
`STUDIO_SUBSCRIPTION_CODEX_BINARY` may select an official executable outside PATH.
Protocol references: [Codex App Server](https://developers.openai.com/codex/app-server),
[managed authentication](https://developers.openai.com/codex/auth), and
[account response types](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/account.rs).
Workspace routing is an experimental response capability: absent workspace identity
is shown as unknown and must not authorize a guessed destination. The installed
official binary and a live account have not been exercised by these fixture tests.
Grok sign-in now uses official ACP `authenticate` with `grok.com`, the official
`_x.ai/auth/get_url` extension, and a correlated JSON-RPC completion. Refresh uses
only `cached_token`; non-secret account metadata comes from `_x.ai/auth/info` and
the reported model catalog from `_x.ai/models/list`. No token-export method is called.
The isolated tool home pins `preferred_method="oidc"` and disables API-key auth.
An API-key or external-auth-provider method in the handshake is rejected.
`STUDIO_SUBSCRIPTION_GROK_BINARY` selects an official Grok executable outside PATH.
Claude remains unverified.
**New-route inference is not enabled in this slice.** Missing live-study evidence is
a completion gap, not a prerequisite for sign-in. Failed discovery remains unknown,
not a successfully empty model catalog.

Controls require an explicitly loopback-bound API, loopback-only trusted origins
and no trusted proxy; forwarded requests are refused. Hosted deployments show a
local-only explanation and should use explicitly configured OpenRouter. Existing
explicit OpenRouter, Anthropic API and Codex behavior is preserved, not silently
selected as fallback. Tenjinsan has no application authentication: connections are
installation-wide, and anyone reaching the server can access the library.

Local disconnect increments a SQLite revocation fence shared by API/worker instances.
Each login uses a new generation directory, separated by installation and provider.
An exclusive SQLite lifecycle lock serializes API instances; a separate supervisor
owns a second lock until its tool process is reaped. API IPC disconnect or stdin EOF
terminates the tool's process group. A recovery instance must acquire both locks.
An executable fixture that ignores stdin survives the old parent-only design but is
reaped after a parent SIGKILL by the supervisor regression. This verifies parent
crash cleanup on POSIX; forcibly killing the supervisor itself is not covered.
Late completion and
refresh updates use the durable revision fence; disconnect wins. Interrupted pending
login is expired after the process lock is released rather than promoted from a token
file. Local cleanup waits for an active tool to stop; provider-wide revocation is not
claimed. A refresh that reports a changed account/workspace advances the consent fence.
The worker refreshes an existing signed-in session before resolving a production
stage or reserving a request. A changed principal/workspace/revision/model pauses
the job. Absent exact principal identity is unknown, never replaced with an email.

The new consent identity records provider, account, optional workspace, installation,
connection revision and billing route beside the immutable setup/model
and source scope. Destination changes cannot reuse that consent or its analysis cache.
An identity record is not eligibility proof: the worker independently blocks all three
new routes before reservation, measurement or dispatch, including injected adapters.
No environment variable or caller-supplied eligibility assertion enables them.

For local ChatGPT/Grok, the user chose **provider-managed account billing**, superseding
the original strict allowance-only condition: existing credits or automatic reload may
be consumed according to provider settings. Tenjinsan does not purchase credits or
fall back to API keys. New consent uses `subscription-provider-managed`; historical
`subscription-allowance` grants remain distinct and cannot authorize the changed route.
Tool/history isolation, exact account binding for dispatch where the tool omits it, Claude
eligibility and three authorized live completed synthetic studies remain outstanding.
Provider usage meters and post-receipt output checks are not spending or generation caps. The existing
32,000-byte/6,000-output-token handling, durable 64-attempt setup cap and separately
budgeted repairs remain unchanged. TEN-21 is incomplete; TEN-1 F4 remains blocked.

### Effective dispatch controls: explicitly unresolved

The lifecycle fixture does not prove that the installed tool enforces a no-tools
ceiling, never loads unrelated policy/history, or performs exactly one billable
request per reserved attempt. Therefore neither new subscription dispatch is enabled.
These are specific remaining control gaps, not a commercial-partner or live-proof gate:

- **Codex:** the inspected [ToolPolicy](https://github.com/openai/codex/blob/eb354a928b347856055b29fb55ecd740addf8f77/codex-rs/ext/extension-api/src/tool_policy.rs)
  permits an empty all-tools allowlist, but only via `ExtensionDataInit` before a
  thread. The inspected standard App Server interface does not expose that ceiling.
  Shell/web-search flags and denying reverse RPCs do not prove all internal file/tool
  paths are disabled. `account/read` exposes email and optional workspace routing;
  Tenjinsan does not claim that is an immutable user principal or read token claims.
- **Grok:** [enterprise policy](https://docs.x.ai/build/enterprise) gives system
  requirements higher priority than the isolated user's requirements; remote policy
  and per-model settings also exist. An isolated HOME and empty ACP client filesystem
  capabilities do not verify the effective built-in-tool/hooks/history policy.
  The [auth info handler](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/extensions/auth.rs)
  exposes principal/team metadata: a `user` principal can be bound exactly, but a
  missing/team principal is not substituted for an individual user. The
  [model handler](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/agent/handlers/models.rs)
  reports resolved tool model state; it is not an inference entitlement probe.
- **Both:** no verified hook reserves each internal inference/compaction/retry
  before it occurs. Counting `turn/start` or `session/prompt` alone would weaken the
  durable call budget. No study prompt is sent to investigate this.

Next enablement work needs provider-supported effective-policy/request controls, or
an explicitly designed and verified process/network isolation boundary that preserves
the official login and accounts for every internal request. Do not enable sending on
the strength of synthetic GREEN or a successful login alone.

### Bounded follow-up: what the available switches do and do not prove

This is not a claim that either official tool can never support the workflow. The
current adapter has not established the full contract, and the following narrower
source findings replace any inference that there are no useful controls:

- Codex accepts zero `request_max_retries` and `stream_max_retries` in
  `codex-rs/model-provider-info/src/lib.rs`. Its pre/post model-request hook events
  are real, but [their implementation](https://github.com/openai/codex/blob/eb354a928b347856055b29fb55ecd740addf8f77/codex-rs/hooks/src/events/model_request.rs)
  explicitly treats output as diagnostic and returns no control decision. A durable
  budget checker placed there cannot veto the request, even if it fails. The
  [pre-tool hook implementation](https://github.com/openai/codex/blob/eb354a928b347856055b29fb55ecd740addf8f77/codex-rs/hooks/src/events/pre_tool_use.rs)
  can deny a tool on an explicit response, but initializes blocking to false and
  records command-runner errors without changing that decision. A command hook
  alone is therefore not a fail-closed all-tools boundary.
- Grok exposes `models.max_retries`, the `features.turn_transient_retry` switch,
  and an explicit length-continuation off-switch. Their existence must not be
  confused with a single transport-attempt ceiling. The pinned
  [turn-loop regression](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/session/acp_session_tests/turn/transient_retry_loop_tests.rs)
  sets sampler retries to zero yet exercises repeated turn-loop submissions. The
  [retry resolver](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/util/config/resolve/features.rs)
  resolves that separate switch through merged policy. The
  [turn implementation](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/session/acp_session_impl/turn.rs)
  also has structured-output resubmission before its tool-turn limit check. The
  [length-salvage implementation](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/session/acp_session_impl/length_salvage.rs)
  is another independently controlled continuation path. Each path needs effective
  enforcement or a reservation hook; one CLI flag is insufficient proof.
- Identity remains a separate issue. The pinned Codex request registry in
  `codex-rs/app-server-protocol/src/protocol/common.rs` exposes account read but
  does not register the session-list types as a callable public method. A generated
  data type is not evidence that the adapter can call a method. The current
  conservative principal check must not be presented as proof that all other
  provider-defined identity representations are impossible; a supported identity
  representation must be explicitly modeled and compared rather than guessed.

Smallest actionable subscription alternative: obtain an official **single-inference,
no-tools mode** whose effective-policy response confirms no filesystem/tool/history
augmentation and a hard ceiling covering transport retries, compaction, continuations
and structured-output resubmission. Alternatively, expose a **fail-closed pre-request
veto** before every actual inference attempt so Tenjinsan can reserve its durable
budget first. Codex would additionally need the startup tool-policy ceiling exposed
through the standard local interface; both tools must expose the required selected
principal/workspace information without exporting authentication material. These are
specific interface contracts for the provider/tool maintainer, not authorization to
modify a provider client identity or intercept its encrypted authentication traffic.

The existing explicitly selected API route is the immediate working alternative for
Send; Tenjinsan must not select it automatically. Until a supported subscription mode
satisfies the contracts above, the implemented local sign-in/refresh lifecycle is
reviewable but the requested subscription Send outcome is still incomplete. No live
study was used to infer these guarantees, and no test failure was hidden by this gate.

</details>

## Existing official Codex route

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
   select an offered model, review studio caps and the whole-document coverage, then approve Send.
3. Complete both studies through the normal workflow. Privately compare quotations,
   claims, qualifications, translation and teaching outputs to each source using
   the existing F4 rubric. A completed job alone does not establish source agreement.
4. Keep books, lenses, rubric, screenshots and provider receipts private. Share only
   F4 PASS/FAIL/BLOCKED. Record PASS only after both genuine studies agree with their
   sources; missing access, unavailable route or incomplete review stays BLOCKED.
# Multi-format source coverage (TEN-18)

See [document import and coverage](MULTIFORMAT-IMPORT.md) for whole-document scope,
exact range receipts, source-window gaps, and separate extraction/transmission/
processing status. Original EPUB/DOCX attachments are unavailable: exact provider /
model support is unverified. Text-only grants authorize no original. Explicit
original requests reject without a grant; importing alone sends nothing.
