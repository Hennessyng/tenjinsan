import { randomUUID } from "node:crypto"
import {
  OutlineContent,
  OutlineDecision,
  OutlineDraft,
  OutlineSave,
  OutlineSection,
  type OutlineView,
  StudyId,
} from "@reading-studio/contracts"
import { z } from "zod"
import type { BriefRepository } from "./briefs.ts"
import type { StorageContext } from "./database.ts"
import { ContractBoundaryError } from "./errors.ts"
import type { WorkflowRepository } from "./workflow.ts"

const Row = z.object({ record_json: z.string() })
const Status = z.enum(["pending", "approved", "revise", "defer", "outdated"])

export class OutlineRepository {
  constructor(
    private readonly context: StorageContext,
    private readonly dependencies: {
      readonly briefs: BriefRepository
      readonly workflow: WorkflowRepository
    },
  ) {}

  current(input: unknown): OutlineView | null {
    const studyId = StudyId.parse(input)
    const row = this.context.sqlite
      .prepare(
        "SELECT d.record_json, c.status FROM outline_drafts d JOIN current_outline_status c ON d.id = c.id WHERE d.study_id = ?",
      )
      .get(studyId)
    if (!row) return null
    const value = Row.extend({ status: Status }).parse(row)
    return { draft: OutlineDraft.parse(JSON.parse(value.record_json)), status: value.status }
  }

  request(id: string): OutlineDraft | null {
    const row = this.context.sqlite
      .prepare("SELECT record_json FROM outline_drafts WHERE id = ?")
      .get(id)
    return row ? OutlineDraft.parse(JSON.parse(Row.parse(row).record_json)) : null
  }

  follows(childId: string, requestId: string): boolean {
    return (
      this.context.sqlite
        .prepare("SELECT 1 FROM input_revisions WHERE id = ? AND parent_revision_id = ?")
        .get(childId, requestId) !== undefined
    )
  }

  save(input: unknown): OutlineDraft {
    const write = OutlineSave.parse(input)
    return this.context.sqlite
      .transaction(() => {
        const current = this.current(write.studyId)
        if ((current?.draft.id ?? null) !== write.expectedRevisionId)
          throw new ContractBoundaryError("stale outline edit")
        const brief = this.dependencies.briefs.approved(write.briefRevisionId)
        if (!brief || brief.studyId !== write.studyId)
          throw new ContractBoundaryError("current brief approval")
        const analysis = this.dependencies.workflow.getAnalysis(brief.analysisRevisionId)
        if (analysis?.status !== "successful") throw new ContractBoundaryError("outline analysis")
        const evidence = [
          ...analysis.claims,
          ...analysis.concepts,
          ...analysis.qualifications,
        ].flatMap((finding) => finding.sources)
        const known = new Set(evidence.map((span) => JSON.stringify(span)))
        for (const section of write.content.sections) {
          if (
            [...section.sources, ...section.visualEvidence].some(
              (span) => !known.has(JSON.stringify(span)),
            )
          )
            throw new ContractBoundaryError("outline evidence outside approved analysis")
        }
        if (
          JSON.stringify(write.content.qualifications) !==
            JSON.stringify(analysis.qualifications) ||
          JSON.stringify(write.content.excludedAreas) !== JSON.stringify(brief.exclusions)
        )
          throw new ContractBoundaryError("outline retained qualifications and exclusions")
        const content = OutlineContent.parse({
          ...write.content,
          sections: write.content.sections.map((section) => ({
            ...section,
            flags: [
              ...new Set([
                ...section.flags,
                ...(section.questionIndex > brief.supportingQuestions.length
                  ? ["irrelevant-section"]
                  : []),
                ...(section.visualKind === "source-grounded" && section.visualEvidence.length === 0
                  ? ["unsupported-visual"]
                  : []),
              ]),
            ],
          })),
        })
        const draft = OutlineDraft.parse({
          id: randomUUID(),
          studyId: write.studyId,
          briefRevisionId: brief.id,
          content,
          feedback: write.feedback,
        })
        this.context.sqlite
          .prepare(
            "INSERT INTO input_revisions (id, study_id, parent_revision_id, kind) VALUES (?, ?, ?, 'outline')",
          )
          .run(draft.id, draft.studyId, current?.draft.id ?? null)
        this.context.sqlite
          .prepare(
            "INSERT INTO outline_drafts (id, study_id, brief_revision_id, record_json) VALUES (?, ?, ?, ?)",
          )
          .run(draft.id, draft.studyId, brief.id, JSON.stringify(draft))
        return draft
      })
      .immediate()
  }

  decide(input: unknown): void {
    const decision = OutlineDecision.parse(input)
    this.context.sqlite
      .transaction(() => {
        const current = this.current(decision.studyId)
        if (!current || current.draft.id !== decision.revisionId || current.status === "outdated")
          throw new ContractBoundaryError("stale outline approval")
        const brief = this.dependencies.briefs.approved(current.draft.briefRevisionId)
        if (!brief) throw new ContractBoundaryError("current brief approval")
        const timestamp = new Date().toISOString()
        switch (decision.action) {
          case "approve": {
            if (
              this.context.sqlite
                .prepare("SELECT 1 FROM jobs WHERE id = ?")
                .get(`outline-${current.draft.id}`)
            )
              throw new ContractBoundaryError("pending provider outline cannot be approved")
            if (
              current.status === "revise" ||
              current.draft.content.sections.some((section) => section.flags.length > 0)
            )
              throw new ContractBoundaryError("outline requires revision")
            if (!this.dependencies.workflow.getOutline(current.draft.id))
              this.dependencies.workflow.appendOutline({
                parentRevisionId: null,
                record: {
                  id: current.draft.id,
                  studyId: brief.studyId,
                  briefRevisionId: brief.id,
                  setupRevisionId: brief.setupRevisionId,
                  analysisRevisionId: brief.analysisRevisionId,
                  sections: current.draft.content.sections.map(
                    ({ questionIndex, visualKind, visualEvidence, flags, ...section }) =>
                      OutlineSection.parse(section),
                  ),
                  approval: { revisionId: current.draft.id, approvedAt: timestamp },
                },
              })
            break
          }
          case "revise":
          case "defer":
            break
          default: {
            const exhaustive: never = decision.action
            return exhaustive
          }
        }
        this.context.sqlite
          .prepare(
            "INSERT INTO outline_decisions (outline_revision_id, action, decided_at) VALUES (?, ?, ?)",
          )
          .run(current.draft.id, decision.action, timestamp)
      })
      .immediate()
  }

  approved(id: string) {
    const row = this.context.sqlite
      .prepare("SELECT id FROM current_outline_status WHERE id = ? AND status = 'approved'")
      .get(id)
    return row ? this.dependencies.workflow.getOutline(id) : null
  }
}
