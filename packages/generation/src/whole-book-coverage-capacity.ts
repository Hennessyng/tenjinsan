import { LocalSubscriptionProvider } from "@reading-studio/contracts"
import {
  bookSourcePayload,
  legacyLocalReservationBytes as localRequestBytes,
  ProviderError,
  requestFitsCapacity,
  sourceRangesInput,
  structuredRequest,
} from "@reading-studio/providers"
import { z } from "zod"
import type { WholeBookContext } from "./whole-book-context.ts"
import { coverageVerificationStage } from "./whole-book-coverage.ts"

export function requireCoverageCapacity(context: WholeBookContext, indexes: readonly number[]) {
  const provider = LocalSubscriptionProvider.safeParse(context.setup.analysis.provider)
  if (!provider.success) throw new ProviderError("unsupported-version")
  for (const index of indexes) {
    const stage = coverageVerificationStage(context, index)
    const blocks = sourceRangesInput(context.approved, stage.sourceRanges ?? [])
    const request = structuredRequest({
      model: context.setup.analysis.model,
      settings: context.setup.analysis.settings,
      instruction: stage.instruction,
      schema: stage.wireSchema ?? z.toJSONSchema(stage.schema, { reused: "ref" }),
      blocks: [...(stage.derivedData ?? []), ...bookSourcePayload(blocks)],
      signal: new AbortController().signal,
    })
    if (
      blocks.reduce((total, block) => total + block.text.length, 0) > 32000 ||
      !requestFitsCapacity(request, localRequestBytes(provider.data, request), context.capacity)
    )
      throw new ProviderError("capacity-limit")
  }
}
