# Owner login diagnostics — bounded evidence and scope handoff

**Latest status:** independent review of the repaired diagnostics is **PASS**. Earlier pending/FAIL
statements below record the state when those receipts were written; the final review receipt at the
end supersedes them. Live login root cause remains **UNPROVEN**.

## Status and operating limits

Diagnostics are implemented for POST `/login`, GET/POST `/api/auth/sign-in/email`, and existing
security-boundary rejections. This is not a login-cause fix or whole-system tracing rollout.
Live root cause remains **UNPROVEN**. Running API, worker, and studio were not restarted, killed,
reconfigured, or submitted credentials. No real credential/cookie/body values were inspected.
No owner provisioning/reset, commits, pushes, ticket posting, or baseline migrations occurred.

The running processes do not provide proof of these edited sources until an explicitly approved
reload/restart and a separately authorized reproduction. Do not collect raw bodies, cookies, auth
headers, credential values, complete environment files, or unrestricted logs to diagnose the cause.

## Trace contract

`trace_id` is the server-generated UUID already stored as `requestId`; when a response is produced,
both event fields match its `X-Request-ID`. Client-supplied request IDs are not trusted. Early 403/421/413/429 responses
retain correlation. Existing security events and logger configuration are reused, not replaced by a
third-party logging system. Better-auth's unrestricted logger remains disabled.

Allowlisted event fields:
- `event`: existing `access.*` decisions or `auth.login.validation`, `.rejected`, `.exception`, `.success`.
- `category`: validation, invalid-credentials, origin, cross-site, session, rate-limit, internal,
  unknown, success; existing access decisions additionally use host, body-limit, content-type, resource.
- `level`: info for success, warn for handled client rejection, error for server failure.
- `status`: public response status, or `null` when a non-Error throw propagates without a response
  at this boundary; `upstream_status`: auth handler response status when one exists. A downstream
  adapter may choose its own error response; diagnostics do not invent or predict that status.
- `requestId`, `trace_id`, allowlisted method, static route family (never resource IDs or query data).

No raw auth code, message, stack, response/request body, email, password, owner/session/resource ID,
IP, user agent, cookie, token, header value, or URL/query string is written to diagnostic events.
Generated correlation UUIDs are the intentional exception to the ban on existing/private IDs.

Rejection classification has a 4096-byte **inspection/decoding budget**, not an upstream allocation
or read-chunk cap, and a 100 ms deadline. A stream read can receive an entire larger chunk; the
classifier rejects it before decoding/copying it into retained text. It feeds at most 4096 bytes to
the decoder and does not create copies of oversized chunks. Source allocation, SDK tee copying,
prefetch buffers, and total process memory are outside that guarantee. Even a 1 MiB synthetic chunk
is not decoded. Only a parsed, bounded machine code is mapped to a constant category.

Malformed/unknown/oversized/stalled bodies fall back to `unknown`; 429 and 5xx are classified from
status. `EMAIL_NOT_VERIFIED`, `PASSWORD_TOO_LONG`, and `VALIDATION_ERROR` intentionally remain
`unknown`: no guessing from raw code/message or additional public error detail is introduced.
The direct response body is never consumed or cancelled by diagnostics. On the form-mapped error
path only, the discarded original body is also cancelled (without awaiting source acknowledgement),
so both tee branches relinquish ownership. An upstream source that ignores cancellation cannot be
forced to close by this hook. Form rejections remain generic 401; direct auth responses retain their
status/body, including after timeout; successes still redirect 303. HTTPException responses and
non-Error propagation are preserved.

The built-in diagnostic sink owns a separate writer on the existing stdout descriptor (no new file,
no global stdout error handlers, and no ownership/closure of that descriptor). It handles its own
async errors, stops writing after failure, and drops new events while backpressured until `drain`.
There is no secondary queue; the writer uses a 1024-byte high-water mark plus at most one bounded
event line. This is best-effort logging, not a delivery guarantee. Synchronous injected logger throws
are caught; custom asynchronous transports must own their error handling. Unrelated CLI/startup
stdout/stderr writes remain outside this slice. Dropped-event counts/delivery telemetry are unknown.

Implementation references:
- `apps/server/src/middleware/access.ts:128-170`: recorder integration and early response correlation.
- `apps/server/src/middleware/security-events.ts:4-92`: schema, allowlists, sink isolation.
- `apps/server/src/middleware/security-sink.ts:5-28`: owned async output, backpressure/drop policy.
- `apps/server/src/auth/login-classification.ts:5-60`: bounded machine-code classification.
- `apps/server/src/auth/login-route.ts:17-117`: scoped exception/outcome hooks and form-only cleanup.

## Proof receipt

Baseline HEAD: `33fd965046a39de7850e512879349d7301b26a6b` (unchanged).
Initial status/diff were captured before edits. Preexisting user changes were left untouched:

| Path | Final git hash-object (matches earlier guard) |
| --- | --- |
| apps/studio/vite.config.ts | eaef5290c0afa2a1c3c7b732b7408e81e7900515 |
| package.json | efe86708d7af200d813d4b3fe4e753a21d8aaa3e |
| tests/deployment/owner-login-proxy.test.ts | dbf4b0b8abafe282875038e359444a1ecb0da894 |

All scenario execution was in-memory through Hono `app.request` with synthetic mock handlers.
No test socket, real AuthStorage, real credential submission, or paid provider was used. Manual
surface testing is limited to those in-memory scenarios; no browser/live authentication QA is claimed.
A separate Node inline in-memory QA command also passed six cases (validation 401, upstream-origin
rejection mapped to 401, success 303, exception 500, boundary Origin 403, boundary Host 421). Every
case reported matching response/event correlation and the expected safe category; exit status was 0.

Commands run from the repository root:

```sh
# Before production edits: 21 failed, 2 passed (23); missing events/early headers reproduced.
bunx vitest run apps/server/src/auth/login-diagnostics.test.ts

# Recorder delivery temporarily disabled: 28 failed, 5 passed (33).
# Sink restored using apply_patch immediately afterward; no mutation remains.
bunx vitest run apps/server/src/auth/login-diagnostics.test.ts apps/server/src/auth/login-response-diagnostics.test.ts apps/server/src/auth/boundary-trace.test.ts apps/server/src/auth/login-classification.test.ts

# Additional scope regression: 1 failed, 5 skipped; a wildcard hook mislabeled an unrelated auth throw.
# Repaired by registering the hook only on the two login paths.
bunx vitest run apps/server/src/auth/boundary-trace.test.ts -t "does not label unrelated auth throws"

# Fresh after repairs: exit 0; 40 tests passed in 5 files.
bunx vitest run apps/server/src/auth/login-diagnostics.test.ts apps/server/src/auth/login-response-diagnostics.test.ts apps/server/src/auth/boundary-trace.test.ts apps/server/src/auth/login-classification.test.ts apps/server/src/app.test.ts

# Fresh scoped server typecheck: exit 0. Earlier timer-overload failure was repaired, not waived.
bunx tsc --noEmit --incremental false --composite false -p apps/server/tsconfig.json

# Fresh formatting/lint: exit 0; 10 files checked, no fixes applied.
bunx biome check apps/server/src/app.ts apps/server/src/middleware/access.ts apps/server/src/middleware/security-events.ts apps/server/src/auth/login-classification.ts apps/server/src/auth/login-route.ts apps/server/src/auth/login-diagnostics.test.ts apps/server/src/auth/login-response-diagnostics.test.ts apps/server/src/auth/boundary-trace.test.ts apps/server/src/auth/login-classification.test.ts apps/server/src/auth/testing/login-diagnostic-fixture.ts

# TypeScript no-excuse audit: exit 0.
bun run /Users/hennessy/.config/opencode/skills/programming/scripts/typescript/check-no-excuse-rules.ts apps/server/src/app.ts apps/server/src/middleware/access.ts apps/server/src/middleware/security-events.ts apps/server/src/auth/login-classification.ts apps/server/src/auth/login-route.ts apps/server/src/auth/login-diagnostics.test.ts apps/server/src/auth/login-response-diagnostics.test.ts apps/server/src/auth/boundary-trace.test.ts apps/server/src/auth/login-classification.test.ts apps/server/src/auth/testing/login-diagnostic-fixture.ts
```

Sanitized command-output files are under
`/var/folders/64/nwznnb8j1sv1wy_clc0300cm0000gn/T/opencode/`, with prefix
`tenjinsan-login-diagnostics-20261008-` and suffixes:
`red.txt`, `differential-red.txt`, `scope-red.txt`, `final-green.txt`, `final-typecheck.txt`,
`final-biome.txt`, `no-excuse.txt`, `manual-qa.txt`. These contain synthetic test data only. No raw live log was read.
An attempted external Markdown receipt write was blocked by the patch tool; it was not retried.

No full integration/E2E/browser/deployment proof is claimed: those would exceed this in-memory slice.
Automated Jev review escalated (safe_to_apply 0.16, composite 0.567, confidence/test-gap limits) without
providing concrete findings. It is not independent native reviewer approval.
An independent Grok reviewer subsequently returned FAIL; its complete receipt is now available,
read, and SHA-256 verified (see revision R1 below). Native confirmation supplied by the coordinator
establishes Grok reviewer / GPT author-family independence. The reviewer had not seen that metadata
or the proof artifacts when writing its original report. Fresh reviewer verification is pending;
do not label the whole work GREEN. Provider effort and effective permission-scope telemetry remain unknown.

Final architectural check: source/test files range from 26 to 214 nonblank/noncomment lines;
`app.ts` (214) and the standalone QA driver (206) are in the 200-250 warning band; split QA scenarios
by concern before materially extending that driver, and do not grow app composition another responsibility.
The touched modules own app composition, access enforcement, safe event recording, login routing,
or bounded classification separately. Untrusted classification JSON is parsed at its boundary.
No new any/assertion/non-null escapes, new tagged-variant branches, parameter bloat, speculative
defensive layers, dependencies, or redundant destructive verification were introduced. The shared
recorder/classifier/test fixtures have multiple callers. Intentional catches are limited to safe
diagnostic fallbacks/sink isolation; handler throw behavior is explicitly tested. Existing logging
practice is retained. Behavioral RED and fresh GREEN prove diagnostic delivery, not the live login cause.

## Wider logging inventory — follow-up only

These are source-observed gaps, not verified live failures or approved instrumentation scope.
Keep routine validation feedback distinct from security events and operational failures.

| Surface | Observed gap | Source reference |
| --- | --- | --- |
| Generic auth/logout/session lookup | Outside the two login paths, auth calls lack safe outcome/exception hooks; global Hono fallback may print raw exceptions | apps/server/src/app.ts:128-133,144-166; node_modules/hono/dist/hono-base.js:10-16 |
| API maintenance admission | 503/Retry-After has no operational decision event | apps/server/src/app.ts:111-112 |
| Upload/intake | Archive errors become 413/422 without a correlated outcome; async intake does not receive request correlation | apps/server/src/upload.ts:22-30; apps/server/src/intake.ts:11-37 |
| Provider discovery/connect | Empty-model fallbacks and connect 503 hide the operational cause without safe events | apps/server/src/provider-connections.ts:16-30,43-47 |
| Setup/consent/generation queue | Unavailable provider 503 and transmission decisions lack an operational trace carried into queued work | apps/server/src/study-setup.ts:183-200,225-243 |
| Jobs/retries | Invalid/stale decision responses have no decision event; determine which transitions merit operational logs rather than routine validation noise | apps/server/src/jobs.ts:17-22,65-100 |
| Brief/outline/revision/evidence review | Local stale/invalid decision conversions lack per-operation events; scope should distinguish normal conflicts from operational failures | apps/server/src/brief.ts:142-147; apps/server/src/outline.ts:224-228; apps/server/src/revision-page.ts:154-158 |
| Publication/download | Integrity failure becomes 409 without a correlated safe failure event | apps/server/src/publication.ts:150-168 |
| Owner CLI | Human-readable success/failure, no invocation trace; generic unexpected failure hides safe classification | apps/server/src/owner-cli.ts:126-130,140-157 |
| Library maintenance/backup/delete | Human-readable or JSON result output lacks a unified invocation/correlation contract | scripts/library.ts:48-94 |
| Local launcher | Structured lifecycle events have no trace; unexpected error messages are emitted directly | scripts/start-local.ts:71-112,129-142 |
| Worker lifecycle/execution | Startup/shutdown text lacks trace; claim, heartbeat, stage completion, maintenance release have no correlated event sink | apps/worker/src/index.ts:10-37; apps/worker/src/runtime.ts:79-139,143-158 |
| Worker/provider/output stages | Worker loops and post-job rendering do not carry the initiating HTTP trace; persisted job state is not a diagnostic event stream | apps/worker/src/production-runtime.ts:165-184 |

## Requirements / draft-ticket handoff

The draft-ticket skill was loaded. A worker must not replace the parent's continuing requirements
analyst or invent its session/approval. No ticket draft was posted or claimed approved.

Unresolved product/safety choices for that analyst:
1. Login-only diagnostic ticket versus a separately scoped whole-system tracing umbrella.
2. Which operational outcomes require events, retention/access policy, and acceptable log volume.
3. Whether background jobs/CLI need trace propagation, with no existing/private identifiers exposed.
4. Approved reload and operator-controlled reproduction boundary for proving the actual login cause.
5. Bug-fix contract only after a fresh discriminating failure category and reproduction establish cause.

Known hypotheses remain: reset targeted another relative database; email/password mismatch; stale or
noncanonical browser/proxy origin; temporary rate-limit; malformed hash or auth session failure.
Prior read-only account aggregates rule out a missing/NULL credential in the checked database at that
time. GET availability on API/studio does not prove POST success. No hypothesis is promoted to root cause.

## Revision R1 — independent review findings and repair evidence

Review job: `owner-login-diagnostics-independent-review`.
Reviewer session: `ses_ee384dbdaffekyy71dABt5qUHf` (Grok, read-only, completed FAIL).
Full original reply was read, not truncated or reconstructed:
`/Users/hennessy/.local/state/opencode/native-workflow/replies/ce57925cc4724c315e1a31385b26ed50ad339c03cf6735b8a4f350d26d28c631.txt`.
Verified SHA-256: `d39ba75efdef870a7c570f3a8206833e114992d50e7fdeee26bf93f93cb41a02`.
Coordinator-supplied native metadata confirms GPT author / Grok reviewer independence. Original
reviewer observations about missing lineage/proof were limitations of that review's intake, not
evidence that no independent reviewer existed. This driver does not substitute its own proof for
the reviewer's approval: **the independent review remains FAIL pending fresh verification**.

| ID | Disposition | Evidence / bounded action |
| --- | --- | --- |
| F1 | REFUTED | `Promise.race` installs rejection reactions on all inputs and retains them after the timer wins. The synthetic reader's read remained pending until after `unknown` was returned, then rejected; a temporary `process.unhandledRejection` observer saw zero events after an event-loop turn. Observer/mocks were removed in cleanup. No speculative classifier patch. `auth/login-classification.test.ts:6-46`; classifier `login-classification.ts:52`. |
| F2 | LIMITED: inaccurate documentation CONFIRMED; existing decoding bound verified | Single 4096-byte chunk classified successfully; 4097-byte and 1 MiB chunks were not decoded. A 4090+32-byte source decoded only 4090 bytes, not the over-budget chunk. The cap is on decoded/retained inspection text, not upstream chunk allocation, SDK tee copying/prefetch, or total memory. Documentation corrected; no transport/memory guarantee invented. `auth/login-classification.test.ts:48-103`. |
| F3 | CONFIRMED, repaired | Two pre-fix tests observed zero source cancellations on mapped form errors. Form-only cleanup now cancels the original body without awaiting it. After timeout, both branches cancel and source cancellation is requested once; even a pending/rejected cancel does not delay/change generic 401. Direct responses remain readable after clone timeout and are not cancelled. `auth/login-route.ts:72-83`; `auth/login-stream-cleanup.test.ts:12-108`. |
| F4 | CONFIRMED, repaired within default diagnostic sink | The old write behavior emitted a second write while backpressured/after asynchronous failure (two RED cases). Owned writer now handles its own error/callback, disables on failure, and drops while blocked until drain; no global stdout listener is added. QA injects an async Writable error with no test observer/global handler and survives with the same 401 response. Unrelated stdout writers and log-delivery guarantees remain outside scope. `middleware/security-sink.ts:5-28`; `auth/security-sink.test.ts:8-105`; `testing/login-review-qa.ts`. |
| F5 | CONFIRMED, repaired | Pre-fix event claimed 500 for a non-Error throwable while app.request rejected. It now records `status: null`, preserves the original throw, and exposes no thrown value. No response is fabricated. `auth/boundary-trace.test.ts:40-55`; `auth/login-route.ts:30-42`; `middleware/security-events.ts:35`. |

Question dispositions:
- Non-Error throws use explicit null status (no observed response here), not an invented 500.
- `EMAIL_NOT_VERIFIED`, `PASSWORD_TOO_LONG`, and `VALIDATION_ERROR` intentionally use `unknown`;
  seven malformed/unrecognized-body cases verify fallback and unchanged original body.
- New in-memory access cases prove trace/header equality and privacy for content-type 415,
  anonymous-session 401, and unowned-resource 404: `auth/access-trace-coverage.test.ts:6-46`.

### R1 proof commands and outcomes

Run from `/Users/hennessy/dev/tenjinsan`; all data/handlers/streams are synthetic. No listening sockets,
live submissions, AuthStorage/SQLite opens, resets, provisioning, reloads, production global error handlers,
third-party dependencies, protected-test edits, commits, pushes, or ticket posting.

```sh
# Before repairs: exit 1, 3 failed / 19 passed. F1/F2 and extra access boundaries already pass;
# failures reproduce F3 source ownership (two cases) and F5 status mismatch.
bunx vitest run apps/server/src/auth/login-classification.test.ts apps/server/src/auth/login-stream-cleanup.test.ts apps/server/src/auth/boundary-trace.test.ts apps/server/src/auth/access-trace-coverage.test.ts

# F4's old default write behavior first mechanically extracted unchanged for a narrow output seam.
# Before fail-safe repair: exit 1, 2 failed / 1 passed; queue/failure handling defects reproduced.
bunx vitest run apps/server/src/auth/security-sink.test.ts

# Fresh final candidate: exit 0, 58 tests passed in 8 files.
bunx vitest run apps/server/src/auth/login-classification.test.ts apps/server/src/auth/login-stream-cleanup.test.ts apps/server/src/auth/security-sink.test.ts apps/server/src/auth/boundary-trace.test.ts apps/server/src/auth/access-trace-coverage.test.ts apps/server/src/auth/login-diagnostics.test.ts apps/server/src/auth/login-response-diagnostics.test.ts apps/server/src/app.test.ts

# Fresh scoped typecheck: exit 0. A synthetic-reader ArrayBuffer generic mismatch was repaired;
# useful task edits were retained, and no type assertions or suppressions were added.
bunx tsc --noEmit --incremental false --composite false -p apps/server/tsconfig.json

# Fresh formatting/lint: exit 0; 15 files checked, no fixes applied.
bunx biome check apps/server/src/app.ts apps/server/src/middleware/access.ts apps/server/src/middleware/security-events.ts apps/server/src/middleware/security-sink.ts apps/server/src/auth/login-classification.ts apps/server/src/auth/login-route.ts apps/server/src/auth/login-diagnostics.test.ts apps/server/src/auth/login-response-diagnostics.test.ts apps/server/src/auth/boundary-trace.test.ts apps/server/src/auth/login-classification.test.ts apps/server/src/auth/login-stream-cleanup.test.ts apps/server/src/auth/security-sink.test.ts apps/server/src/auth/access-trace-coverage.test.ts apps/server/src/auth/testing/login-diagnostic-fixture.ts apps/server/src/testing/login-review-qa.ts

# Fresh no-excuse audit: exit 0; no violations in 15 files.
bun run /Users/hennessy/.config/opencode/skills/programming/scripts/typescript/check-no-excuse-rules.ts apps/server/src/app.ts apps/server/src/middleware/access.ts apps/server/src/middleware/security-events.ts apps/server/src/middleware/security-sink.ts apps/server/src/auth/login-classification.ts apps/server/src/auth/login-route.ts apps/server/src/auth/login-diagnostics.test.ts apps/server/src/auth/login-response-diagnostics.test.ts apps/server/src/auth/boundary-trace.test.ts apps/server/src/auth/login-classification.test.ts apps/server/src/auth/login-stream-cleanup.test.ts apps/server/src/auth/security-sink.test.ts apps/server/src/auth/access-trace-coverage.test.ts apps/server/src/auth/testing/login-diagnostic-fixture.ts apps/server/src/testing/login-review-qa.ts

# Fresh separate in-memory QA: exit 0; 9 scenarios pass. No test-only error observer is used
# for the sink's asynchronous error, and no live API is called.
node --experimental-transform-types apps/server/src/testing/login-review-qa.ts
```

Evidence directory:
`/var/folders/64/nwznnb8j1sv1wy_clc0300cm0000gn/T/opencode/`.
Exact file prefix: `tenjinsan-login-review-r1-`.
- `evidence-red.txt`: pre-repair F1/F2/F3/F5/access findings run (3 failed, 19 passed).
- `sink-red.txt`: F4 reproduction (2 failed, 1 passed).
- `final-green.txt`: 58 passed; includes two actual allowlisted built-in stdout event lines.
- `final-typecheck.txt`: empty output; command exit 0 captured in driver receipt.
- `final-lint.txt`: 15 files checked successfully.
- `final-audit.txt`: no violations in 15 files.
- `final-qa.txt`: 9 passed scenario booleans; only Node experimental warnings otherwise.

Working-tree code digest (SHA-256 of ordered `git hash-object` output for the same 15 files,
in the exact Biome command order above):
`e8313fde964cfb373f7ec36bf1bbc4f369951708168eadd4dd6de0f5ad963274`.
Baseline HEAD remains `33fd965046a39de7850e512879349d7301b26a6b`; diagnostics are uncommitted working-tree
changes, not content claimed to be committed at HEAD. Preexisting Vite/package/proxy-test hashes
still match the earlier guard. `git diff --check` passed. No temporary source mutation remains.

R1 changed scope: login-route cleanup/null status, security-event sink wiring/schema, the new owned
sink, extended classification/non-Error tests, three new focused test files, the standalone in-memory
QA source, and this receipt. Production classification logic, login credential/reset semantics,
deployment/proxy settings, other feature logging, and preexisting acceptance tests were not changed.
All source/test files remain below 250 pure lines; composition (214) and QA (206) are warning-band files.

Remaining limits: upstream allocation/tee buffering cannot be capped by this inspection hook;
cancellation acknowledgement can remain pending; logs are best effort and dropped-count/delivery
telemetry is unknown; custom async transports own their own failures; unrelated stdout/error paths
remain in the wider inventory. The reviewer has not yet consumed this new evidence or approved the
repairs. Full browser/integration/deployment preflight was not authorized/run. Live login root cause
is still UNPROVEN; a future approved reload and separately authorized reproduction are required.

## Final independent review receipt

- Job/role: `owner-login-diagnostics-independent-review` / `reviewer`.
- Reviewer session: `ses_ee384dbdaffekyy71dABt5qUHf`, bound to implementation session
  `ses_ee4f5dd93ffeiRVJte1WLEY2Le`.
- Latest verdict: **PASS**, with no remaining confirmed defect. F1 was refuted; F2 is a documented
  decoding-budget limit; F3–F5 were repaired and re-verified.
- Latest reply artifact:
  `/Users/hennessy/.local/state/opencode/native-workflow/replies/ce57925cc4724c315e1a31385b26ed50ad339c03cf6735b8a4f350d26d28c631.txt`.
- Latest reply SHA-256: `7d711dea32e81ffa13f723e946a50295ac5e0e71c1607df9715a0de18c8ccfe7`.
  The native latest-reply file replaces the earlier reply; the historic FAIL hash above does not
  describe its current contents. The original reply was recovered through Headroom key `d39ba75efdef`.
- Native receipt: owned read-only review, GPT author / Grok reviewer independence verified;
  requested/observed reviewer profile `xai/grok-4.7/high`; actual effort telemetry unknown.
- Parent separately executed `node --experimental-transform-types apps/server/src/testing/login-review-qa.ts`:
  all nine in-memory scenarios passed. Parent `git diff --check` also passed.

This approval covers the diagnostics source/test slice only. It is not live-login proof, whole-feature
logging coverage, ticket-contract approval, or ticket-harness GREEN. Services remain unreloaded; no
live credentials were accessed/submitted. The draft-ticket interview awaits human aim/scope decisions,
and no ticket has been posted.
