import type { PreparationReason, PreparationReview } from "@reading-studio/contracts/setup-progress"

export function sendBlockedKey(input: {
  readonly current: boolean
  readonly available: boolean
  readonly preparation?: PreparationReview | undefined
}) {
  if (!input.current) return "setup.exclusive.history"
  if (!input.available) return "setup.review.providerUnavailable"
  if (input.preparation?.purpose && !input.preparation.purposeTargetBound)
    return "setup.analysisTargetRequired"
  if (input.preparation?.state === "ready") return null
  const keys = {
    "attempt-budget-limit": "setup.sendBlockedBudget",
    "analysis-window-limit": "setup.sendBlockedWindow",
    "capacity-limit": "setup.sendBlockedCapacity",
    "request-byte-limit": "setup.sendBlockedCapacity",
    "capacity-unknown": "setup.sendBlockedUnknown",
    "empty-text-scope": "setup.refusal.emptyScope",
    "unsupported-version": "setup.preparation.versionUnsupported",
  } as const satisfies Record<PreparationReason, string>
  return input.preparation?.reason ? keys[input.preparation.reason] : "setup.sendBlocked"
}
