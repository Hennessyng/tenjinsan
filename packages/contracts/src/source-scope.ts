import { z } from "zod"
import { BlockId, ResourcePath, uniqueValues } from "./primitives.ts"
import type { NormalizationRevision } from "./source.ts"

const ScopeResource = z
  .strictObject({
    resourcePath: ResourcePath,
    blockIds: uniqueValues(BlockId).refine((ids) => ids.length > 0),
  })
  .readonly()
export const SourceScope = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("whole-document"),
      selected: z.array(ScopeResource).min(1).readonly(),
      exclusions: z.tuple([]).readonly(),
    }),
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

/**
 * The only scope a new setup may use: every included resource and every block of it,
 * main chapters and supplementary parts alike. Returns null when the extraction holds
 * no text at all, so an empty extraction can never become a study. Resources that were
 * omitted during extraction stay visible on the normalization, never in this scope.
 */
export function wholeBookScope(
  normalization: NormalizationRevision,
): z.infer<typeof SourceScope> | null {
  const included = normalization.resources.flatMap((resource) =>
    resource.status === "included" ? [resource] : [],
  )
  if (!included.some((resource) => resource.blocks.some((block) => block.text.length > 0)))
    return null
  return SourceScope.parse({
    kind: "whole-document",
    selected: included.map((resource) => ({
      resourcePath: resource.path,
      blockIds: resource.blocks.map((block) => block.id),
    })),
    exclusions: [],
  })
}
