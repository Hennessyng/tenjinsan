import { ExternalAttempt, GenerationRun, RunAttempts } from "@reading-studio/contracts"
import { z } from "zod"
import type { StorageContext } from "./database.ts"
import { LiveStudyGuardError } from "./live-study-contract.ts"

function counterRecord(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    if (error instanceof SyntaxError) throw new LiveStudyGuardError("counter-unknown")
    throw error
  }
}

export function liveStudyCount(context: Pick<StorageContext, "sqlite">, studyId: string): number {
  const rows = context.sqlite
    .prepare(`SELECT r.id, r.record_json, r.reserved_calls FROM generation_runs r
    WHERE EXISTS (SELECT 1 FROM jobs j JOIN setup_revisions s ON s.id=j.setup_revision_id WHERE j.run_id=r.id AND s.study_id=?)`)
    .all(studyId)
  let reserved = 0
  const runs: GenerationRun[] = []
  for (const value of rows) {
    const row = z
      .object({
        id: z.string(),
        record_json: z.string(),
        reserved_calls: z.number().int().nonnegative(),
      })
      .safeParse(value)
    if (!row.success) throw new LiveStudyGuardError("counter-unknown")
    const run = GenerationRun.safeParse(counterRecord(row.data.record_json))
    if (
      !run.success ||
      run.data.id !== row.data.id ||
      run.data.reservedCalls !== row.data.reserved_calls
    )
      throw new LiveStudyGuardError("counter-unknown")
    runs.push(run.data)
    reserved += run.data.reservedCalls
  }
  const attempts = context.sqlite
    .prepare(`SELECT a.id,a.run_id,a.state,a.reservation,a.record_json
    FROM external_attempts a WHERE EXISTS (SELECT 1 FROM jobs j JOIN setup_revisions s ON s.id=j.setup_revision_id WHERE j.run_id=a.run_id AND s.study_id=?)`)
    .all(studyId)
  if (reserved !== attempts.length || reserved > 20)
    throw new LiveStudyGuardError("counter-unknown")
  const records: ExternalAttempt[] = []
  for (const value of attempts) {
    const row = z
      .object({
        id: z.string(),
        run_id: z.string(),
        state: z.string(),
        reservation: z.number().int().positive(),
        record_json: z.string(),
      })
      .safeParse(value)
    if (!row.success) throw new LiveStudyGuardError("counter-unknown")
    const parsed = ExternalAttempt.safeParse(counterRecord(row.data.record_json))
    if (
      !parsed.success ||
      parsed.data.id !== row.data.id ||
      parsed.data.runId !== row.data.run_id ||
      parsed.data.state !== row.data.state ||
      parsed.data.reservation !== row.data.reservation
    )
      throw new LiveStudyGuardError("counter-unknown")
    records.push(parsed.data)
    switch (parsed.data.state) {
      case "outcome_unknown":
        if (
          parsed.data.resolution === "awaiting-owner" ||
          !context.sqlite
            .prepare(
              "SELECT 1 FROM setup_revisions WHERE study_id=? AND json_extract(record_json,'$.analysis.purpose.version')='analysis-evaluation-1' LIMIT 1",
            )
            .get(studyId)
        )
          throw new LiveStudyGuardError("outcome-unknown")
        break
      case "prepared":
      case "dispatching":
      case "response-received":
        break
      default:
        return assertNever(parsed.data)
    }
  }
  for (const run of runs)
    if (
      !RunAttempts.safeParse({
        run,
        attempts: records.filter((attempt) => attempt.runId === run.id),
      }).success
    )
      throw new LiveStudyGuardError("counter-unknown")
  return reserved
}
function assertNever(value: never): never {
  throw new TypeError(`Unexpected attempt state: ${value}`)
}
