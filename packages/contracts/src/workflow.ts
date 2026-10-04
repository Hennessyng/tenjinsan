import { z } from "zod"
import { AnswerSubmission } from "./choices.ts"
import { LessonAttribution, LessonTeaching } from "./lesson-teaching.ts"
import {
  AnalysisRevisionId,
  Bilingual,
  BriefRevisionId,
  ContentId,
  Digest,
  LessonRevisionId,
  OutlineRevisionId,
  SetupRevisionId,
  StudyId,
  Text,
  Timestamp,
  uniqueItems,
  uniqueValues,
} from "./primitives.ts"
import { Practice, SceneSpec } from "./scenes.ts"
import { SourceSpan } from "./source.ts"

const lineage = {
  studyId: StudyId,
  setupRevisionId: SetupRevisionId,
  analysisRevisionId: AnalysisRevisionId,
}
export const ReadingBrief = z
  .strictObject({
    id: BriefRevisionId,
    ...lineage,
    guidingQuestion: Bilingual,
    supportingQuestions: z.array(Bilingual).max(3).readonly(),
    purpose: Text,
    context: Text,
    depth: z.enum(["overview", "focused", "deep"]),
    spoilerPolicy: z.enum(["allow", "avoid"]),
    language: z.enum(["en", "ja", "paired"]),
    exclusions: uniqueValues(Text),
    answers: z.array(AnswerSubmission).readonly(),
    approval: z.strictObject({ revisionId: BriefRevisionId, approvedAt: Timestamp }).readonly(),
  })
  .refine(
    (brief) =>
      brief.approval.revisionId === brief.id &&
      brief.answers.every(
        (submission) => submission.question.analysisRevisionId === brief.analysisRevisionId,
      ) &&
      new Set(brief.answers.map((submission) => submission.question.id)).size ===
        brief.answers.length,
    "brief approval or answer lineage mismatch",
  )
  .readonly()
export type ReadingBrief = z.infer<typeof ReadingBrief>
export const OutlineSection = z
  .strictObject({
    id: ContentId,
    title: Bilingual,
    learningGoals: z.array(Bilingual).min(1).readonly(),
    theme: Bilingual,
    visualIntents: z.array(Bilingual).readonly(),
    sources: z.array(SourceSpan).min(1).readonly(),
  })
  .readonly()
export const StudyOutline = z
  .strictObject({
    id: OutlineRevisionId,
    ...lineage,
    briefRevisionId: BriefRevisionId,
    sections: uniqueItems(OutlineSection).refine((sections) => sections.length > 0),
    approval: z.strictObject({ revisionId: OutlineRevisionId, approvedAt: Timestamp }).readonly(),
  })
  .refine(
    (outline) => outline.approval.revisionId === outline.id,
    "outline approval revision mismatch",
  )
  .readonly()
export type StudyOutline = z.infer<typeof StudyOutline>
export { LessonAttribution } from "./lesson-teaching.ts"
export const ReviewerFlag = z
  .discriminatedUnion("kind", [
    z.strictObject({
      id: ContentId,
      kind: z.literal("mechanical"),
      category: z.enum(["broken-locator", "unsupported-quotation"]),
      status: z.enum(["unresolved", "corrected", "removed"]),
    }),
    z.strictObject({
      id: ContentId,
      kind: z.literal("semantic"),
      category: z.enum(["support", "qualification", "translation"]),
      status: z.enum(["unresolved", "corrected", "removed"]),
    }),
    z.strictObject({
      id: ContentId,
      kind: z.literal("acknowledged-semantic"),
      category: z.enum(["support", "qualification", "translation"]),
      lessonRevisionId: LessonRevisionId,
      acknowledgedAt: Timestamp,
    }),
  ])
  .readonly()
export const LessonSection = z
  .strictObject({
    id: ContentId,
    title: Bilingual,
    content: Bilingual,
    attribution: LessonAttribution,
    reviewerFlags: uniqueItems(ReviewerFlag),
    scenes: uniqueItems(SceneSpec),
    practice: uniqueItems(Practice),
    teaching: LessonTeaching.optional(),
  })
  .readonly()
export const LessonRevision = z
  .strictObject({
    id: LessonRevisionId,
    ...lineage,
    briefRevisionId: BriefRevisionId,
    outlineRevisionId: OutlineRevisionId,
    sections: uniqueItems(LessonSection).refine((sections) => sections.length > 0),
    coverage: z
      .strictObject({
        kind: z.enum(["complete-approved-scope", "partial"]),
        sources: z.array(SourceSpan).min(1).readonly(),
        limitations: z.array(Bilingual).readonly(),
      })
      .readonly(),
  })
  .superRefine((lesson, ctx) => {
    const scenes = lesson.sections.flatMap((section) => section.scenes.map((scene) => scene.id))
    if (new Set(scenes).size !== scenes.length)
      ctx.addIssue({ code: "custom", message: "duplicate lesson scene IDs" })
    if (
      lesson.sections.some((section) =>
        section.reviewerFlags.some(
          (flag) => flag.kind === "acknowledged-semantic" && flag.lessonRevisionId !== lesson.id,
        ),
      )
    )
      ctx.addIssue({ code: "custom", message: "stale semantic acknowledgement" })
  })
  .readonly()
export type LessonRevision = z.infer<typeof LessonRevision>
export const WorkflowLineage = z
  .strictObject({ brief: ReadingBrief, outline: StudyOutline, lesson: LessonRevision })
  .refine(
    ({ brief, outline, lesson }) =>
      outline.briefRevisionId === brief.id &&
      lesson.briefRevisionId === brief.id &&
      lesson.outlineRevisionId === outline.id &&
      [outline, lesson].every(
        (revision) =>
          revision.studyId === brief.studyId &&
          revision.setupRevisionId === brief.setupRevisionId &&
          revision.analysisRevisionId === brief.analysisRevisionId,
      ),
    "stale downstream revision",
  )
  .readonly()
export const EvidenceReport = z
  .strictObject({
    hash: Digest,
    lessonRevisionId: LessonRevisionId,
    flags: uniqueItems(ReviewerFlag),
  })
  .refine(
    (report) =>
      report.flags.every((flag) =>
        flag.kind === "acknowledged-semantic"
          ? flag.lessonRevisionId === report.lessonRevisionId
          : flag.status !== "unresolved",
      ),
    "evidence review has unresolved flags",
  )
  .readonly()
