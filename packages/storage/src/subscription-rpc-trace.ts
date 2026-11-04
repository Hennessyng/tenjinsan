import { z } from "zod"
import { SafeSignal } from "./protocol-observation.ts"
import type { SubscriptionRpcFault } from "./subscription-rpc-fault.ts"
export class SubscriptionRpcTrace {
  fault: SubscriptionRpcFault | undefined
  closed = false
  stopped = false
  stdoutClosed = false
  exitCode: number | null = null
  signal: z.infer<typeof SafeSignal> | null = null
  private native: { code: number | null; signal: z.infer<typeof SafeSignal> | null } | undefined
  observeNative(raw: unknown) {
    const parsed = z
      .strictObject({
        kind: z.literal("tool-exit"),
        code: z.number().int().nullable(),
        signal: z.string().nullable(),
      })
      .safeParse(raw)
    if (parsed.success)
      this.native = {
        code: parsed.data.code,
        signal:
          parsed.data.signal === null
            ? null
            : (SafeSignal.safeParse(parsed.data.signal).data ?? "other"),
      }
  }
  snapshot() {
    return {
      closed: this.closed,
      stopped: this.stopped,
      stdoutClosed: this.stdoutClosed,
      exitCode: this.exitCode,
      signal: this.signal,
      nativeExitObserved: this.native !== undefined,
      nativeExitCode: this.native?.code ?? null,
      nativeSignal: this.native?.signal ?? null,
    }
  }
  fail(error: SubscriptionRpcFault) {
    if (!this.fault) {
      error.observation = this.snapshot()
      this.fault = error
    }
    return this.fault
  }
}
