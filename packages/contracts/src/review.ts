import { z } from "zod"
import { Digest, LessonRevisionId, StudyId, Text, uniqueValues } from "./primitives.ts"
import { PublicationProjection, projectedStrings, projectionHash } from "./projection.ts"
import { PrivacyReview } from "./publication.ts"

export const SemanticCategory = z.enum(["support", "qualification", "translation", "visual"])
export const SemanticDecision = z
  .strictObject({
    category: SemanticCategory,
    status: z.enum(["unresolved", "reviewed", "acknowledged"]),
  })
  .readonly()
export const ManualPrivacyFlag = z.strictObject({ path: Text, textHash: Digest }).readonly()
export const EvidenceDraft = z
  .strictObject({
    id: Text,
    lessonRevisionId: LessonRevisionId,
    studyId: StudyId,
    projection: PublicationProjection,
    projectionHash: Digest,
    semantic: z.array(SemanticDecision).length(4).readonly(),
    privateDetails: uniqueValues(Text),
    manualFlags: z.array(ManualPrivacyFlag).readonly(),
    privacyReviewed: z.boolean(),
    keepPrivate: z.boolean(),
  })
  .refine(
    (draft) =>
      draft.projectionHash === projectionHash(draft.projection) &&
      new Set(draft.semantic.map((item) => item.category)).size === 4,
    "review projection hash or semantic coverage mismatch",
  )
  .readonly()
export type EvidenceDraft = z.infer<typeof EvidenceDraft>
export const MechanicalFinding = z
  .strictObject({
    path: Text,
    category: z.enum(["broken-locator", "unsupported-quotation"]),
  })
  .readonly()
export const EvidenceView = z
  .strictObject({
    draft: EvidenceDraft,
    mechanical: z.array(MechanicalFinding).readonly(),
    privacy: PrivacyReview,
    reportHash: Digest,
    ready: z.boolean(),
  })
  .superRefine((view, ctx) => {
    const paths = projectedStrings(view.draft.projection).map((entry) => entry.path)
    if (
      view.privacy.projectionHash !== view.draft.projectionHash ||
      paths.length !== view.privacy.reviewedPaths.length ||
      paths.some((path) => !view.privacy.reviewedPaths.includes(path)) ||
      (view.ready &&
        (view.mechanical.length > 0 ||
          view.privacy.status !== "passed" ||
          !view.draft.privacyReviewed ||
          view.draft.keepPrivate ||
          view.draft.semantic.some((item) => item.status === "unresolved")))
    )
      ctx.addIssue({ code: "custom", message: "review gate is blocked or stale" })
  })
  .readonly()
export type EvidenceView = z.infer<typeof EvidenceView>

const expected = { expectedId: Text }
export const EvidenceAction = z
  .discriminatedUnion("action", [
    z.strictObject({ ...expected, action: z.literal("replace-text"), path: Text, text: Text }),
    z.strictObject({ ...expected, action: z.literal("remove-content"), path: Text }),
    z.strictObject({
      ...expected,
      action: z.literal("correct"),
      projection: PublicationProjection,
    }),
    z.strictObject({
      ...expected,
      action: z.literal("semantic"),
      category: SemanticCategory,
      status: z.enum(["reviewed", "acknowledged"]),
    }),
    z.strictObject({ ...expected, action: z.literal("private-detail"), text: Text }),
    z.strictObject({ ...expected, action: z.literal("privacy-flag"), path: Text }),
    z.strictObject({ ...expected, action: z.literal("privacy-reviewed") }),
    z.strictObject({ ...expected, action: z.literal("keep-private") }),
  ])
  .readonly()
export type EvidenceAction = z.infer<typeof EvidenceAction>
