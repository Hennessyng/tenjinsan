import { RunBudget, type StudySetupRevision } from "@reading-studio/contracts"
import { MAX_PROVIDER_REQUEST_BYTES, type StructuredRequest } from "./adapter.ts"
import type { authorizeSource } from "./authorization.ts"
import { ProviderError } from "./catalog.ts"
import type { StructuredStage } from "./execution-contracts.ts"
import { requestFitsCapacity, requireRouteCapacity } from "./request-capacity.ts"
import { bookSourcePayload, sourceInput, sourceRangesInput } from "./source-input.ts"
import { structuredRequest } from "./structured-request.ts"

const defaultBudget = RunBudget.parse({})
export function withinDefaultRunBudget(budget: RunBudget) {
  return (
    budget.maxCalls <= defaultBudget.maxCalls &&
    budget.maxSourceCharacters <= defaultBudget.maxSourceCharacters &&
    budget.maxOutputTokens <= defaultBudget.maxOutputTokens
  )
}
export async function prepareStageRequest(input: {
  readonly setup: StudySetupRevision
  readonly stage: StructuredStage
  readonly approved: ReturnType<typeof authorizeSource>["blocks"]
  readonly request: Omit<Parameters<typeof structuredRequest>[0], "blocks">
  readonly measure: (request: StructuredRequest) => Promise<number>
  readonly sourceCharacterLimit: number
}) {
  const { stage, setup } = input
  const whole = setup.analysis.analysisPromptVersion === "whole-book-2"
  const capacity = whole ? requireRouteCapacity(setup, stage.capacity) : undefined
  const selected = () =>
    stage.sourceRanges
      ? sourceRangesInput(input.approved, stage.sourceRanges)
      : sourceInput(input.approved, stage.sourceWindow)
  let blocks = stage.includeOriginalWhenFits ? input.approved : selected()
  const build = () =>
    structuredRequest({
      ...input.request,
      blocks: [...(stage.derivedData ?? []), ...(whole ? bookSourcePayload(blocks) : blocks)],
    })
  let request = build()
  const fits = async () => {
    const bytes = await input.measure(request)
    return capacity
      ? requestFitsCapacity(request, bytes, capacity)
      : bytes <= MAX_PROVIDER_REQUEST_BYTES
  }
  let strategy: "complete-maps" | "complete-maps-and-original" | undefined
  if (stage.includeOriginalWhenFits) {
    strategy = "complete-maps-and-original"
    if (!(await fits())) {
      blocks = selected()
      request = build()
      strategy = "complete-maps"
    }
  }
  if (!(await fits())) throw new ProviderError(whole ? "capacity-limit" : "input-limit")
  if (blocks.reduce((total, block) => total + block.text.length, 0) > input.sourceCharacterLimit)
    throw new ProviderError("input-limit")
  if (blocks.length === 0 && (stage.derivedData?.length ?? 0) === 0)
    throw new ProviderError("unauthorized")
  return { request, blocks, strategy }
}
