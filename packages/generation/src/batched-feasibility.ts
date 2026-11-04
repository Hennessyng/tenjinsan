import {
  type NormalizationRevision,
  type StudySetupRevision,
  validatedBatchedSetupSources,
} from "@reading-studio/contracts"
import {
  ProviderError,
  requireRouteCapacity,
  type VerifiedRouteCapacity,
} from "@reading-studio/providers"
import { approveBatchedVerification } from "./batched-verification-plan.ts"
import { proposeNormalBatchedDraft } from "./normal-batched-draft.ts"

export async function checkBatchedFeasibility(input: {
  readonly setup: StudySetupRevision
  readonly normalization: NormalizationRevision
  readonly capacity?: VerifiedRouteCapacity
  readonly cap: number
  readonly used: number
}) {
  const reserve = input.setup.batchedVerificationReserve
  if (!reserve) {
    const proposal = await proposeNormalBatchedDraft(input)
    return proposal.kind === "limited"
      ? proposal
      : { kind: "limited" as const, reason: "unsupported-version" as const }
  }
  try {
    const capacity = requireRouteCapacity(input.setup, input.capacity)
    const windows = validatedBatchedSetupSources(input.setup, input.normalization)
    const approved = approveBatchedVerification(
      { setup: input.setup, normalization: input.normalization, capacity },
      windows,
      { maxFindingBatches: reserve.maxFindingBatches, cap: reserve.cap, used: reserve.used },
    )
    if (approved.kind !== "ready" || approved.reserve.id !== reserve.id)
      return { kind: "limited" as const, reason: "capacity-limit" as const }
    const cap = Math.min(64, reserve.cap, input.cap)
    if (reserve.plannedAttempts > cap - input.used)
      return { kind: "limited" as const, reason: "attempt-budget-limit" as const }
    return {
      kind: "ready" as const,
      allowance: {
        cap,
        used: input.used,
        remaining: Math.max(0, cap - input.used),
        plannedAttempts: reserve.plannedAttempts,
        reservedLaterAttempts: reserve.reservedLaterAttempts,
        uncertainCounts: true as const,
      },
    }
  } catch (error) {
    if (error instanceof ProviderError)
      return { kind: "limited" as const, reason: "capacity-unknown" as const }
    throw error
  }
}
