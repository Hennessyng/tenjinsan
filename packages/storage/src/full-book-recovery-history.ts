import type { ExternalAttempt, GenerationRun } from "@reading-studio/contracts"
import type Database from "better-sqlite3"
import { z } from "zod"
import { FullBookExecutionError, FullBookWire } from "./full-book-execution-contract.ts"
import type { readFullBookRecovery } from "./full-book-recovery-read.ts"
export function validateRecoveryRun(
  sqlite: Database.Database,
  ledger: Readonly<{ run: GenerationRun; attempts: readonly ExternalAttempt[] }>,
  recovery: NonNullable<ReturnType<typeof readFullBookRecovery>>,
) {
  const { run, attempts } = ledger
  const third = attempts[2]
  if (
    recovery.state !== "consumed" ||
    run.id !== recovery.amendment.runId ||
    run.budget.maxCalls !== 3 ||
    run.reservedCalls !== 3 ||
    attempts.length !== 3 ||
    new Set(attempts.map((a) => a.id)).size !== 3 ||
    attempts.some(
      (a, index) =>
        a.reservation !== index + 1 ||
        a.runId !== run.id ||
        a.inputRevisionId !== run.inputRevisionId,
    ) ||
    !third ||
    third.id !== recovery.attemptId ||
    (third.state === "outcome_unknown" && !["paused", "failed", "cancelled"].includes(run.state)) ||
    ((third.state === "prepared" || third.state === "dispatching") && run.state !== "running")
  )
    throw new FullBookExecutionError("history")
  const row = z
    .object({ record_json: z.string() })
    .parse(
      sqlite.prepare("SELECT record_json FROM full_book_wires WHERE attempt_id=?").get(third.id),
    )
  const wire = FullBookWire.parse(JSON.parse(row.record_json))
  if (
    wire.recoveryId !== recovery.amendment.id ||
    wire.ordinal !== 3 ||
    wire.jobId !== recovery.amendment.jobId
  )
    throw new FullBookExecutionError("history")
}
