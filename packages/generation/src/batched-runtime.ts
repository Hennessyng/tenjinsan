import {
  type BatchedVerificationManifest,
  BatchedVerificationState,
  BookSynthesis,
  ChapterPartMap,
  contentDigest,
  validatedBatchedSetupSources,
} from "@reading-studio/contracts"
import {
  bookSourcePayload,
  ProviderError,
  sourceRangesInput,
  structuredRequest,
} from "@reading-studio/providers"
import { z } from "zod"

export function batchHasBlockingReceipt(state: BatchedVerificationState) {
  return state.receipts.some((receipt) => {
    const target = state.manifest?.targets.find((target) => target.id === receipt.targetId)
    return (
      !target ||
      receipt.output.mapCoverage?.verdict === "material-omission" ||
      receipt.output.mapCoverage?.verdict === "uncertain" ||
      receipt.output.decisions.some(
        (decision) =>
          decision.verdict !== "supported" &&
          !(target.kind === "window-findings" && decision.verdict === "not-addressed"),
      )
    )
  })
}

import { batchedOutputSchema, batchedRuntimeStage } from "./batched-runtime-stage.ts"
import { planBatchedVerification } from "./batched-verification-packing.ts"
import { batchRequestFits } from "./batched-verification-request.ts"
import type { WholeBookContext } from "./whole-book-context.ts"

export function prepareBatchedChecks(
  context: WholeBookContext,
  materialized: {
    readonly maps: readonly ChapterPartMap[]
    readonly synthesis: BookSynthesis | null
  },
) {
  const outputs = {
    maps: ChapterPartMap.array().parse(materialized.maps),
    synthesis: materialized.synthesis ? BookSynthesis.parse(materialized.synthesis) : null,
  }
  const reserve = context.setup.batchedVerificationReserve
  if (!reserve) throw new ProviderError("route-re-review-required")
  const empty = {
    setupId: context.setup.id,
    grantId: context.grantId,
    reserve,
    manifest: null,
    manifestHash: null,
    receipts: [],
  }
  if (
    !outputs.synthesis?.complete ||
    outputs.maps.length !== reserve.windowHashes.length ||
    outputs.maps.some((map) => !map.complete)
  )
    return { state: BatchedVerificationState.parse(empty), refused: null }
  const previous = context.authority.storage.workflow.findBatchedAnalysis(
    context.key,
    context.setup.id,
    context.grantId,
  )?.wholeBook?.batched
  let manifest: BatchedVerificationManifest
  if (previous?.manifest) {
    manifest = previous.manifest
    if (
      JSON.stringify(manifest.maps) !== JSON.stringify(outputs.maps) ||
      JSON.stringify(manifest.synthesis) !== JSON.stringify(outputs.synthesis)
    )
      throw new ProviderError("analysis-incomplete")
  } else {
    const planned = planBatchedVerification(
      { setup: context.setup, normalization: context.normalization, capacity: context.capacity },
      { reserve, windows: validatedBatchedSetupSources(context.setup, context.normalization) },
      { maps: outputs.maps, synthesis: outputs.synthesis },
    )
    if (planned.kind !== "ready")
      return { state: BatchedVerificationState.parse(empty), refused: planned.reason }
    manifest = planned.manifest
  }
  for (const [index, target] of manifest.targets.entries()) {
    if (context.job(`batch-${target.id}`, index)) continue
    const stage = batchedRuntimeStage(context, manifest, index)
    const request = structuredRequest({
      model: context.setup.analysis.model,
      settings: context.setup.analysis.settings,
      instruction: stage.instruction,
      schema: z.toJSONSchema(stage.schema, { reused: "ref" }),
      blocks: [
        ...(stage.derivedData ?? []),
        ...bookSourcePayload(sourceRangesInput(context.approved, stage.sourceRanges ?? [])),
      ],
      signal: new AbortController().signal,
    })
    if (
      !batchRequestFits(
        { setup: context.setup, normalization: context.normalization, capacity: context.capacity },
        request,
        target.originals.reduce((sum, span) => sum + span.originalFragment.length, 0),
      )
    )
      return { state: BatchedVerificationState.parse(empty), refused: "capacity-limit" }
  }
  for (const [index, target] of manifest.targets.entries())
    context.enqueue(`batch-${target.id}`, index, manifest)
  const hash = contentDigest(JSON.stringify(manifest))
  const receipts = manifest.targets.flatMap((target, index) => {
    const result = context.output(`batch-${target.id}`, batchedOutputSchema(target), index)
    if (!result) return []
    if (
      JSON.stringify(result.batchTarget) !== JSON.stringify(target) ||
      result.batchManifestHash !== hash ||
      JSON.stringify(result.inputCoverage?.ranges) !==
        JSON.stringify(
          target.originals.map(({ resourcePath, blockId, start, end }) => ({
            resourcePath,
            blockId,
            start,
            end,
          })),
        )
    )
      throw new ProviderError("analysis-incomplete")
    return [{ targetId: target.id, output: result.data }]
  })
  return {
    state: BatchedVerificationState.parse({ ...empty, manifest, manifestHash: hash, receipts }),
    refused: null,
  }
}
