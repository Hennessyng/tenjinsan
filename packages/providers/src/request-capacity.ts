import type { StudySetupRevision } from "@reading-studio/contracts"
import { ProviderError } from "./catalog.ts"
import type { StructuredRequest } from "./structured-request.ts"

export type VerifiedRouteCapacity = {
  readonly id: string
  readonly provider: StudySetupRevision["analysis"]["provider"]
  readonly model: string
  readonly destination: StudySetupRevision["analysis"]["destination"]
  readonly contextTokens: number
  readonly maxOutputTokens: number
  readonly maxRequestBytes: number
  readonly evidence: string
  readonly evidenceScope?: {
    readonly kind: "synthetic-offline"
    readonly measurement: "legacy-tool-input-pad-1"
    readonly downstream: "unverified"
  }
  readonly countInputTokens: (request: StructuredRequest) => number
}

export function requireRouteCapacity(
  setup: StudySetupRevision,
  capacity?: VerifiedRouteCapacity,
): VerifiedRouteCapacity {
  if (
    !capacity ||
    capacity.provider !== setup.analysis.provider ||
    capacity.model !== setup.analysis.model ||
    JSON.stringify(capacity.destination) !== JSON.stringify(setup.analysis.destination) ||
    !capacity.id ||
    !capacity.evidence ||
    capacity.evidenceScope?.kind !== "synthetic-offline" ||
    capacity.evidenceScope.measurement !== "legacy-tool-input-pad-1" ||
    capacity.evidenceScope.downstream !== "unverified" ||
    ![capacity.contextTokens, capacity.maxOutputTokens, capacity.maxRequestBytes].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    throw new ProviderError("capacity-unknown")
  return capacity
}

export function requestFitsCapacity(
  request: StructuredRequest,
  bytes: number,
  capacity: VerifiedRouteCapacity,
): boolean {
  let tokens: number
  try {
    tokens = capacity.countInputTokens(request)
  } catch (error) {
    if (error instanceof Error) throw new ProviderError("capacity-unknown")
    throw error
  }
  return (
    Number.isSafeInteger(bytes) &&
    bytes >= 0 &&
    bytes <= Math.min(32000, capacity.maxRequestBytes) &&
    Number.isSafeInteger(tokens) &&
    tokens >= 0 &&
    request.settings.maxOutputTokens <= capacity.maxOutputTokens &&
    tokens + request.settings.maxOutputTokens <= capacity.contextTokens
  )
}
