import { z } from "zod"
import { assertNever } from "./primitives.ts"
import type { LocalSubscriptionProvider } from "./subscriptions.ts"

export const CodexOutputFormat = z.enum(["native-json-schema", "app-validated-json"])
export type CodexOutputFormat = z.infer<typeof CodexOutputFormat>
function hasOptionalProperties(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasOptionalProperties)
  const node = z.record(z.string(), z.unknown()).safeParse(value)
  if (!node.success) return false
  const properties = z.record(z.string(), z.unknown()).safeParse(node.data["properties"])
  const required = z.array(z.string()).safeParse(node.data["required"])
  if (
    properties.success &&
    Object.keys(properties.data).some((key) => !required.success || !required.data.includes(key))
  )
    return true
  return Object.values(node.data).some(hasOptionalProperties)
}
export function codexOutputFormat(schema: Record<string, unknown>): CodexOutputFormat {
  return hasOptionalProperties(schema) ? "app-validated-json" : "native-json-schema"
}
export function localToolInput(
  provider: LocalSubscriptionProvider,
  request: Readonly<{ model: string; prompt: string; schema: Record<string, unknown> }>,
) {
  switch (provider) {
    case "chatgpt-subscription":
      if (codexOutputFormat(request.schema) === "app-validated-json")
        return {
          model: request.model,
          input: [
            {
              type: "text",
              text: `${JSON.stringify({ responseSchema: request.schema })}\n${request.prompt}`,
              text_elements: [],
            },
          ],
          environments: [],
        }
      return {
        model: request.model,
        input: [{ type: "text", text: request.prompt, text_elements: [] }],
        outputSchema: request.schema,
        environments: [],
      }
    case "grok-subscription":
      return {
        prompt: [
          {
            type: "text",
            text: `Return only JSON satisfying this schema: ${JSON.stringify(request.schema)}\n${request.prompt}`,
          },
        ],
      }
    default:
      return assertNever(provider)
  }
}
export function structuredPrompt(
  input: Readonly<{ instruction: string; blocks: readonly unknown[]; schemaRepair?: unknown }>,
) {
  return `${input.schemaRepair ? `${JSON.stringify({ schemaRepair: input.schemaRepair })}\n` : ""}${input.instruction}\n${JSON.stringify(input.blocks)}`
}
