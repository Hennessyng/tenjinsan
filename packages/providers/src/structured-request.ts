import type { StructuredRequest } from "./adapter.ts"

export function structuredRequest(input: {
  readonly model: StructuredRequest["model"]
  readonly settings: StructuredRequest["settings"]
  readonly instruction: string
  readonly blocks: readonly unknown[]
  readonly schema: StructuredRequest["schema"]
  readonly signal: AbortSignal
}): StructuredRequest {
  return {
    model: input.model,
    settings: input.settings,
    prompt: `${input.instruction}\n${JSON.stringify(input.blocks)}`,
    schema: input.schema,
    signal: input.signal,
  }
}
