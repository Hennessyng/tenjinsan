import { contentDigest, type StudySetupRevision } from "@reading-studio/contracts"
import type Database from "better-sqlite3"
import { LiveStudyGuardError, type LiveStudyTarget } from "./live-study-contract.ts"

export function enrollFreshAnalysisBudget(
  sqlite: Database.Database,
  setup: StudySetupRevision,
  target: LiveStudyTarget,
  ownerId: string,
) {
  if (!target.budgetId || target.attemptLimit !== 20)
    throw new LiveStudyGuardError("budget-mismatch")
  if (
    sqlite
      .prepare(
        "SELECT 1 FROM live_study_guards g JOIN studies st ON st.id=g.study_id WHERE st.owner_id=? AND NOT EXISTS(SELECT 1 FROM live_study_budget_members m WHERE m.authorization_id=g.authorization_id) LIMIT 1",
      )
      .get(ownerId)
  )
    throw new LiveStudyGuardError("adoption-required")
  const prior = sqlite
    .prepare(`SELECT 1 FROM live_study_guards g JOIN studies st ON st.id=g.study_id JOIN setup_revisions s ON s.id=g.setup_revision_id WHERE st.owner_id=? AND json_extract(s.record_json,'$.analysis.editionHash')=?
    UNION ALL SELECT 1 FROM jobs j JOIN setup_revisions s ON s.id=j.setup_revision_id JOIN studies st ON st.id=s.study_id WHERE st.owner_id=? AND json_extract(s.record_json,'$.analysis.editionHash')=?
    UNION ALL SELECT 1 FROM transmission_grants g JOIN setup_revisions s ON s.id=g.setup_revision_id JOIN studies st ON st.id=s.study_id WHERE st.owner_id=? AND json_extract(s.record_json,'$.analysis.editionHash')=? AND g.kind='active' LIMIT 1`)
    .get(ownerId, target.sourceHash, ownerId, target.sourceHash, ownerId, target.sourceHash)
  if (prior) throw new LiveStudyGuardError("adoption-required")
  sqlite
    .prepare("INSERT INTO live_study_budgets VALUES (?,?,?,20,0,'live',?)")
    .run(
      target.budgetId,
      ownerId,
      target.sourceHash,
      JSON.stringify({ version: "analysis-purpose-fresh-1", target }),
    )
  sqlite
    .prepare("INSERT INTO live_study_budget_approvals VALUES (?,?,?,?,?,?,?)")
    .run(
      target.authorizationId,
      target.budgetId,
      setup.studyId,
      setup.id,
      JSON.stringify(target),
      contentDigest(JSON.stringify(setup)),
      20,
    )
}
