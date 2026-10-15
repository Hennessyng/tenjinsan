# TEN-17 workflow overhead — session note and evidence index

**Prepared:** 2026-10-15

**Purpose:** Provide the user’s agents with a bounded evidence map for diagnosing workflow latency/overhead. This is a session record, not a performance attribution or an approval of TEN-17.

## Summary

The recorded TEN-17 workflow was continued across conversations, migrated from the legacy harness to direct host tests by user approval, then went through repeated independent-review attempts that all remained blocked because the reviewer could not read the exact temporary evidence artifacts. When the user reported a real owner-login failure, the supplied trace showed `auth.login.rejected`, `invalid-credentials`, HTTP 401. The same driver later reproduced and repaired a separate synthetic terminal-input bug, but explicitly could not establish that it caused the user’s failure. The subsequent driver continuation was aborted.

The assistant previously said “Mostly workflow overhead and repeated LLM/tool rounds,” but did **not** have reliable timing/provider telemetry to distinguish workflow delays from model/tool latency. Treat that as an accountable hypothesis, not measured attribution.

```text
resume prior run
  -> test/evidence inspection
  -> repeated reviewer sessions/continuations, same artifact-access denial
  -> user reports actual 401 trace
  -> same driver synthetic reproduction/repair; real cause still unknown
  -> requested continuation aborted
```

## Session and worker references

| Purpose | ID / evidence |
|---|---|
| Conversation where this continuation and repeated review work occurred | Parent session `ses_ec7619165ffendL4nxBr73zS0H` |
| Original TEN-17 workflow/coordinator history | `ses_ed4c70ee5ffeY4XpyxE2186fr9` (195 messages, Oct 11–12; session metadata reports 16 hours; not this continuation’s elapsed runtime) |
| Existing implementation driver | Job `ten-17-implement-and-ship-driver`; role `driver`; session `ses_ed47c46feffeayCAPgtxNRNIC0` |
| Independent reviewer | Job `TEN-17-independent-code-review`; role `reviewer`; session `ses_ec6ee6df7ffe5FMU8O5LSc8dGp`; bound to the driver above |
| User’s trace lookup and first synthetic repair report | Driver reply `msg_13a8f686a001lRONDohesJK2h5` |
| Latest follow-up resume | Driver turn recorded failed/aborted with no observed profile or message ID in current native status; **not evidence of a completed continuation** |

## Workflow overhead observations to investigate

1. **Review-access loop:** the same reviewer returned NOT APPROVED multiple times because `Read` was denied for the external `/var/folders/.../lean-host/` artifacts. Parent inspection, summaries and excerpts did not resolve the reviewer’s access limitation. This appears to have consumed repeated turns without changing the prerequisite.
2. **Cross-conversation recovery:** continuation required session/job/role recovery, status checking, skill loading, todo reconstruction, then driver resume. Determine which calls were necessary and which duplicated setup/evidence retrieval.
3. **Evidence visibility mismatch:** parent and driver could read exact evidence, reviewer could not. The workflow lacked a shared, authorized way to provide candidate-bound artifacts to the reviewer. Do not “fix” this by broadening filesystem permissions without authorization.
4. **Stage scope:** manual QA, reviewer approval, owner’s private confirmation, and Docker verification were distinct. Docker was excluded by the user’s no-container choice. User-owned confirmation appropriately required the user; visual screenshots did not equal live manual QA.
5. **Actual failure added diagnostic work:** the owner’s login failure made additional reproduction necessary. The safe trace was retrieved before restart and showed 401 invalid credentials, not the underlying cause.

### Timing evidence limits

- No provider/tool duration ledger was captured in this note. Session metadata for the *older* coordinator session is not proof of wall-clock model latency for this work.
- Native driver receipt records several completed rounds and at least two failed/aborted rounds, but provider execution/effort telemetry is `unknown`.
- Message timestamps across different sessions and user idle intervals should not be treated as model inference time.
- Agents should separate user waiting time, orchestration/permission/tool round trips, and actual model execution only when supported by timestamps/telemetry.

## TEN-17 evidence and state

Original lean-host evidence directory:

`/var/folders/64/nwznnb8j1sv1wy_clc0300cm0000gn/T/opencode/ten-17-fix-local-owner-recovery-and-safe-login-diagnosis-readiness/lean-host/`

Key original artifacts:

- `ten-17.patch` — original 24-file candidate delta; previously reported SHA-256 `548117adf3b7dbe5a0816f7a0714c02afddcc074c0b45c48f78ab405876dc054`.
- `final-current-inputs.xml` — original focused test run, 37 tests / 0 failures / 0 errors; previously reported SHA-256 `ddccbef9691bc13b5aaa51f592ac3bbebef097e429a094d64494c64d0c485a1c`.
- `obligation-tests.md` — mapping from plan obligations to tests.
- `implementation-evidence.json`, `access-verification.md` — execution/test chronology and limitations. Typecheck/build/lint were reported as outcomes without standalone raw logs; lint had warnings/information diagnostics.
- `baseline/identity.json` — TEN-16 preservation/index baseline.
- `screenshots/` — nine screenshots at 375/768/1280 widths across origin/body/rate rejection views.
- `reopened/results.json` — evidence summary for the later synthetic terminal-input issue and repair. Read this file for its exact test/log/artifact names; it reports actual cause unresolved, specific RED/GREEN/regression counts, three-file scoped repair, baseline preservation, and no access to the user’s active installation.
- `reopened/debug-journal.md`, `reopened/repair.patch`, `reopened/repair.index`, and XML files referenced by `results.json` — detailed follow-up evidence. Their existence/content beyond `results.json` has not been independently revalidated for this note.

Original candidate tree was reported as `d5060e45cdbaacef713c72f4769cf6b77bbf7e1d`; the reopened repair records a new source tree `7f3334f2567dca14a69a046a834aba7dfd13915a`. Original HEAD was `33fd965046a39de7850e512879349d7301b26a6b`. TEN-16 prior tree `a945e8492bab3d0f41c1c7e05bff20d909a8f92b`; original index SHA `b51746068a999d0142ff069618766d3e9defde1e35256461a7ca312d5a2564a6` was reported unchanged. No commit/publication was authorized or made.

## Real owner-login failure (do not conflate with synthetic repair)

User-provided safe lookup for trace `7889fe42-7111-4b86-a1d9-ba3bca5be8e7` returned:

```json
{
  "event": "auth.login.rejected",
  "category": "invalid-credentials",
  "status": 401,
  "method": "POST",
  "requestId": "7889fe42-7111-4b86-a1d9-ba3bca5be8e7",
  "trace_id": "7889fe42-7111-4b86-a1d9-ba3bca5be8e7",
  "route": "/login",
  "upstream_status": 401
}
```

This establishes that the credential pair received by the server was rejected. It does **not** establish why: password entry, account identity/email, reset completion, data-root alignment, or which process/version handled login remain possible. The user later confirmed only: “Reset then restarted” (reported reset success and `local-ready`). Origin and launch command were not provided. No password, `.env`, active database or private library was accessed.

The driver reproduced a *synthetic* terminal input bug involving bracketed paste/action-buffer handling and repaired it. Its report states that different synthetic account/data choices had the same 401 result and that the real user cause remains unresolved. Do not claim this repair fixed the user installation.

## Independent review state

Reviewer session `ses_ec6ee6df7ffe5FMU8O5LSc8dGp` returned NOT APPROVED/not certified. Across turns, it consistently could not read the original patch/JUnit/mapping/screenshots in its execution environment. It inspected working-tree code and later bounded pasted excerpts, finding no new blocking product defect in those excerpts, but explicitly withheld whole-change approval and did not verify the artifact hashes. Do not rewrite this as an approval or as a product-defect finding.

## Suggested questions for workflow diagnosis

- Why were repeated reviewer resumes attempted after the first unchanged artifact-access denial?
- Could one preflight detect child-readable artifact access before launching/continuing review, with a single authorized remedy or immediate blocker report?
- Which setup/skill/todo/status calls were repeated across conversations despite existing receipts?
- How can the coordinator preserve concise evidence refs while letting the bound reviewer inspect the exact candidate and logs without widening permissions?
- Can native receipts expose per-call start/end/duration and error/abort reason? Current records show execution/effort telemetry unknown.
- What explicit stop condition should prevent further same-evidence reviewer retries?

## Privacy and scope

This note contains no credentials, cookies, database paths, private library contents, `.env` values, or raw application logs. Keep it with the TEN-17 workspace for print/review. Do not share the temporary evidence directory more broadly than needed.
