import { randomUUID } from "node:crypto"
import {
  AnalysisRevision,
  analysisCacheKey,
  BriefDecision,
  BriefDraft,
  BriefRevisionId,
  BriefSave,
  type BriefView,
  guidingQuestion,
  ReadingBrief,
  StudyId,
} from "@reading-studio/contracts"
import { z } from "zod"
import { briefDescendants, currentBriefApproved } from "./brief-approval.ts"
import type { StorageContext } from "./database.ts"
import { ContractBoundaryError } from "./errors.ts"
import type { InterviewRepository } from "./interviews.ts"
import type { SourceRepository } from "./sources.ts"

const Row = z.object({ record_json: z.string() })
const Status = z.enum(["pending", "approved", "revise", "defer", "outdated"])

export class BriefRepository {
  constructor(
    private readonly context: StorageContext,
    private readonly sources: SourceRepository,
    private readonly interviews: InterviewRepository,
  ) {}

  current(input: unknown): BriefView | null {
    const studyId = StudyId.parse(input)
    const row = this.context.sqlite
      .prepare(
        "SELECT d.record_json, c.status FROM brief_drafts d JOIN current_brief_status c ON c.id = d.id WHERE d.study_id = ?",
      )
      .get(studyId)
    if (!row) return null
    const value = Row.extend({ status: Status }).parse(row)
    return { draft: BriefDraft.parse(JSON.parse(value.record_json)), status: value.status }
  }

  save(input: unknown): BriefDraft {
    const write = BriefSave.parse(input)
    return this.context.sqlite
      .transaction(() => {
        const previous = this.current(write.studyId)
        if ((previous?.draft.id ?? null) !== write.expectedRevisionId)
          throw new ContractBoundaryError("stale brief edit")
        const definition = this.interviews.latest(write.studyId)
        const setup = this.sources.getLatestSetup(write.studyId)
        if (!definition || !setup)
          throw new ContractBoundaryError("brief requires setup and interview")
        const analysisRow = this.context.sqlite
          .prepare("SELECT record_json FROM analysis_revisions WHERE id = ?")
          .get(definition.analysisRevisionId)
        const analysis = AnalysisRevision.parse(JSON.parse(Row.parse(analysisRow).record_json))
        if (
          analysis.status !== "successful" ||
          analysis.cacheKey !== analysisCacheKey(setup.analysis)
        )
          throw new ContractBoundaryError("brief analysis differs from current setup")
        if (
          previous &&
          JSON.stringify(previous.draft.content.originalQuestion) !==
            JSON.stringify(write.content.originalQuestion)
        )
          throw new ContractBoundaryError("original question must be preserved")
        const version = z
          .object({ version: z.number() })
          .parse(
            this.context.sqlite
              .prepare(
                "SELECT COALESCE(MAX(sequence), 0) AS version FROM interview_answers WHERE interview_id = ?",
              )
              .get(definition.id),
          ).version
        const record = BriefDraft.parse({
          id: randomUUID(),
          studyId: write.studyId,
          setupRevisionId: setup.id,
          analysisRevisionId: definition.analysisRevisionId,
          interviewId: definition.id,
          answerVersion: version,
          content: write.content,
          scope: setup.analysis.scope,
          answers: this.interviews.answers(definition.id),
        })
        this.context.sqlite
          .prepare(
            "INSERT INTO input_revisions (id, study_id, parent_revision_id, kind) VALUES (?, ?, ?, 'brief')",
          )
          .run(record.id, record.studyId, previous?.draft.id ?? null)
        this.context.sqlite
          .prepare(
            "INSERT INTO brief_drafts (id, study_id, setup_revision_id, interview_id, answer_version, record_json) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(
            record.id,
            record.studyId,
            record.setupRevisionId,
            record.interviewId,
            version,
            JSON.stringify(record),
          )
        return record
      })
      .immediate()
  }

  decide(input: unknown): void {
    const decision = BriefDecision.parse(input)
    this.context.sqlite
      .transaction(() => {
        const current = this.current(decision.studyId)
        if (!current || current.draft.id !== decision.revisionId || current.status === "outdated")
          throw new ContractBoundaryError("stale brief approval")
        const { draft } = current
        const timestamp = new Date().toISOString()
        switch (decision.action) {
          case "approve": {
            if (current.status === "revise")
              throw new ContractBoundaryError("save a revised brief before approval")
            const record = ReadingBrief.parse({
              id: draft.id,
              studyId: draft.studyId,
              setupRevisionId: draft.setupRevisionId,
              analysisRevisionId: draft.analysisRevisionId,
              guidingQuestion: guidingQuestion(draft.content),
              supportingQuestions: draft.content.supportingQuestions,
              purpose: draft.content.purpose,
              context: draft.content.context,
              depth: draft.content.depth,
              language: draft.content.language,
              spoilerPolicy: draft.content.spoilerPolicy,
              exclusions: draft.content.exclusions,
              answers: draft.answers,
              approval: { revisionId: draft.id, approvedAt: timestamp },
            })
            if (
              !this.context.sqlite
                .prepare("SELECT id FROM brief_revisions WHERE id = ?")
                .get(draft.id)
            ) {
              this.context.sqlite
                .prepare(
                  "INSERT INTO brief_revisions (id, study_id, setup_revision_id, analysis_revision_id, parent_revision_id, record_json) VALUES (?, ?, ?, ?, NULL, ?)",
                )
                .run(
                  record.id,
                  record.studyId,
                  record.setupRevisionId,
                  record.analysisRevisionId,
                  JSON.stringify(record),
                )
              this.context.sqlite
                .prepare(
                  "INSERT INTO brief_approvals (brief_revision_id, approved_at, record_json) VALUES (?, ?, ?)",
                )
                .run(record.id, timestamp, JSON.stringify(record.approval))
            }
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
            "INSERT INTO brief_decisions (brief_revision_id, action, decided_at) VALUES (?, ?, ?)",
          )
          .run(draft.id, decision.action, timestamp)
      })
      .immediate()
  }

  approved(input: unknown): ReadingBrief | null {
    const id = BriefRevisionId.parse(input)
    if (!currentBriefApproved(this.context, id)) return null
    const row = this.context.sqlite
      .prepare("SELECT record_json FROM brief_revisions WHERE id = ?")
      .get(id)
    return row ? ReadingBrief.parse(JSON.parse(Row.parse(row).record_json)) : null
  }

  descendants(input: unknown) {
    return briefDescendants(this.context, StudyId.parse(input))
  }
}
