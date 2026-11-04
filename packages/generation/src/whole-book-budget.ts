import type { AnalysisEvaluationPurpose } from "@reading-studio/contracts"
export function wholeBookAllowance(input: {
  readonly windows: number
  readonly cap: number
  readonly used: number
  readonly completed?: number
  readonly purpose?: AnalysisEvaluationPurpose
  readonly verification?: {
    readonly version: "batched-original-check-4"
    readonly maxFindingBatches: number
  }
}) {
  const cap = Math.min(input.purpose ? 20 : 64, input.cap)
  if (input.purpose && !input.verification)
    throw new TypeError("Analysis purpose requires signed batched verification")
  if (
    input.verification &&
    (!Number.isSafeInteger(input.verification.maxFindingBatches) ||
      input.verification.maxFindingBatches < 1)
  )
    throw new TypeError("A positive finite finding-batch reserve is required")
  const jobs = input.verification
    ? input.windows * 2 + 1 + (input.windows + 1) * input.verification.maxFindingBatches
    : input.windows * 2 + 2
  return {
    cap,
    used: input.used,
    remaining: Math.max(0, cap - input.used),
    plannedAttempts: Math.max(0, (jobs - (input.completed ?? 0)) * 2) + (input.purpose ? 0 : 12),
    reservedLaterAttempts: input.purpose ? 0 : 12,
    uncertainCounts: true as const,
  }
}
