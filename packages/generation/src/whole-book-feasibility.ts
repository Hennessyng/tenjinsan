import {
  BATCHED_VERIFICATION_VERSION,
  COVERAGE_VERIFICATION_VERSION,
  type NormalizationRevision,
  SourcePreparationFailure,
  type StudySetupRevision,
} from "@reading-studio/contracts"
import {
  ProviderError,
  requireRouteCapacity,
  reviewedSourceBlocks,
  type VerifiedRouteCapacity,
} from "@reading-studio/providers"
import { ADAPTIVE_PREPROCESSING_VERSION, adaptiveBookPlan } from "./adaptive-book-plan.ts"
import { checkBatchedFeasibility } from "./batched-feasibility.ts"
import { bookMapRequestsFit } from "./book-map-request.ts"
import { prepareBookMapScope } from "./book-map-scope.ts"
import { wholeBookAllowance } from "./whole-book-budget.ts"

export { wholeBookAllowance } from "./whole-book-budget.ts"

export async function wholeBookFeasibility(input: {
  readonly setup: StudySetupRevision
  readonly normalization: NormalizationRevision
  readonly capacity?: VerifiedRouteCapacity
  readonly cap: number
  readonly used: number
  readonly allowExperimentalCoverage?: true
}) {
  let scope = prepareBookMapScope(input.setup, input.normalization)
  let requiredWindows =
    scope.kind === "ready" ? scope.windows.length : scope.failure.coverage.requiredWindows
  let allowance = wholeBookAllowance({
    windows: requiredWindows,
    cap: input.cap,
    used: input.used,
  })
  const refuse = (reason: SourcePreparationFailure["coverage"]["reason"]) => ({
    kind: "limited" as const,
    failure: SourcePreparationFailure.parse({
      error: "scope-limit",
      coverage: {
        transmission: "not-sent",
        reason,
        requiredWindows,
        maxWindows: 128,
        allowance,
        unsentRanges: reviewedSourceBlocks(input.setup, input.normalization).map(
          ({ resourcePath, blockId, start, end, locator, pageLabel }) => ({
            resourcePath,
            blockId,
            start,
            end,
            ...(locator ? { locator } : {}),
            ...(pageLabel ? { pageLabel } : {}),
          }),
        ),
      },
    }),
  })
  if (input.setup.analysis.processing?.synthesisVersion === BATCHED_VERIFICATION_VERSION) {
    if (scope.kind !== "ready") return scope
    const checked = await checkBatchedFeasibility(input)
    if (checked.kind !== "ready") return refuse(checked.reason)
    allowance = checked.allowance
    if (!(await bookMapRequestsFit({ ...input, windows: scope.windows })))
      return refuse("capacity-limit")
    return { ...scope, allowance }
  }
  if (
    input.setup.analysis.analysisPromptVersion !== "whole-book-2" ||
    input.setup.analysis.analysisSchemaVersion !== "whole-book-2" ||
    (input.setup.analysis.processing?.preprocessingVersion !== "packed-unicode-2" &&
      input.setup.analysis.processing?.preprocessingVersion !== ADAPTIVE_PREPROCESSING_VERSION) ||
    (input.setup.analysis.processing.synthesisVersion !== "maps-original-check-2" &&
      input.setup.analysis.processing.synthesisVersion !== COVERAGE_VERIFICATION_VERSION)
  )
    return refuse("unsupported-version")
  if (
    input.setup.analysis.processing.synthesisVersion === COVERAGE_VERIFICATION_VERSION &&
    (input.allowExperimentalCoverage !== true ||
      input.setup.experimentalCoverageOptIn?.enabled !== true)
  )
    return refuse("capacity-limit")
  if (scope.kind !== "ready") return scope
  let capacity: VerifiedRouteCapacity
  try {
    capacity = requireRouteCapacity(input.setup, input.capacity)
    if (input.setup.analysis.processing?.capacityId !== capacity.id)
      return refuse("capacity-unknown")
  } catch (error) {
    if (error instanceof ProviderError) return refuse("capacity-unknown")
    throw error
  }
  try {
    if (
      input.setup.analysis.processing?.preprocessingVersion === ADAPTIVE_PREPROCESSING_VERSION &&
      !input.setup.analysis.processing.plan
    ) {
      const adaptive = await adaptiveBookPlan({ ...input, capacity })
      requiredWindows =
        adaptive.kind === "ready" ? adaptive.windows.length : adaptive.requiredWindows
      allowance = wholeBookAllowance({ windows: requiredWindows, cap: input.cap, used: input.used })
      if (adaptive.kind === "limited") return refuse(adaptive.reason)
      scope = { ...scope, windows: adaptive.windows }
    }
    if (allowance.plannedAttempts > allowance.remaining) return refuse("attempt-budget-limit")
    if (!(await bookMapRequestsFit({ ...input, windows: scope.windows })))
      return refuse("capacity-limit")
  } catch (error) {
    if (error instanceof ProviderError && error.code === "capacity-unknown")
      return refuse("capacity-unknown")
    throw error
  }
  return {
    ...scope,
    allowance,
    ...(input.setup.analysis.processing.synthesisVersion === COVERAGE_VERIFICATION_VERSION
      ? { verificationCapacity: "unproven-experimental-opt-in" as const }
      : {}),
  }
}
