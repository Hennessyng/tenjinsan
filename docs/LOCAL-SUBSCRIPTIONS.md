# Local tool-managed subscriptions

## Current execution contract

The user approved tool-managed execution for local ChatGPT and Grok. This supersedes
the earlier allowance-only and every-internal-request accounting requirements.
The ordinary Setup flow can now sign in, discover models, review selected source,
save destination-bound consent and Send through the official local tool.
Production continues to use explicitly configured OpenRouter. Existing explicitly
selected API and legacy Codex routes are preserved; none is an automatic fallback.

**Tenjinsan's call budget counts its issued generation attempts, including its own
schema repairs and approved retries. It does not count every request, retry or
continuation inside an official tool.** Provider-managed account settings can consume
existing credits or automatic reload. Tenjinsan does not purchase credits. Counters
are not hard provider-side spending or generation caps. Unknown usage remains unknown;
the output-token check is applied after receipt only when usage is reported.

These limitations appear in Setup Review before Send and in the job-result UI, not
only in this guide. Only selected, reviewed content is supplied as request input.
Local stopping or disconnection cannot undo provider work already sent.

After Send, the receipt reports persisted analysis scheduling for that setup and
grant and links to progress scoped to that approved setup. This link does not require
a saved global study selection and does not change it. Approval alone is not a completion claim. Queued/running,
already available, attention-needed and not-scheduled results are distinct. Inspect
existing progress before considering another attempt; do not click Send again just
to discover whether a previous request was queued.

## Official routes and supported restrictions

- **ChatGPT:** managed Codex App Server sign-in and refresh. Each generation uses a
  fresh ephemeral thread, an empty environment selection, no dynamic tools or selected
  capability roots, no approval escalation, and a read-only sandbox. Supported shell,
  code-mode, multi-agent, web, memory, hook, plugin and app features are disabled.
  Project-document loading is disabled. Configured MCP servers, unexpected loaded
  instruction sources or a changed reported model/provider cause refusal before input
  is sent. Text alone is not completion: the matching terminal turn must complete.
  Required-field response shapes use native JSON schema mode. Schemas containing
  optional object properties use explicit JSON guidance instead, because the native
  strict subset requires all properties to be required. The original application
  schema, lineage and citation checks are unchanged. The receipt records the output
  format; this is not a provider/model/account fallback or an automatic replay.
- **Grok:** official ACP sign-in and cached OAuth refresh. The process receives an
  explicit empty tool allowlist, no memory/subagents/web/plan features and a one-tool-turn
  limit. Storage mode is explicitly local rather than remote history writeback.
  Each generation creates a new session with no supplied MCP servers, selects
  the requested model explicitly and uses only text input. The final prompt response
  must report normal terminal completion; streamed text alone cannot complete a job.
- **Both:** fresh local workspaces, narrowly constructed environment, tool-owned
  authentication state, no client filesystem/terminal capability and rejection of
  reverse capability requests. Tenjinsan does not grant arbitrary shell access or
  read/copy native authentication files. There is no API-key or silent model fallback.

This is **not full operating-system isolation**. Official tool internals, sampling,
provider routing behind model labels, local history and internal requests remain
tool-managed. Settings require compatible official tool versions. Native schema or
protocol incompatibility pauses/fails the request rather than selecting another route.
The installed binaries and live accounts have not been exercised by the fixtures.

Dedicated profiles with unexpected custom or system routing configuration are refused
before Send. The guard checks file presence/metadata only, never reads configuration
contents or native authentication files, and checks that the generated Grok policy
was not replaced during the operation. This deliberately excludes externally managed
or custom profiles whose per-model settings could select another billing route.
Tenjinsan maintains only its own generated policy file inside the dedicated profile;
it does not remove detected custom files or rewrite system policy to bypass the refusal.

Source references for the selected controls:

- [Codex thread-start parameters](https://github.com/openai/codex/blob/eb354a928b347856055b29fb55ecd740addf8f77/codex-rs/app-server-protocol/src/protocol/v2/thread.rs):
  an empty environment list disables environment access; ephemeral threads and explicit
  instructions/model selection are supported, and the response reports instruction sources.
- [Grok CLI agent overrides](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/agent/config.rs):
  explicit main-agent tool flags replace the agent definition's tool selection.
- [Grok agent mode](https://docs.x.ai/build/cli/headless-scripting): ACP session and
  prompt lifecycle. An agent-turn limit is not advertised here as a provider-call ceiling.
- [OpenAI strict structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs):
  all object properties must be required. Tenjinsan does not change optional domain
  fields to null or weaken its validator to fit that transport subset.
- [Grok storage mode resolution](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/config/mod.rs):
  an explicit local mode overrides environment and remote defaults for session writeback.

## Identity, consent and lifecycle

Consent binds the installation, provider, selected model, source scope, local connection
generation, connection revision, provider-managed billing route, execution-policy version
and observed account/workspace details. The generation is an opaque local identity;
Tenjinsan does not claim it is an immutable provider identifier. Missing native identity
fields are kept unknown. Reconnection or a change in observed account, workspace or
plan requires a new review. These fields participate in cache identity.

API controls require a loopback listener, loopback trusted origins and no trusted proxy.
Forwarded requests cannot use new subscription controls or Send. The production worker
also requires an explicit loopback `SERVER_HOST` for these routes. The library has no
application authentication: anyone who can reach the installation can access its controls.

Official-tool refresh runs before production stage resolution and again inside a locked
session before dispatch. Source consent is rechecked immediately before the input RPC
and after terminal completion. Disconnect/revocation cancels local work and prevents stale
completion from being accepted. There is no automatic retry of an unknown outcome.

For managed ChatGPT login, Tenjinsan retains the official ten-minute pending window
from the returned login response, rather than terminating it after five minutes.
Read-only polling and a rejected duplicate Connect do not replace the current link.
After expiry, interruption or an abandoned browser attempt, begin a fresh attempt
from Tenjinsan rather than reopening a saved provider page. A pending-window regression
does not prove that a provider-side account-selection error is resolved; that requires
the user's live browser verification. The official deadline is defined in the
[account processor](https://github.com/openai/codex/blob/687a119f0fcaace47e1f1abcc77cec6c813fd6da/codex-rs/app-server/src/request_processors/account_processor.rs).

Lifecycle and process locks serialize credential-writing tools across instances. A
supervisor owns the process lock until the child is reaped, including after API-parent
death. A process that ignores stdin closure is covered by a parent-crash regression.
This is POSIX-only; force-killing the supervisor itself is not a verified recovery case.

Backups exclude connection state and tool homes. Observed identity is removed from
historical setup/analysis records while distinct destination cache identities remain
distinct through private per-capture aliases. Restored grants remain non-authorizing.

## Verification status

Network-fenced executable fixtures exercise the production protocols, Setup/Send APIs,
worker adapters, terminal/schema validation, persisted successful analysis, malformed and
incomplete responses, revocation before/in flight, model refusal and restore redaction.
The browser journey reaches completed analysis for both providers at three viewport sizes.
This is protocol and persistence proof, not live provider eligibility, semantic quality,
cost, every-internal-request accounting or a full teaching/publication study proof.

The user must perform real sign-in separately. Authorized live studies, Claude eligibility
and original all-three TEN-21 completion remain outstanding. TEN-1 F4 is unchanged.

The historical questions receipt from the first live synthetic attempt retained only
an unavailable classification, not the native reason. It cannot prove a provider
outage or a schema rejection. A later source-based regression found the optional
citation field incompatible with native strict mode and now persists valid cited
questions through application-validated JSON. New terminal receipts retain only
allowlisted error categories, never native error messages or response details. The
old live receipt is not rewritten and requires a parent/user-owned retry decision.
