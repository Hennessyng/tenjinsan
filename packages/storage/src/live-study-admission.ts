import { StudySetupRevision } from "@reading-studio/contracts"
import type Database from "better-sqlite3"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { setupAdoptionPending } from "./live-adoption-barrier.ts"
import { LiveStudyGuardError, type LiveStudyTarget } from "./live-study-contract.ts"
import { jobs } from "./schema/index.ts"

export function requirePurposeTarget(
  sqlite: Database.Database,
  target: LiveStudyTarget | undefined,
  setupId: string,
) {
  const row = sqlite.prepare("SELECT record_json FROM setup_revisions WHERE id=?").get(setupId)
  if (!row) return
  const setup = StudySetupRevision.parse(
    JSON.parse(z.object({ record_json: z.string() }).parse(row).record_json),
  )
  if (
    setup.analysis.purpose &&
    (!target ||
      target.setupRevisionId !== setup.id ||
      JSON.stringify(target.purpose) !== JSON.stringify(setup.analysis.purpose) ||
      target.grantId !== `grant-${setup.id}`)
  )
    throw new LiveStudyGuardError("explicit-target-required")
}
export function liveStudyIncludes(
  sqlite: Database.Database,
  target: LiveStudyTarget | undefined,
  setupId: string,
) {
  try {
    requirePurposeTarget(sqlite, target, setupId)
  } catch (error) {
    if (error instanceof LiveStudyGuardError) return false
    throw error
  }
  if (setupAdoptionPending(sqlite, setupId)) return false
  if (
    sqlite
      .prepare(
        "SELECT 1 FROM live_study_effective_admission WHERE setup_id=? AND (kind!='live' OR retired=1 OR enrolled=0 OR approved_limit IS NULL)",
      )
      .get(setupId)
  )
    return false
  return target
    ? target.setupRevisionId === setupId
    : sqlite
        .prepare(
          "SELECT 1 FROM live_study_guards g JOIN setup_revisions s ON s.study_id=g.study_id WHERE s.id=?",
        )
        .get(setupId) === undefined
}
export function liveStudyClaimFilter(target: LiveStudyTarget | undefined) {
  const targetFilter = target
    ? sql`${jobs.setupRevisionId}=${target.setupRevisionId}`
    : sql`NOT EXISTS (SELECT 1 FROM live_study_guards g JOIN setup_revisions s ON s.study_id=g.study_id WHERE s.id=${jobs.setupRevisionId})`
  const purposeFilter = target?.purpose
    ? sql`1=1`
    : sql`NOT EXISTS (SELECT 1 FROM setup_revisions s WHERE s.id=${jobs.setupRevisionId} AND json_extract(s.record_json,'$.analysis.purpose.version')='analysis-evaluation-1')`
  return sql`${targetFilter} AND ${purposeFilter} AND NOT EXISTS (SELECT 1 FROM live_study_effective_admission e WHERE e.setup_id=${jobs.setupRevisionId} AND (e.kind!='live' OR e.retired=1 OR e.enrolled=0 OR e.approved_limit IS NULL)) AND NOT EXISTS (SELECT 1 FROM setup_revisions s JOIN studies st ON st.id=s.study_id JOIN live_study_pending_adoption p ON p.owner_id=st.owner_id WHERE s.id=${jobs.setupRevisionId})`
}
