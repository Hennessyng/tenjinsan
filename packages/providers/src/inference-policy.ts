import {
  BATCHED_VERIFICATION_VERSION,
  COVERAGE_VERIFICATION_VERSION,
  LOCAL_CHATGPT_INFERENCE_POLICY,
  type StudySetupRevision,
} from "@reading-studio/contracts"
import type { ProviderAuthority } from "./authorization.ts"
import { ProviderError, type ProviderName } from "./catalog.ts"
import { requireRouteCapacity } from "./request-capacity.ts"

export { LOCAL_CHATGPT_INFERENCE_POLICY } from "@reading-studio/contracts"

export function requireManagedChatGPT(provider: ProviderName): void {
  if (provider !== "chatgpt-subscription") throw new ProviderError("route-re-review-required")
}

export function requireInferenceReview(setup: StudySetupRevision): void {
  requireManagedChatGPT(setup.analysis.provider)
  if (
    setup.analysis.processing?.inferencePolicyVersion !== LOCAL_CHATGPT_INFERENCE_POLICY ||
    setup.analysis.analysisPromptVersion !== "whole-book-2" ||
    setup.analysis.analysisSchemaVersion !== "whole-book-2" ||
    (setup.analysis.processing.preprocessingVersion !== "packed-capacity-3" &&
      setup.analysis.processing.preprocessingVersion !== "batched-capacity-4" &&
      setup.analysis.processing.preprocessingVersion !== "batched-room-5") ||
    (setup.analysis.processing.synthesisVersion !== "maps-original-check-2" &&
      setup.analysis.processing.synthesisVersion !== COVERAGE_VERIFICATION_VERSION &&
      setup.analysis.processing.synthesisVersion !== BATCHED_VERIFICATION_VERSION)
  )
    throw new ProviderError("route-re-review-required")
  if (
    setup.analysis.processing.synthesisVersion === BATCHED_VERIFICATION_VERSION &&
    !setup.batchedVerificationReserve
  )
    throw new ProviderError("route-re-review-required")
  if (
    setup.analysis.processing.preprocessingVersion === "batched-room-5" &&
    setup.analysis.processing.synthesisVersion !== BATCHED_VERIFICATION_VERSION
  )
    throw new ProviderError("route-re-review-required")
}

export function requireAuthorizedInference(
  setup: StudySetupRevision,
  access: Pick<ProviderAuthority, "localSubscriptions" | "capacity">,
) {
  requireInferenceReview(setup)
  if (!access.localSubscriptions) throw new ProviderError("subscription-unverified")
  const capacity = requireRouteCapacity(setup, access.capacity)
  if (capacity.id !== setup.analysis.processing?.capacityId)
    throw new ProviderError("capacity-unknown")
  if (!setup.analysis.processing?.plan) throw new ProviderError("route-re-review-required")
  return capacity
}
