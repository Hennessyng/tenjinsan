import { z } from "zod"
import type { ProviderReceipt } from "./provider-receipt.ts"

type Failure = Pick<Extract<ProviderReceipt, { readonly kind: "error" }>, "code" | "diagnostic">
const Known = z.enum([
  "badRequest",
  "unauthorized",
  "rateLimitExceeded",
  "usageLimitExceeded",
  "sessionBudgetExceeded",
  "serverOverloaded",
])
export function codexTerminalFailure(info: unknown, clientRequestRejected: boolean): Failure {
  if (clientRequestRejected) return { code: "rejected", diagnostic: "client-capability-denied" }
  const known = Known.safeParse(info)
  if (known.success) {
    const variant = known.data
    switch (variant) {
      case "badRequest":
        return { code: "rejected", diagnostic: "request-rejected" }
      case "unauthorized":
        return { code: "rejected", diagnostic: "access-rejected" }
      case "rateLimitExceeded":
      case "usageLimitExceeded":
      case "sessionBudgetExceeded":
        return { code: "rate-limited", diagnostic: "rate-limited" }
      case "serverOverloaded":
        return { code: "unavailable", diagnostic: "provider-unavailable" }
      default:
        return assertNever(variant)
    }
  }
  const http = z
    .object({ httpConnectionFailed: z.object({ httpStatusCode: z.number().int().nullish() }) })
    .safeParse(info)
  if (http.success) {
    const status = http.data.httpConnectionFailed.httpStatusCode
    if (status === 401 || status === 403) return { code: "rejected", diagnostic: "access-rejected" }
    if (status === 429) return { code: "rate-limited", diagnostic: "rate-limited" }
    if (status !== null && status !== undefined && status >= 400 && status < 500)
      return { code: "rejected", diagnostic: "request-rejected" }
    return { code: "unavailable", diagnostic: "transport-failure" }
  }
  return { code: "unavailable", diagnostic: "terminal-unclassified" }
}
function assertNever(value: never): never {
  throw new TypeError(`Unexpected native error variant: ${value}`)
}
