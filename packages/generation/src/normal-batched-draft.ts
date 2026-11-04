import {
  BATCHED_VERIFICATION_VERSION,
  type NormalizationRevision,
  StudySetupRevision,
  VERIFICATION_ROOM_PREPROCESSING_VERSION,
} from "@reading-studio/contracts"
import {
  ProviderError,
  requireRouteCapacity,
  type VerifiedRouteCapacity,
} from "@reading-studio/providers"
import { adaptiveBookPlan, storedBookPlan } from "./adaptive-book-plan.ts"
import { approveBatchedVerification } from "./batched-verification-plan.ts"
import { batchOriginals } from "./batched-verification-source.ts"
import { plannedWindowOriginals, verificationRoomAssessment } from "./verification-room.ts"
import { wholeBookAllowance } from "./whole-book-budget.ts"

export const NORMAL_MAX_FINDING_BATCHES = 4
export async function proposeNormalBatchedDraft(input: {
  readonly setup: StudySetupRevision
  readonly normalization: NormalizationRevision
  readonly capacity?: VerifiedRouteCapacity
  readonly cap: number
  readonly used: number
}) {
  const limited = (
    reason:
      | "capacity-unknown"
      | "capacity-limit"
      | "attempt-budget-limit"
      | "analysis-window-limit"
      | "unsupported-version",
  ) => ({ kind: "limited" as const, reason })
  if (
    (input.setup.analysis.purpose &&
      input.setup.analysis.processing?.preprocessingVersion !==
        VERIFICATION_ROOM_PREPROCESSING_VERSION) ||
    input.setup.analysis.processing?.synthesisVersion !== BATCHED_VERIFICATION_VERSION ||
    input.setup.batchedVerificationReserve ||
    input.setup.analysis.processing.batchReserveId
  )
    return limited("unsupported-version")
  try {
    const capacity = requireRouteCapacity(input.setup, input.capacity)
    if (input.setup.analysis.processing.capacityId !== capacity.id)
      return limited("capacity-unknown")
    const executionBeforePlan = { setup: input.setup, normalization: input.normalization, capacity }
    const originals = batchOriginals(executionBeforePlan)
    const roomAware =
      input.setup.analysis.processing.preprocessingVersion ===
      VERIFICATION_ROOM_PREPROCESSING_VERSION
    const mapped = await adaptiveBookPlan({
      ...input,
      capacity,
      ...(roomAware
        ? {
            verification: { version: BATCHED_VERIFICATION_VERSION, maxFindingBatches: 1 },
            additionalWindowFits: (window) => {
              if (!window.groupId) return false
              return verificationRoomAssessment(executionBeforePlan, {
                originals: plannedWindowOriginals(originals, window.ranges ?? [window]),
                groupId: window.groupId,
              }).fits
            },
          }
        : {}),
    })
    if (mapped.kind !== "ready") return limited(mapped.reason)
    let maxFindingBatches = NORMAL_MAX_FINDING_BATCHES
    while (maxFindingBatches > 0) {
      const allowance = wholeBookAllowance({
        windows: mapped.windows.length,
        cap: input.cap,
        used: input.used,
        ...(input.setup.analysis.purpose ? { purpose: input.setup.analysis.purpose } : {}),
        verification: { version: BATCHED_VERIFICATION_VERSION, maxFindingBatches },
      })
      if (allowance.plannedAttempts <= allowance.remaining) break
      maxFindingBatches--
    }
    if (maxFindingBatches === 0) return limited("attempt-budget-limit")
    const proposed = StudySetupRevision.parse({
      ...input.setup,
      analysis: {
        ...input.setup.analysis,
        processing: { ...input.setup.analysis.processing, plan: storedBookPlan(mapped.windows) },
      },
    })
    const execution = { setup: proposed, normalization: input.normalization, capacity }
    const windows = mapped.windows.map((window) =>
      plannedWindowOriginals(originals, window.ranges ?? [window]),
    )
    const approved = approveBatchedVerification(execution, windows, {
      cap: input.cap,
      used: input.used,
      maxFindingBatches,
    })
    if (approved.kind !== "ready")
      return limited(
        approved.reason === "attempt-budget-limit" ? "attempt-budget-limit" : "capacity-limit",
      )
    const setup = StudySetupRevision.parse({
      ...proposed,
      batchedVerificationReserve: approved.reserve,
      analysis: {
        ...proposed.analysis,
        processing: { ...proposed.analysis.processing, batchReserveId: approved.reserve.id },
      },
    })
    return { kind: "ready" as const, setup, windows: mapped.windows, reserve: approved.reserve }
  } catch (error) {
    if (error instanceof ProviderError) return limited("capacity-unknown")
    throw error
  }
}
