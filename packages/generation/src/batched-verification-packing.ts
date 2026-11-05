import {
  BatchedVerificationManifest,
  BatchedVerificationReserve,
  BookSynthesis,
  baseAnalysisCacheKey,
  ChapterPartMap,
  chapterFindings,
  contentDigest,
  type MappedFinding,
  synthesisFindings,
  type WindowOriginal,
} from "@reading-studio/contracts"
import {
  legacyLocalReservationBytes as localRequestBytes,
  ProviderError,
  requireRouteCapacity,
} from "@reading-studio/providers"
import {
  type BatchExecution,
  batchRequestFits,
  batchTarget,
  batchVerificationRequest,
} from "./batched-verification-request.ts"
import {
  batchOriginals,
  citationOriginals,
  validBatchPartition,
} from "./batched-verification-source.ts"

export function planBatchedVerification(
  execution: BatchExecution,
  approved: {
    readonly reserve: BatchedVerificationReserve
    readonly windows: readonly (readonly WindowOriginal[])[]
  },
  materialized: { readonly maps: readonly ChapterPartMap[]; readonly synthesis: BookSynthesis },
) {
  const outputs = {
    maps: ChapterPartMap.array().parse(materialized.maps),
    synthesis: BookSynthesis.parse(materialized.synthesis),
  }
  const reserve = BatchedVerificationReserve.parse(approved.reserve),
    windows = approved.windows
  requireRouteCapacity(execution.setup, execution.capacity)
  const refuse = (reason: string) => ({ kind: "limited" as const, reason })
  if (
    execution.capacity.id !== reserve.capacityId ||
    baseAnalysisCacheKey(execution.setup.analysis) !== reserve.analysisKey ||
    contentDigest(JSON.stringify(batchOriginals(execution))) !== reserve.sourceHash ||
    !validBatchPartition(batchOriginals(execution), windows) ||
    JSON.stringify(windows.map((window) => contentDigest(JSON.stringify(window)))) !==
      JSON.stringify(reserve.windowHashes)
  )
    return refuse("foreign-approved-plan")
  if (
    outputs.maps.length !== windows.length ||
    outputs.maps.some((map) => !map.complete) ||
    !outputs.synthesis.complete
  )
    return refuse("incomplete-materialization")
  if (
    outputs.maps.some(
      (map, index) => map.groupId !== execution.setup.analysis.processing?.plan?.[index]?.groupId,
    )
  )
    return refuse("foreign-map-window-plan")
  const roots = {
    mapsHash: contentDigest(JSON.stringify(outputs.maps)),
    synthesisHash: contentDigest(JSON.stringify(outputs.synthesis)),
  }
  if (new Set(outputs.maps.map((map) => map.partId)).size !== outputs.maps.length)
    return refuse("invalid-map-identity")
  const global = synthesisFindings(outputs.synthesis)
  if (global.length === 0 || new Set(global.map((finding) => finding.id)).size !== global.length)
    return refuse("invalid-finding-identity")
  const task = (scope: Parameters<typeof batchTarget>[2], map?: ChapterPartMap) => {
    const target = batchTarget(reserve, roots, scope)
    const request = batchVerificationRequest(execution, {
      target,
      findings: scope.findings,
      ...(map ? { map } : {}),
    })
    const fits = batchRequestFits(
      execution,
      request,
      scope.originals.reduce((sum, span) => sum + span.originalFragment.length, 0),
    )
    return { target, request, bytes: localRequestBytes("chatgpt-subscription", request), fits }
  }
  try {
    const omission = outputs.maps.map((map, index) => {
      const originals = windows[index],
        windowHash = reserve.windowHashes[index]
      if (!originals || !windowHash) throw new TypeError("Missing approved map window")
      const findings = chapterFindings(map)
      citationOriginals(execution, findings)
      if (
        findings.some((finding) =>
          finding.sources.some(
            (span) =>
              !originals.some(
                (original) =>
                  original.resourcePath === span.resourcePath &&
                  original.blockId === span.blockId &&
                  span.start >= original.start &&
                  span.end <= original.end,
              ),
          ),
        )
      )
        throw new ProviderError("unauthorized")
      return task({ kind: "map-omission", originals, windowHash, batchHash: null, findings }, map)
    })
    if (omission.some((entry) => !entry.fits)) return refuse("indivisible-map-omission-overflow")
    const batchTasks = (findings: readonly MappedFinding[]) => {
      const batchHash = contentDigest(JSON.stringify(findings))
      const citations = task({
        kind: "synthesis-citations",
        originals: citationOriginals(execution, findings),
        windowHash: null,
        batchHash,
        findings,
      })
      return [
        ...windows.map((originals, index) => {
          const windowHash = reserve.windowHashes[index]
          if (!windowHash) throw new TypeError("Missing approved window")
          return task({ kind: "window-findings", originals, windowHash, batchHash, findings })
        }),
        citations,
      ]
    }
    const batches: (readonly MappedFinding[])[] = []
    let pending: readonly MappedFinding[] = []
    for (const finding of global) {
      const candidate = [...pending, finding]
      if (batchTasks(candidate).every((entry) => entry.fits)) {
        pending = candidate
        continue
      }
      if (pending.length > 0) {
        batches.push(pending)
        pending = []
      }
      if (!batchTasks([finding]).every((entry) => entry.fits))
        return refuse("indivisible-finding-or-citation-overflow")
      pending = [finding]
      if (batches.length >= reserve.maxFindingBatches) return refuse("batch-reserve-overflow")
    }
    if (pending.length > 0) batches.push(pending)
    if (batches.length > reserve.maxFindingBatches) return refuse("batch-reserve-overflow")
    const requests = [...omission, ...batches.flatMap(batchTasks)]
    const manifest = BatchedVerificationManifest.parse({
      reserve,
      maps: outputs.maps,
      synthesis: outputs.synthesis,
      batches: batches.map((findings) => ({
        hash: contentDigest(JSON.stringify(findings)),
        findingIds: findings.map((finding) => finding.id),
      })),
      targets: requests.map((entry) => entry.target),
    })
    return { kind: "ready" as const, manifest, requests }
  } catch (error) {
    if (error instanceof ProviderError && error.code === "unauthorized")
      return refuse("foreign-original-citation")
    throw error
  }
}
