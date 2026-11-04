import { z } from "zod"
import { SubscriptionLoginError } from "./subscription-session-store.ts"

const RpcCode = z.union([
  z.literal(-32700),
  z.literal(-32600),
  z.literal(-32601),
  z.literal(-32602),
  z.literal(-32603),
])
export class SubscriptionRpcRejection extends SubscriptionLoginError {
  readonly rpcCode: z.infer<typeof RpcCode> | "other"
  constructor(raw: unknown) {
    super("protocol-error")
    const parsed = z.object({ code: RpcCode }).safeParse(raw)
    this.rpcCode = parsed.success ? parsed.data.code : "other"
  }
}
