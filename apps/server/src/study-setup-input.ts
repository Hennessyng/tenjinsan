import {
  type NormalizationRevision,
  Provider,
  type SourceScope,
  wholeBookScope,
} from "@reading-studio/contracts"
import { z } from "zod"

/**
 * A new setup chooses only a provider and model. Source scope is never a client choice:
 * the one tolerated legacy field is the literal that already names the enforced behavior.
 * Any subset, main-chapter or chapter-list input is rejected by the strict schema.
 */
export const Draft = z.strictObject({
  provider: Provider.exclude(["openai"]),
  model: z.string().min(1).optional(),
  scope: z.literal("whole-document").optional(),
})

export function selectSourceScope(
  normalization: NormalizationRevision,
):
  | { readonly kind: "error"; readonly message: "No extracted text" }
  | { readonly kind: "ready"; readonly scope: z.infer<typeof SourceScope> } {
  const scope = wholeBookScope(normalization)
  return scope ? { kind: "ready", scope } : { kind: "error", message: "No extracted text" }
}
