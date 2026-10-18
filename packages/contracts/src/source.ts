import { z } from "zod"
import {
  BlockId,
  Digest,
  EditionId,
  Natural,
  NormalizationRevisionId,
  ResourcePath,
  Text,
  uniqueItems,
} from "./primitives.ts"

export const BookEdition = z
  .strictObject({
    id: EditionId,
    originalHash: Digest,
    originalBlobHash: Digest,
    title: Text,
    format: z.enum(["epub", "docx", "txt", "pdf"]).optional(),
  })
  .refine(
    (edition) => edition.originalHash === edition.originalBlobHash,
    "original content hash mismatch",
  )
  .readonly()
export type BookEdition = z.infer<typeof BookEdition>

export const FormatLocator = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("txt"),
      startLine: z.number().int().positive(),
      start: Natural,
    }),
    z.strictObject({ kind: z.literal("pdf"), page: z.number().int().positive() }),
    z.strictObject({
      kind: z.literal("docx"),
      part: ResourcePath,
      paragraph: z.number().int().positive(),
    }),
  ])
  .readonly()

export const SourceBlock = z
  .strictObject({
    id: BlockId,
    text: z.string().max(100_000),
    originalFragment: Text.optional(),
    pageLabel: Text.optional(),
    heading: z.number().int().min(1).max(6).optional(),
    structure: z.enum(["paragraph", "list-item", "table-cell"]).optional(),
    locator: FormatLocator.optional(),
  })
  .readonly()
const Resource = z
  .discriminatedUnion("status", [
    z.strictObject({
      path: ResourcePath,
      role: z.enum(["main-chapter", "supplementary"]),
      status: z.literal("included"),
      blocks: uniqueItems(SourceBlock).refine((blocks) => blocks.length > 0),
    }),
    z.strictObject({
      path: ResourcePath,
      role: z.enum(["main-chapter", "supplementary"]),
      status: z.literal("excluded"),
      reason: Text,
    }),
  ])
  .readonly()
export const NormalizationRevision = z
  .strictObject({
    id: NormalizationRevisionId,
    editionId: EditionId,
    editionHash: Digest,
    parserVersion: Text,
    normalizerVersion: Text,
    coverage: z.enum(["complete", "partial"]),
    resources: z.array(Resource).min(1).readonly(),
    omissions: z
      .array(z.strictObject({ path: ResourcePath, reason: Text }).readonly())
      .readonly()
      .optional(),
  })
  .superRefine((value, ctx) => {
    const paths = value.resources.map((resource) => resource.path)
    const blocks = value.resources.flatMap((resource) =>
      resource.status === "included" ? resource.blocks.map((block) => block.id) : [],
    )
    if (new Set(paths).size !== paths.length || new Set(blocks).size !== blocks.length)
      ctx.addIssue({ code: "custom", message: "duplicate source identity" })
    if (
      value.coverage === "complete" &&
      (value.resources.some((resource) => resource.status === "excluded") ||
        (value.omissions?.length ?? 0) > 0)
    )
      ctx.addIssue({ code: "custom", message: "excluded resources require partial coverage" })
  })
  .readonly()
export type NormalizationRevision = z.infer<typeof NormalizationRevision>

const InputRange = z
  .strictObject({ resourcePath: ResourcePath, blockId: BlockId, start: Natural, end: Natural })
  .readonly()
export const SourcePreparationFailure = z
  .strictObject({
    error: z.literal("scope-limit"),
    coverage: z
      .strictObject({
        transmission: z.literal("not-sent"),
        reason: z.enum(["analysis-window-limit", "empty-text-scope", "request-byte-limit"]),
        requiredWindows: Natural,
        maxWindows: z.literal(128),
        unsentRanges: z
          .array(
            z
              .strictObject({
                resourcePath: ResourcePath,
                blockId: BlockId,
                start: Natural,
                end: Natural,
                locator: FormatLocator.optional(),
                pageLabel: Text.optional(),
                originalFragment: Text.optional(),
              })
              .readonly(),
          )
          .readonly(),
      })
      .readonly(),
  })
  .readonly()
export type SourcePreparationFailure = z.infer<typeof SourcePreparationFailure>
export const InputCoverage = z
  .strictObject({
    extraction: z.enum(["complete", "partial"]),
    transmission: z.enum(["reviewed-scope", "window-only"]),
    processing: z.literal("not-established"),
    requestHash: Digest,
    ranges: z.array(InputRange).readonly(),
    reviewedRanges: z.array(InputRange).readonly(),
    untransmittedRanges: z.array(InputRange).readonly().optional(),
    omissions: z.array(z.strictObject({ path: ResourcePath, reason: Text }).readonly()).readonly(),
  })
  .readonly()

export const SourceSpan = z
  .strictObject({
    editionId: EditionId,
    normalizationRevisionId: NormalizationRevisionId,
    resourcePath: ResourcePath,
    blockId: BlockId,
    start: Natural,
    end: Natural,
    originalFragment: Text,
    pageLabel: Text.optional(),
  })
  .refine((span) => span.end > span.start, "offsets must form a nonempty range")
  .readonly()
export type SourceSpan = z.infer<typeof SourceSpan>

export const LocatedSourceSpan = z
  .strictObject({ normalization: NormalizationRevision, span: SourceSpan })
  .superRefine(({ normalization, span }, ctx) => {
    const resource = normalization.resources.find((item) => item.path === span.resourcePath)
    const block =
      resource?.status === "included"
        ? resource.blocks.find((item) => item.id === span.blockId)
        : undefined
    if (
      span.editionId !== normalization.editionId ||
      span.normalizationRevisionId !== normalization.id ||
      !block ||
      span.end > block.text.length
    )
      ctx.addIssue({ code: "custom", message: "source locator does not resolve in revision" })
  })
  .readonly()
