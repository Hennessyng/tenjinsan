import { z } from "zod"
import { SubscriptionRpcFault } from "./subscription-rpc-fault.ts"

const Envelope = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
})
export function readRpcLine(line: string) {
  if (line.length > 1_000_000) throw new SubscriptionRpcFault("line-size")
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new SubscriptionRpcFault("json-invalid")
  }
  const parsed = Envelope.safeParse(raw)
  if (!parsed.success) throw new SubscriptionRpcFault("envelope-invalid", parsed.error)
  const event = parsed.data
  if (event.method) {
    if (event.result !== undefined || event.error !== undefined)
      throw new SubscriptionRpcFault("envelope-invalid")
    return event
  }
  if (typeof event.id !== "number") throw new SubscriptionRpcFault("response-id")
  if (event.error === null) throw new SubscriptionRpcFault("response-error-shape")
  if ((event.error === undefined) === (event.result === undefined))
    throw new SubscriptionRpcFault("response-empty")
  return event
}
