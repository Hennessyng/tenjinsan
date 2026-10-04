import { z } from "zod"
import { contentDigest } from "./identity.ts"
import {
  AnalysisRevisionId,
  BlockId,
  ContentId,
  Digest,
  EditionId,
  GrantId,
  InstallationId,
  NormalizationRevisionId,
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

export const ModelSettings = z
  .strictObject({
    temperature: z.number().min(0).max(2),
    topP: z.number().min(0).max(1),
    maxOutputTokens: z.number().int().positive().max(1_000_000),
    seed: z.number().int().nullable(),
    reasoningEffort: z.enum(["default", "low", "medium", "high"]),
  })
  .readonly()
export const Provider = z.enum(["openai", "anthropic", "openrouter", "codex"])
const ScopeResource = z
  .strictObject({
    resourcePath: ResourcePath,
    blockIds: uniqueValues(BlockId).refine((ids) => ids.length > 0),
  })
  .readonly()
export const SourceScope = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("all-main-chapters"),
      selected: z.array(ScopeResource).min(1).readonly(),
      exclusions: z.tuple([]).readonly(),
    }),
    z.strictObject({
      kind: z.literal("partial"),
      selected: z.array(ScopeResource).min(1).readonly(),
      exclusions: z.array(ScopeResource).readonly(),
    }),
  ])
  .superRefine((scope, ctx) => {
    for (const group of [scope.selected, scope.exclusions]) {
      if (new Set(group.map((resource) => resource.resourcePath)).size !== group.length)
        ctx.addIssue({ code: "custom", message: "duplicate scope resource" })
      const blocks = group.flatMap((resource) => resource.blockIds)
      if (new Set(blocks).size !== blocks.length)
        ctx.addIssue({ code: "custom", message: "duplicate scope block" })
    }
    const selected = new Set(scope.selected.flatMap((resource) => resource.blockIds))
    if (scope.exclusions.some((resource) => resource.blockIds.some((block) => selected.has(block))))
      ctx.addIssue({ code: "custom", message: "selected block is excluded" })
  })
  .readonly()
export const AnalysisCacheInput = z
  .strictObject({
    editionHash: Digest,
    normalizationRevisionId: NormalizationRevisionId,
    scope: SourceScope,
    provider: Provider,
    model: Text,
    analysisPromptVersion: Text,
    analysisSchemaVersion: Text,
    settings: ModelSettings,
  })
  .readonly()
export type AnalysisCacheInput = z.infer<typeof AnalysisCacheInput>
export function analysisCacheKey(input: AnalysisCacheInput): Digest {
  return contentDigest(
    JSON.stringify([
      input.editionHash,
      input.normalizationRevisionId,
      input.scope.kind,
      input.scope.selected.map((resource) => [resource.resourcePath, resource.blockIds]),
      input.scope.exclusions.map((resource) => [resource.resourcePath, resource.blockIds]),
      input.provider,
      input.model,
      input.analysisPromptVersion,
      input.analysisSchemaVersion,
      input.settings.temperature,
      input.settings.topP,
      input.settings.maxOutputTokens,
      input.settings.seed,
      input.settings.reasoningEffort,
    ]),
  )
}
export const StudySetupRevision = z
  .strictObject({
    id: SetupRevisionId,
    studyId: StudyId,
    editionId: EditionId,
    analysis: AnalysisCacheInput,
    generation: z
      .strictObject({ promptVersion: Text, schemaVersion: Text, settings: ModelSettings })
      .readonly(),
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
  })
  .superRefine((analysis, ctx) => {
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
