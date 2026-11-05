import type { LocalSubscriptionProvider } from "@reading-studio/contracts"
import { contentDigest, localToolInput } from "@reading-studio/contracts"
import type { StructuredRequest } from "./adapter.ts"

export { localToolInput } from "@reading-studio/contracts"
export function localRequestBytes(
  provider: LocalSubscriptionProvider,
  request: StructuredRequest,
): number {
  return Buffer.byteLength(JSON.stringify(localToolInput(provider, request)), "utf8")
}
export function legacyLocalReservationBytes(
  provider: LocalSubscriptionProvider,
  request: StructuredRequest,
): number {
  return localRequestBytes(provider, request) + 2048
}
export function localRequestBinding(
  request: StructuredRequest,
  route: {
    readonly setupId: string
    readonly grantId: string
    readonly jobId: string
    readonly capacityId: string
    readonly destination: unknown
  },
) {
  return contentDigest(
    JSON.stringify({
      version: "app-rpc-frame-1",
      ...route,
      model: request.model,
      settings: request.settings,
      schema: request.schema,
      prompt: request.prompt,
    }),
  )
}
