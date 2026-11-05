import {
  BATCHED_VERIFICATION_VERSION,
  BatchedVerificationReserve,
  baseAnalysisCacheKey,
  contentDigest,
  VERIFICATION_ROOM_PREPROCESSING_VERSION,
  type WindowOriginal,
} from "@reading-studio/contracts"
import { requireManagedChatGPT, requireRouteCapacity } from "@reading-studio/providers"
import {
  type BatchExecution,
  batchRequestFits,
  batchTarget,
  batchVerificationRequest,
} from "./batched-verification-request.ts"
import { batchOriginals, validBatchPartition } from "./batched-verification-source.ts"
import { verificationRoomAssessment } from "./verification-room.ts"
import { wholeBookAllowance } from "./whole-book-budget.ts"

export function approveBatchedVerification(
  execution: BatchExecution,
  windows: readonly (readonly WindowOriginal[])[],
  budget: { readonly maxFindingBatches: number; readonly cap: number; readonly used: number },
) {
  if (execution.setup.analysis.processing?.synthesisVersion !== BATCHED_VERIFICATION_VERSION)
    throw new TypeError("Explicit version4 draft required")
  requireManagedChatGPT(execution.setup.analysis.provider)
  requireRouteCapacity(execution.setup, execution.capacity)
  if (execution.setup.analysis.processing.capacityId !== execution.capacity.id)
    throw new TypeError("Foreign capacity identity")
  const originals = batchOriginals(execution)
  if (!validBatchPartition(originals, windows))
    return { kind: "limited" as const, reason: "invalid-source-partition" as const }
  const mapPlan = execution.setup.analysis.processing.plan
  if (
    (execution.setup.analysis.purpose &&
      execution.setup.analysis.processing?.preprocessingVersion !==
        VERIFICATION_ROOM_PREPROCESSING_VERSION) ||
    (execution.setup.analysis.processing.preprocessingVersion !== "batched-capacity-4" &&
      execution.setup.analysis.processing.preprocessingVersion !==
        VERIFICATION_ROOM_PREPROCESSING_VERSION) ||
    !mapPlan ||
    JSON.stringify(mapPlan.map((part) => part.ranges)) !==
      JSON.stringify(
        windows.map((window) =>
          window.map(({ resourcePath, blockId, start, end }) => ({
            resourcePath,
            blockId,
            start,
            end,
          })),
        ),
      )
  )
    return { kind: "limited" as const, reason: "foreign-map-window-plan" as const }
  const allowance = wholeBookAllowance({
    windows: windows.length,
    ...budget,
    ...(execution.setup.analysis.purpose ? { purpose: execution.setup.analysis.purpose } : {}),
    verification: {
      version: BATCHED_VERIFICATION_VERSION,
      maxFindingBatches: budget.maxFindingBatches,
    },
  })
  if (allowance.plannedAttempts > allowance.remaining)
    return { kind: "limited" as const, reason: "attempt-budget-limit" as const }
  const maxVerificationJobs = windows.length + (windows.length + 1) * budget.maxFindingBatches
  const body = {
    version: BATCHED_VERIFICATION_VERSION,
    analysisKey: baseAnalysisCacheKey(execution.setup.analysis),
    capacityId: execution.capacity.id,
    sourceHash: contentDigest(JSON.stringify(originals)),
    windowHashes: windows.map((window) => contentDigest(JSON.stringify(window))),
    maxFindingBatches: budget.maxFindingBatches,
    maxVerificationJobs,
    maxAnalysisJobs: windows.length + 1 + maxVerificationJobs,
    plannedAttempts: allowance.plannedAttempts,
    cap: allowance.cap,
    used: budget.used,
    attemptsPerJob: 2 as const,
    reservedLaterAttempts: allowance.reservedLaterAttempts,
    outputFitGuaranteed: false as const,
    ...(execution.setup.analysis.purpose
      ? {
          purpose: execution.setup.analysis.purpose,
          budgetPolicy: "analysis-evaluation-reserve-1" as const,
        }
      : {}),
  }
  const reserve = BatchedVerificationReserve.parse({
    ...body,
    id: contentDigest(JSON.stringify(body)),
  })
  for (const [index, window] of windows.entries()) {
    if (
      execution.setup.analysis.processing.preprocessingVersion ===
      VERIFICATION_ROOM_PREPROCESSING_VERSION
    ) {
      const groupId = mapPlan[index]?.groupId
      if (!groupId || !verificationRoomAssessment(execution, { originals: window, groupId }).fits)
        return { kind: "limited" as const, reason: "known-source-overflow" as const }
    }
    const windowHash = reserve.windowHashes[index]
    if (!windowHash) throw new TypeError("Missing approved window")
    const target = batchTarget(
      reserve,
      {
        mapsHash: contentDigest("unknown maps"),
        synthesisHash: contentDigest("unknown synthesis"),
      },
      {
        kind: "window-findings",
        originals: window,
        windowHash,
        batchHash: contentDigest("unknown batch"),
        findings: [],
      },
    )
    if (
      !batchRequestFits(
        execution,
        batchVerificationRequest(execution, { target, findings: [] }),
        window.reduce((sum, span) => sum + span.originalFragment.length, 0),
      )
    )
      return { kind: "limited" as const, reason: "known-source-overflow" as const }
  }
  return { kind: "ready" as const, reserve }
}
