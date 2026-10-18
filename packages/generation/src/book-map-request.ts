import type { NormalizationRevision, StudySetupRevision } from "@reading-studio/contracts"
import {
  MAX_PROVIDER_REQUEST_BYTES,
  ProviderAdapter,
  ProviderError,
  reviewedSourceBlocks,
  type StructuredRequest,
  sourceInput,
  structuredRequest,
} from "@reading-studio/providers"
import { z } from "zod"
import {
  BlockAnalysis,
  type BookMapDefinition,
  bookMapDefinition,
  type SourceWindow,
} from "./book-map-output.ts"

export function bookMapRequest(
  setup: StudySetupRevision,
  normalization: NormalizationRevision,
  window: SourceWindow,
): StructuredRequest {
  const blocks = sourceInput(reviewedSourceBlocks(setup, normalization), window)
  return structuredRequest({
    model: setup.analysis.model,
    settings: setup.analysis.settings,
    instruction: bookMapDefinition.instruction,
    blocks,
    schema: z.toJSONSchema(BlockAnalysis, { reused: "ref" }),
    signal: new AbortController().signal,
  })
}

export async function bookMapRequestsFit(input: {
  readonly setup: StudySetupRevision
  readonly normalization: NormalizationRevision
  readonly windows: readonly SourceWindow[]
  readonly definition?: BookMapDefinition
}): Promise<boolean> {
  const adapter = new ProviderAdapter({
    provider: input.setup.analysis.provider,
    apiKey: "local-sizing-only",
  })
  for (const window of input.windows) {
    const request = bookMapRequest(input.setup, input.normalization, window)
    const instruction = input.definition?.instruction ?? bookMapDefinition.instruction
    const prompt = `${instruction}\n${request.prompt.slice(bookMapDefinition.instruction.length + 1)}`
    try {
      const bytes = await adapter.measure({ ...request, prompt })
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_PROVIDER_REQUEST_BYTES)
        return false
    } catch (error) {
      if (error instanceof ProviderError && error.code === "input-limit") return false
      throw error
    }
  }
  return true
}
