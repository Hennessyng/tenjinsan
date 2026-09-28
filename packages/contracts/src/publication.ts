import { z } from "zod"
import {
  AnalysisRevisionId,
  Digest,
  LessonRevisionId,
  PrivacyReviewId,
  PublicationRevisionId,
  Text,
  Timestamp,
  uniqueValues,
} from "./primitives.ts"
import {
  PublicationProjection,
  projectedStrings,
  projectionHash,
  publicationTeachingStateIds,
} from "./projection.ts"
import { TeachingStateId } from "./scenes.ts"

const PrivacyFinding = z
  .strictObject({
    path: Text,
    category: z.enum(["personal-detail", "secret", "private-source", "uncertain"]),
    resolution: z.enum(["unresolved", "remove-or-generalize"]),
  })
  .readonly()
export const PrivacyReview = z
  .strictObject({
    id: PrivacyReviewId,
    projectionHash: Digest,
    reviewedPaths: uniqueValues(Text),
    findings: z.array(PrivacyFinding).readonly(),
    status: z.enum(["passed", "blocked"]),
  })
  .refine(
    (review) => review.status !== "passed" || review.findings.length === 0,
    "privacy findings cannot be waived",
  )
  .readonly()
export type PrivacyReview = z.infer<typeof PrivacyReview>
export const PublicationApproval = z
  .strictObject({
    projectionHash: Digest,
    privacyReviewId: PrivacyReviewId,
    evidenceReportHash: Digest,
    rendererVersion: Text,
    requiredStateIds: uniqueValues(TeachingStateId),
    assetHashes: uniqueValues(Digest),
    approvedAt: Timestamp,
  })
  .readonly()
export const PublicationRevision = z
  .strictObject({
    id: PublicationRevisionId,
    lessonRevisionId: LessonRevisionId,
    analysisRevisionId: AnalysisRevisionId,
    projection: PublicationProjection,
    projectionHash: Digest,
    privacyReview: PrivacyReview,
    approval: PublicationApproval,
  })
  .superRefine((revision, ctx) => {
    const hash = projectionHash(revision.projection)
    if (
      revision.projectionHash !== hash ||
      revision.privacyReview.projectionHash !== hash ||
      revision.approval.projectionHash !== hash ||
      revision.approval.privacyReviewId !== revision.privacyReview.id ||
      revision.privacyReview.status !== "passed"
    )
      ctx.addIssue({
        code: "custom",
        message: "publication approval is stale or privacy is blocked",
      })
    const paths = projectedStrings(revision.projection).map((entry) => entry.path)
    if (
      paths.length !== revision.privacyReview.reviewedPaths.length ||
      !paths.every((path) => revision.privacyReview.reviewedPaths.includes(path))
    )
      ctx.addIssue({
        code: "custom",
        message: "privacy review must cover every projected string and asset metadata",
      })
    const required = publicationTeachingStateIds(revision.projection)
    if (
      required.length !== revision.approval.requiredStateIds.length ||
      !required.every((id) => revision.approval.requiredStateIds.includes(id))
    )
      ctx.addIssue({ code: "custom", message: "approval state coverage mismatch" })
    const assets = [...new Set(revision.projection.assets.map((asset) => asset.contentHash))]
    if (
      assets.length !== revision.approval.assetHashes.length ||
      !assets.every((hash) => revision.approval.assetHashes.includes(hash))
    )
      ctx.addIssue({ code: "custom", message: "approval asset manifest mismatch" })
  })
  .readonly()
export type PublicationRevision = z.infer<typeof PublicationRevision>

export const PrivacyScreeningInput = z
  .strictObject({
    projection: PublicationProjection,
    privateDetails: z.array(Text).min(1).readonly(),
  })
  .readonly()
export type PrivacyScreeningInput = z.infer<typeof PrivacyScreeningInput>
export function privacyCanaryPaths(input: PrivacyScreeningInput): readonly string[] {
  const normalized = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/gu, "")
  const canaries = input.privateDetails.map(normalized)
  return Object.freeze(
    projectedStrings(input.projection)
      .filter((entry) => canaries.some((canary) => normalized(entry.text).includes(canary)))
      .map((entry) => entry.path),
  )
}

export const PrivacyScreenedProjection = PrivacyScreeningInput.refine(
  (input) => privacyCanaryPaths(input).length === 0,
  "projected content contains a known private detail",
)
