import { z } from "zod"
import {
  AnalysisCacheInput,
  analysisCacheKey,
  baseAnalysisCacheKey,
  ModelSettings,
} from "./analysis-cache.ts"
import { AnalysisEvaluationPurpose } from "./analysis-purpose.ts"
import { BATCHED_VERIFICATION_VERSION, BatchedVerificationReserve } from "./batched-verification.ts"
import { bookMapProjection, WholeBookPreparation } from "./book-preparation.ts"
import { ExperimentalCoverageOptIn } from "./experimental-coverage.ts"

export {
  AnalysisCacheInput,
  analysisCacheKey,
  baseAnalysisCacheKey,
  ModelSettings,
} from "./analysis-cache.ts"

export { Provider } from "./provider.ts"

import {
  AnalysisRevisionId,
  BlockId,
  ContentId,
  Digest,
  EditionId,
  GrantId,
  InstallationId,
  OwnerId,
  ResourcePath,
  SetupRevisionId,
  StudyId,
  Text,
  Timestamp,
  uniqueItems,
  uniqueValues,
} from "./primitives.ts"
import { SourceSpan } from "./source.ts"

export { SourceScope, wholeBookScope } from "./source-scope.ts"

import { SubscriptionDestination, sameSubscriptionDestination } from "./subscriptions.ts"

export const StudySetupRevision = z
  .strictObject({
    id: SetupRevisionId,
    studyId: StudyId,
    editionId: EditionId,
    analysis: AnalysisCacheInput,
    experimentalCoverageOptIn: ExperimentalCoverageOptIn.optional(),
    batchedVerificationReserve: BatchedVerificationReserve.optional(),
    generation: z
      .strictObject({ promptVersion: Text, schemaVersion: Text, settings: ModelSettings })
      .readonly(),
  })
  .superRefine((setup, ctx) => {
    const reserve = setup.batchedVerificationReserve,
      processing = setup.analysis.processing
    if (!reserve && !processing?.batchReserveId) return
    if (
      !reserve ||
      processing?.synthesisVersion !== BATCHED_VERIFICATION_VERSION ||
      (processing.preprocessingVersion !== "batched-capacity-4" &&
        processing.preprocessingVersion !== "batched-room-5") ||
      processing.batchReserveId !== reserve.id ||
      reserve.analysisKey !== baseAnalysisCacheKey(setup.analysis) ||
      reserve.windowHashes.length !== processing.plan?.length ||
      reserve.capacityId !== processing.capacityId
    )
      ctx.addIssue({ code: "custom", message: "foreign or circular verification reserve" })
    if (
      reserve &&
      JSON.stringify(setup.analysis.purpose) !==
        JSON.stringify("purpose" in reserve ? reserve.purpose : undefined)
    )
      ctx.addIssue({ code: "custom", message: "foreign reserve purpose" })
    if (
      setup.analysis.purpose &&
      reserve &&
      (processing?.preprocessingVersion !== "batched-room-5" ||
        setup.analysis.analysisPromptVersion !== "whole-book-2" ||
        setup.analysis.analysisSchemaVersion !== "whole-book-2")
    )
      ctx.addIssue({ code: "custom", message: "evaluation requires current fixed room policy" })
  })
  .readonly()
export type StudySetupRevision = z.infer<typeof StudySetupRevision>
export const TransmissionCategory = z.enum([
  "book-text",
  "reader-context",
  "derived-study-material",
])
const grantFields = {
  id: GrantId,
  setupRevisionId: SetupRevisionId,
  installationId: InstallationId,
  ownerId: OwnerId,
  categories: uniqueValues(TransmissionCategory).refine((categories) => categories.length > 0),
  approvedAt: Timestamp,
  destination: SubscriptionDestination.optional(),
  purpose: AnalysisEvaluationPurpose.optional(),
}
export const ActiveTransmissionGrant = z
  .strictObject({ kind: z.literal("active"), ...grantFields })
  .readonly()
export const TransmissionGrant = z.discriminatedUnion("kind", [
  ActiveTransmissionGrant,
  z.strictObject({ kind: z.literal("historical"), ...grantFields }).readonly(),
  z.strictObject({ kind: z.literal("revoked"), ...grantFields, revokedAt: Timestamp }).readonly(),
])
export type TransmissionGrant = z.infer<typeof TransmissionGrant>
export const TransmissionAuthorization = z
  .strictObject({
    setup: StudySetupRevision,
    grant: ActiveTransmissionGrant,
    installationId: InstallationId,
    ownerId: OwnerId,
    categories: uniqueValues(TransmissionCategory).refine((categories) => categories.length > 0),
  })
  .refine(
    ({ setup, grant, installationId, ownerId, categories }) =>
      setup.id === grant.setupRevisionId &&
      grant.installationId === installationId &&
      grant.ownerId === ownerId &&
      JSON.stringify(setup.analysis.purpose) === JSON.stringify(grant.purpose) &&
      (!setup.analysis.purpose ||
        (grant.id === `grant-${setup.id}` &&
          grant.categories.length === 2 &&
          grant.categories.includes("book-text") &&
          grant.categories.includes("derived-study-material"))) &&
      sameSubscriptionDestination(setup.analysis.destination, grant.destination) &&
      (grant.destination === undefined || grant.destination.installationId === installationId) &&
      categories.every((category) => grant.categories.includes(category)),
    "grant does not authorize this request",
  )
  .readonly()

const Finding = z
  .strictObject({ id: ContentId, text: Text, sources: z.array(SourceSpan).min(1).readonly() })
  .readonly()
export const AnalysisRevision = z
  .strictObject({
    id: AnalysisRevisionId,
    editionId: EditionId,
    cacheInput: AnalysisCacheInput,
    cacheKey: Digest,
    status: z.enum(["partial", "successful"]),
    chapters: z
      .array(
        z
          .strictObject({
            resourcePath: ResourcePath,
            blockIds: uniqueValues(BlockId),
            status: z.enum(["pending", "complete"]),
          })
          .readonly(),
      )
      .readonly(),
    claims: uniqueItems(Finding),
    concepts: uniqueItems(Finding),
    qualifications: uniqueItems(Finding),
    wholeBook: WholeBookPreparation.optional(),
  })
  .superRefine((analysis, ctx) => {
    if (analysis.cacheInput.analysisPromptVersion === "whole-book-2") {
      const preparation = analysis.wholeBook
      if (
        JSON.stringify(preparation?.terminal) !==
        JSON.stringify(
          analysis.cacheInput.purpose && analysis.status === "successful"
            ? "verified-analysis"
            : undefined,
        )
      )
        ctx.addIssue({ code: "custom", message: "foreign analysis terminal purpose" })
      if (preparation) {
        const projection = bookMapProjection(preparation)
        if (
          JSON.stringify([analysis.claims, analysis.concepts, analysis.qualifications]) !==
          JSON.stringify([projection.claims, projection.concepts, projection.qualifications])
        )
          ctx.addIssue({
            code: "custom",
            message: "downstream findings differ from complete maps and synthesis",
          })
      }
      if (
        !preparation ||
        preparation.capacityId !== analysis.cacheInput.processing?.capacityId ||
        preparation.preprocessingVersion !== analysis.cacheInput.processing.preprocessingVersion ||
        preparation.synthesisVersion !== analysis.cacheInput.processing.synthesisVersion ||
        (analysis.status === "successful" &&
          (preparation.phase !== "complete" ||
            preparation.parts.some((part) => part.status !== "complete") ||
            preparation.maps.length !== preparation.parts.length ||
            preparation.maps.some((map) => !map.complete) ||
            !preparation.synthesis?.complete ||
            (preparation.synthesisVersion !== BATCHED_VERIFICATION_VERSION &&
              preparation.verification.length !== preparation.maps.length + 1)))
      )
        ctx.addIssue({
          code: "custom",
          message: "whole-book preparation is incomplete or incompatible",
        })
    }
    if (analysis.cacheKey !== analysisCacheKey(analysis.cacheInput))
      ctx.addIssue({ code: "custom", message: "analysis cache key mismatch" })
    if (
      new Set(analysis.chapters.map((chapter) => chapter.resourcePath)).size !==
      analysis.chapters.length
    )
      ctx.addIssue({ code: "custom", message: "duplicate analyzed chapter" })
    const approved = analysis.cacheInput.scope.selected
    if (
      analysis.chapters.some(
        (chapter) =>
          !approved.some(
            (resource) =>
              resource.resourcePath === chapter.resourcePath &&
              chapter.blockIds.every((block) => resource.blockIds.includes(block)),
          ),
      )
    )
      ctx.addIssue({ code: "custom", message: "analysis exceeds approved scope" })
    if (
      analysis.status === "successful" &&
      !approved.every((resource) =>
        analysis.chapters.some(
          (chapter) =>
            chapter.resourcePath === resource.resourcePath &&
            chapter.status === "complete" &&
            resource.blockIds.length === chapter.blockIds.length &&
            resource.blockIds.every((block) => chapter.blockIds.includes(block)),
        ),
      )
    )
      ctx.addIssue({ code: "custom", message: "analysis scope is incomplete" })
    for (const finding of [...analysis.claims, ...analysis.concepts, ...analysis.qualifications]) {
      if (
        finding.sources.some(
          (span) =>
            span.editionId !== analysis.editionId ||
            span.normalizationRevisionId !== analysis.cacheInput.normalizationRevisionId ||
            !approved.some(
              (resource) =>
                resource.resourcePath === span.resourcePath &&
                resource.blockIds.includes(span.blockId),
            ),
        )
      )
        ctx.addIssue({ code: "custom", message: "analysis source lineage mismatch" })
    }
  })
  .readonly()
export type AnalysisRevision = z.infer<typeof AnalysisRevision>
export const BookMap = AnalysisRevision
