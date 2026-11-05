import {
  LocalSubscriptionProvider,
  type NormalizationRevision,
  type StudySetupRevision,
} from "@reading-studio/contracts"
import {
  bookSourcePayload,
  legacyLocalReservationBytes as localRequestBytes,
  MAX_PROVIDER_REQUEST_BYTES,
  ProviderAdapter,
  ProviderError,
  requestFitsCapacity,
  requireRouteCapacity,
  reviewedSourceBlocks,
  type StructuredRequest,
  sourceInput,
  structuredRequest,
  type VerifiedRouteCapacity,
} from "@reading-studio/providers"
import { z } from "zod"
import {
  BlockAnalysis,
  type BookMapDefinition,
  bookMapDefinition,
  type SourceWindow,
} from "./book-map-output.ts"
import { chapterWireSchema, wholeBookInstructions } from "./whole-book-output.ts"
import { groupMetadata, WHOLE_BOOK_VERSION, wholeBookGroups } from "./whole-book-scope.ts"

export function bookMapRequest(
  setup: StudySetupRevision,
  normalization: NormalizationRevision,
  window: SourceWindow,
): StructuredRequest {
  const blocks = sourceInput(reviewedSourceBlocks(setup, normalization), window)
  const whole = setup.analysis.analysisPromptVersion === WHOLE_BOOK_VERSION
  const group = whole
    ? wholeBookGroups(setup, normalization).find((group) => group.id === window.groupId)
    : undefined
  if (whole && !group) throw new ProviderError("unauthorized")
  return structuredRequest({
    model: setup.analysis.model,
    settings: setup.analysis.settings,
    instruction: whole ? wholeBookInstructions.map : bookMapDefinition.instruction,
    blocks: whole
      ? [
          {
            kind: "chapter-map",
            groupId: window.groupId,
            ...(group ? { group: groupMetadata(group) } : {}),
          },
          ...bookSourcePayload(blocks),
        ]
      : blocks,
    schema: whole ? chapterWireSchema : z.toJSONSchema(BlockAnalysis, { reused: "ref" }),
    signal: new AbortController().signal,
  })
}

export async function bookMapRequestsFit(input: {
  readonly setup: StudySetupRevision
  readonly normalization: NormalizationRevision
  readonly windows: readonly SourceWindow[]
  readonly definition?: BookMapDefinition
  readonly capacity?: VerifiedRouteCapacity
}): Promise<boolean> {
  const whole = input.setup.analysis.analysisPromptVersion === WHOLE_BOOK_VERSION
  if (whole && input.definition) return false
  let capacity: VerifiedRouteCapacity | undefined
  if (whole) {
    try {
      capacity = requireRouteCapacity(input.setup, input.capacity)
    } catch (error) {
      if (error instanceof ProviderError) return false
      throw error
    }
  }
  const local = LocalSubscriptionProvider.safeParse(input.setup.analysis.provider)
  const adapter = local.success
    ? null
    : new ProviderAdapter({
        provider: input.setup.analysis.provider,
        apiKey: "local-sizing-only",
      })
  for (const window of input.windows) {
    const request = bookMapRequest(input.setup, input.normalization, window)
    const originalInstruction = whole ? wholeBookInstructions.map : bookMapDefinition.instruction
    const instruction = input.definition?.instruction ?? originalInstruction
    const prompt = `${instruction}\n${request.prompt.slice(originalInstruction.length + 1)}`
    try {
      const bytes = local.success
        ? localRequestBytes(local.data, { ...request, prompt })
        : await adapter?.measure({ ...request, prompt })
      if (bytes === undefined) return false
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_PROVIDER_REQUEST_BYTES)
        return false
      if (capacity && !requestFitsCapacity({ ...request, prompt }, bytes, capacity)) return false
    } catch (error) {
      if (error instanceof ProviderError && error.code === "input-limit") return false
      throw error
    }
  }
  return true
}
