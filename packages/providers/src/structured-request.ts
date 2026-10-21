import type { Settings } from "./catalog.ts"
import type { SchemaRepair } from "./schema-repair.ts"

export type StructuredRequest = {
  readonly model: string
  readonly settings: Settings
  readonly prompt: string
  readonly schema: Record<string, unknown>
  readonly signal: AbortSignal
  readonly schemaRepair?: SchemaRepair
}

export function structuredRequest(input: {
  readonly model: StructuredRequest["model"]
  readonly settings: StructuredRequest["settings"]
  readonly instruction: string
  readonly blocks: readonly unknown[]
  readonly schema: StructuredRequest["schema"]
  readonly signal: AbortSignal
  readonly schemaRepair?: StructuredRequest["schemaRepair"]
}): StructuredRequest {
  return {
    model: input.model,
    settings: input.settings,
    prompt: `${input.schemaRepair ? `${JSON.stringify({ schemaRepair: input.schemaRepair })}\n` : ""}${input.instruction}\n${JSON.stringify(input.blocks)}`,
    schema: input.schema,
    signal: input.signal,
    ...(input.schemaRepair ? { schemaRepair: input.schemaRepair } : {}),
  }
}
