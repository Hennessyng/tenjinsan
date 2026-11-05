import type { z } from "zod"
import {
  type FailureSite,
  parseFields,
  type SafeMethod,
  type TransportObservation,
} from "./protocol-observation.ts"
import { SubscriptionLoginError } from "./subscription-session-store.ts"
export class SubscriptionRpcFault extends SubscriptionLoginError {
  observation?: z.infer<typeof TransportObservation>
  readonly fields
  readonly method: z.infer<typeof SafeMethod>
  readonly frameCode: "invalid-frame" | "frame-limit" | undefined
  constructor(
    readonly site: FailureSite,
    error?: z.ZodError,
    context: Readonly<{
      method?: z.infer<typeof SafeMethod>
      frameCode?: "invalid-frame" | "frame-limit"
    }> = {},
  ) {
    super(
      site === "initialize-auth" || site === "raw-bound" ? "protocol-error" : "tool-unavailable",
    )
    this.fields = error ? parseFields(error) : []
    this.method = context.method ?? "other"
    this.frameCode = context.frameCode
  }
}
