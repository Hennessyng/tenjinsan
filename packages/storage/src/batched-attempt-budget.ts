import { type Job, StudySetupRevision } from "@reading-studio/contracts"
import { eq } from "drizzle-orm"
import { z } from "zod"
import type { StorageContext } from "./database.ts"
import { decodeRecord } from "./records.ts"
import { setupRevisions } from "./schema/index.ts"

export function batchedAttemptBudget(context: StorageContext, job: Job) {
  const row = context.db
    .select()
    .from(setupRevisions)
    .where(eq(setupRevisions.id, job.setupRevisionId))
    .get()
  if (!row) throw new TypeError("Missing setup for attempt budget")
  const setup = decodeRecord(StudySetupRevision, row.recordJson, "attempt setup", row.id)
  const reserve = setup.batchedVerificationReserve
  if (!reserve) return null
  const totals = z
    .object({ analysis: z.number().int().nonnegative(), later: z.number().int().nonnegative() })
    .parse(
      context.sqlite
        .prepare(`SELECT
    COUNT(DISTINCT CASE WHEN json_extract(j.record_json,'$.stage')='analysis' THEN a.id END) AS analysis,
    COUNT(DISTINCT CASE WHEN json_extract(j.record_json,'$.stage')<>'analysis' THEN a.id END) AS later
    FROM external_attempts a JOIN jobs j ON j.run_id=a.run_id WHERE j.setup_revision_id=?`)
        .get(job.setupRevisionId),
    )
  return {
    totalLimit: Math.min(64, reserve.cap, reserve.used + reserve.plannedAttempts),
    phaseUsed: job.stage === "analysis" ? totals.analysis : totals.later,
    phaseLimit:
      job.stage === "analysis" ? reserve.maxAnalysisJobs * 2 : reserve.reservedLaterAttempts,
    perRunLimit: job.stage === "analysis" ? 2 : reserve.reservedLaterAttempts,
  }
}
