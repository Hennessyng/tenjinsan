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
  })
  .refine(
    (edition) => edition.originalHash === edition.originalBlobHash,
    "original content hash mismatch",
  )
  .readonly()
export type BookEdition = z.infer<typeof BookEdition>

export const SourceBlock = z
  .strictObject({
    id: BlockId,
    text: z.string().max(100_000),
    originalFragment: Text.optional(),
    pageLabel: Text.optional(),
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
      value.resources.some((resource) => resource.status === "excluded")
    )
      ctx.addIssue({ code: "custom", message: "excluded resources require partial coverage" })
  })
  .readonly()
export type NormalizationRevision = z.infer<typeof NormalizationRevision>

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
