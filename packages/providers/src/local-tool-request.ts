import type { LocalSubscriptionProvider } from "@reading-studio/contracts"
import type { StructuredRequest } from "./adapter.ts"
import { codexOutputFormat } from "./local-codex-schema.ts"

export function localToolInput(provider: LocalSubscriptionProvider, request: StructuredRequest) {
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
export function localRequestBytes(
  provider: LocalSubscriptionProvider,
  request: StructuredRequest,
): number {
  return Buffer.byteLength(JSON.stringify(localToolInput(provider, request)), "utf8") + 2048
}
function assertNever(value: never): never {
  throw new TypeError(`Unknown provider: ${value}`)
}
