import { type NormalizationRevision, SourceScope } from "@reading-studio/contracts"
import { z } from "zod"

export const Draft = z.strictObject({
  provider: z.enum(["openrouter", "codex", "anthropic"]),
  model: z.string().min(1).optional(),
  scope: z.enum(["whole-document", "all-main-chapters", "partial"]),
  chapters: z.union([z.string(), z.array(z.string())]).optional(),
})

export function selectSourceScope(
  normalization: NormalizationRevision,
  choices: z.infer<typeof Draft>,
):
  | {
      readonly kind: "error"
      readonly message: "Invalid source scope" | "Select available chapters explicitly"
    }
  | { readonly kind: "ready"; readonly scope: z.infer<typeof SourceScope> } {
  const paths =
    choices.chapters === undefined
      ? []
      : typeof choices.chapters === "string"
        ? [choices.chapters]
        : choices.chapters
  const resources = normalization.resources.filter((resource) => resource.status === "included")
  if (
    paths.some((path) => !resources.some((resource) => resource.path === path)) ||
    new Set(paths).size !== paths.length
  )
    return { kind: "error", message: "Invalid source scope" }
  let selected: typeof resources
  switch (choices.scope) {
    case "whole-document":
      selected = resources
      break
    case "all-main-chapters":
      if (
        normalization.resources.some(
          (resource) => resource.role === "main-chapter" && resource.status === "excluded",
        )
      )
        return { kind: "error", message: "Select available chapters explicitly" }
      selected = resources.filter((resource) => resource.role === "main-chapter")
      break
    case "partial":
      selected = resources.filter((resource) => paths.includes(resource.path))
      break
    default:
      return assertNever(choices.scope)
  }
  if (!selected.length) return { kind: "error", message: "Select available chapters explicitly" }
  const project = (resource: (typeof resources)[number]) => ({
    resourcePath: resource.path,
    blockIds: resource.blocks.map((block) => block.id),
  })
  return {
    kind: "ready",
    scope: SourceScope.parse({
      kind: choices.scope,
      selected: selected.map(project),
      exclusions:
        choices.scope === "partial"
          ? resources.filter((resource) => !selected.includes(resource)).map(project)
          : [],
    }),
  }
}
function assertNever(value: never): never {
  throw new TypeError(`Unexpected scope: ${value}`)
}
