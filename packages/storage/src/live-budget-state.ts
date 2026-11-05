import { contentDigest, StudySetupRevision } from "@reading-studio/contracts"
import type Database from "better-sqlite3"
import { z } from "zod"
import { fullBookSourceCommitments } from "./full-book-source-accounting.ts"
import { setupAdoptionPending } from "./live-adoption-barrier.ts"
import { LiveStudyGuardError } from "./live-study-contract.ts"
import { liveStudyCount } from "./live-study-count.ts"

export const BudgetRow = z.object({
  id: z.uuid(),
  owner_id: z.string(),
  source_hash: z.string(),
  total_limit: z.literal(20),
  reserved_total: z.number().int().min(0).max(20),
  kind: z.enum(["live", "restored"]),
  adoption_json: z.string(),
})
export function budgetSetup(sqlite: Database.Database, id: string) {
  const row = z
    .object({ record_json: z.string(), owner_id: z.string() })
    .safeParse(
      sqlite
        .prepare(
          "SELECT s.record_json,st.owner_id FROM setup_revisions s JOIN studies st ON st.id=s.study_id WHERE s.id=?",
        )
        .get(id),
    )
  if (!row.success) throw new LiveStudyGuardError("target-mismatch")
  return {
    setup: StudySetupRevision.parse(JSON.parse(row.data.record_json)),
    ownerId: row.data.owner_id,
  }
}
export function budgetStatus(sqlite: Database.Database, id: string) {
  return sqlite.transaction(() => readBudgetStatus(sqlite, id))()
}
export function scopeReservations(sqlite: Database.Database, ownerId: string, sourceHash: string) {
  const studies = z
    .array(z.object({ study_id: z.string() }))
    .parse(
      sqlite
        .prepare(
          "SELECT DISTINCT s.study_id FROM setup_revisions s JOIN studies st ON st.id=s.study_id WHERE st.owner_id=? AND json_extract(s.record_json,'$.analysis.editionHash')=?",
        )
        .all(ownerId, sourceHash),
    )
  for (const study of studies) liveStudyCount({ sqlite }, study.study_id)
  return z
    .object({ count: z.number().int().nonnegative() })
    .parse(
      sqlite
        .prepare(
          "SELECT COUNT(DISTINCT a.id) AS count FROM external_attempts a JOIN live_study_scope_jobs j ON j.run_id=a.run_id WHERE j.owner_id=? AND j.source_hash=?",
        )
        .get(ownerId, sourceHash),
    ).count
}
function readBudgetStatus(sqlite: Database.Database, id: string) {
  const parsed = BudgetRow.safeParse(
    sqlite.prepare("SELECT * FROM live_study_budgets WHERE id=?").get(id),
  )
  if (!parsed.success) throw new LiveStudyGuardError("budget-mismatch")
  const group = parsed.data
  const members = z
    .array(
      z.object({
        authorization_id: z.string(),
        study_id: z.string(),
        setup_revision_id: z.string(),
        reserved_calls: z.number().int().nonnegative(),
        setup_hash: z.string(),
      }),
    )
    .parse(
      sqlite
        .prepare(
          `SELECT g.authorization_id,g.study_id,g.setup_revision_id,g.reserved_calls,g.setup_hash FROM live_study_budget_members m JOIN live_study_guards g ON g.authorization_id=m.authorization_id WHERE m.budget_id=?`,
        )
        .all(id),
    )
  let used = 0
  for (const member of members) {
    const { setup, ownerId } = budgetSetup(sqlite, member.setup_revision_id)
    if (
      ownerId !== group.owner_id ||
      setup.analysis.editionHash !== group.source_hash ||
      (group.kind === "live" && contentDigest(JSON.stringify(setup)) !== member.setup_hash)
    )
      throw new LiveStudyGuardError("budget-mismatch")
    const count = liveStudyCount({ sqlite }, member.study_id)
    if (count !== member.reserved_calls) throw new LiveStudyGuardError("counter-unknown")
    used += count
  }
  if (
    !members.length ||
    used !== group.reserved_total ||
    used > 20 ||
    used !== scopeReservations(sqlite, group.owner_id, group.source_hash)
  )
    throw new LiveStudyGuardError("counter-unknown")
  const projected = fullBookSourceCommitments(sqlite, group.owner_id, group.source_hash)
  return {
    id: group.id,
    used: projected.spent,
    remaining: Math.max(0, 20 - projected.spent),
    limit: 20 as const,
    kind: group.kind,
  }
}
export function budgetAdmission(sqlite: Database.Database, setupId: string) {
  if (setupAdoptionPending(sqlite, setupId)) throw new LiveStudyGuardError("adoption-required")
  const row = sqlite
    .prepare("SELECT * FROM live_study_effective_admission WHERE setup_id=?")
    .get(setupId)
  if (!row) return null
  const selected = z
    .object({
      budget_id: z.string(),
      kind: z.enum(["live", "restored"]),
      retired: z.number(),
      enrolled: z.number(),
      approved_limit: z.number().nullable(),
    })
    .parse(row)
  if (selected.kind === "restored") throw new LiveStudyGuardError("budget-restored")
  if (selected.retired) throw new LiveStudyGuardError("retired")
  if (!selected.enrolled || selected.approved_limit === null)
    throw new LiveStudyGuardError("budget-mismatch")
  const status = budgetStatus(sqlite, selected.budget_id)
  return { ...status, targetLimit: selected.approved_limit }
}
