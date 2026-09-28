import type { Job } from "@reading-studio/contracts"
import { z } from "zod"
import type { StorageContext } from "./database.ts"
import { ContractBoundaryError } from "./errors.ts"

export function currentBriefApproved(context: StorageContext, id: string): boolean {
  return (
    context.sqlite
      .prepare("SELECT id FROM current_brief_status WHERE id = ? AND status = 'approved'")
      .get(id) !== undefined
  )
}

export function requireBriefApproval(context: StorageContext, id: string): void {
  const managed = context.sqlite.prepare("SELECT id FROM brief_drafts WHERE id = ?").get(id)
  if (managed && !currentBriefApproved(context, id))
    throw new ContractBoundaryError("current brief approval")
}

export function jobBriefCurrent(context: StorageContext, job: Job): boolean {
  const currentSetup = context.sqlite
    .prepare(`
    SELECT id FROM setup_revisions WHERE study_id =
    (SELECT study_id FROM setup_revisions WHERE id = ?)
    ORDER BY rowid DESC LIMIT 1
  `)
    .get(job.setupRevisionId)
  if (!currentSetup || z.object({ id: z.string() }).parse(currentSetup).id !== job.setupRevisionId)
    return false
  if (job.stage === "lesson") {
    const approved = context.sqlite
      .prepare(`SELECT o.id FROM outline_revisions o
      JOIN outline_approvals a ON a.outline_revision_id = o.id WHERE o.id = ?
      AND (NOT EXISTS (SELECT 1 FROM outline_drafts WHERE id = o.id)
      OR EXISTS (SELECT 1 FROM current_outline_status WHERE id = o.id AND status = 'approved'))`)
      .get(job.inputRevisionId)
    if (!approved) return false
  }
  const row = context.sqlite
    .prepare(`
    SELECT id AS brief FROM brief_drafts WHERE id = ?
    UNION SELECT brief_revision_id FROM outline_revisions WHERE id = ?
    UNION SELECT brief_revision_id FROM lesson_revisions WHERE id = ?
    UNION SELECT l.brief_revision_id FROM publication_revisions p JOIN lesson_revisions l ON p.lesson_revision_id = l.id WHERE p.id = ?
  `)
    .get(job.inputRevisionId, job.inputRevisionId, job.inputRevisionId, job.inputRevisionId)
  if (!row) return job.stage !== "outline"
  const id = z.object({ brief: z.string() }).parse(row).brief
  const managed = context.sqlite.prepare("SELECT id FROM brief_drafts WHERE id = ?").get(id)
  return managed ? currentBriefApproved(context, id) : job.stage !== "outline"
}

export function requireJobBrief(context: StorageContext, job: Job): void {
  if (!jobBriefCurrent(context, job)) throw new ContractBoundaryError("current brief approval")
}

export function briefDescendants(context: StorageContext, studyId: string) {
  const rows = context.sqlite
    .prepare(`
    SELECT id, 'outline' AS kind, brief_revision_id AS brief FROM outline_revisions WHERE study_id = ?
    UNION ALL SELECT id, 'lesson', brief_revision_id FROM lesson_revisions WHERE study_id = ?
    UNION ALL SELECT e.hash, 'evidence', l.brief_revision_id FROM evidence_reports e JOIN lesson_revisions l ON e.lesson_revision_id = l.id WHERE l.study_id = ?
    UNION ALL SELECT p.id, 'publication', l.brief_revision_id FROM publication_revisions p JOIN lesson_revisions l ON p.lesson_revision_id = l.id WHERE l.study_id = ?
    UNION ALL SELECT a.id, 'artifact', l.brief_revision_id FROM artifacts a JOIN publication_revisions p ON a.publication_revision_id = p.id JOIN lesson_revisions l ON p.lesson_revision_id = l.id WHERE l.study_id = ?
  `)
    .all(studyId, studyId, studyId, studyId, studyId)
  return rows.map((row) => {
    const value = z
      .object({
        id: z.string(),
        kind: z.enum(["outline", "lesson", "evidence", "publication", "artifact"]),
        brief: z.string(),
      })
      .parse(row)
    return {
      id: value.id,
      kind: value.kind,
      status: currentBriefApproved(context, value.brief)
        ? ("current" as const)
        : ("outdated" as const),
    }
  })
}
