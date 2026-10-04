import { EvidenceDraft, LessonRevisionId, StudyId } from "@reading-studio/contracts"
import { z } from "zod"
import type { StorageContext } from "./database.ts"
import { ContractBoundaryError } from "./errors.ts"

export class ReviewRepository {
  constructor(private readonly context: StorageContext) {}

  latestLessonId(input: unknown) {
    const studyId = StudyId.parse(input)
    const row = this.context.sqlite
      .prepare("SELECT id FROM lesson_revisions WHERE study_id = ? ORDER BY rowid DESC LIMIT 1")
      .get(studyId)
    return row ? z.object({ id: LessonRevisionId }).parse(row).id : null
  }

  current(input: unknown): EvidenceDraft | null {
    const lessonId = LessonRevisionId.parse(input)
    const row = this.context.sqlite
      .prepare(
        "SELECT record_json FROM evidence_review_drafts WHERE lesson_revision_id = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(lessonId)
    return row
      ? EvidenceDraft.parse(
          JSON.parse(z.object({ record_json: z.string() }).parse(row).record_json),
        )
      : null
  }

  append(input: unknown, expectedId: string | null): EvidenceDraft {
    const record = EvidenceDraft.parse(input)
    return this.context.sqlite
      .transaction(() => {
        const current = this.current(record.lessonRevisionId)
        if ((current?.id ?? null) !== expectedId)
          throw new ContractBoundaryError("stale evidence review")
        const lesson = this.context.sqlite
          .prepare("SELECT study_id FROM lesson_revisions WHERE id = ?")
          .get(record.lessonRevisionId)
        if (!lesson || z.object({ study_id: StudyId }).parse(lesson).study_id !== record.studyId)
          throw new ContractBoundaryError("review lesson lineage")
        this.context.sqlite
          .prepare(
            "INSERT INTO evidence_review_drafts (id, lesson_revision_id, parent_id, record_json) VALUES (?, ?, ?, ?)",
          )
          .run(record.id, record.lessonRevisionId, expectedId, JSON.stringify(record))
        return record
      })
      .immediate()
  }
}
