import type { Usage } from "@reading-studio/contracts"
import type { z } from "zod"
import type { ManagedDiagnostic } from "./full-book-managed-diagnostic.ts"
import { ManagedEventFault, ManagedTurnEvents } from "./full-book-managed-events.ts"
import { type PreparedRpcFrame, RpcFrameError } from "./rpc-frame.ts"
import { SubscriptionRpcFault } from "./subscription-rpc-fault.ts"
import { SubscriptionRpcRejection } from "./subscription-rpc-rejection.ts"
import type { SubscriptionToolRpc } from "./subscription-tool-rpc.ts"
export class ManagedCollectionError extends Error {
  readonly bytes: number
  readonly diagnostic: z.infer<typeof ManagedDiagnostic> | undefined
  constructor(
    readonly reason: "cancelled" | "collection-overflow" | "protocol" | "closed",
    readonly usage: z.infer<typeof Usage>,
    evidence: Readonly<{ bytes: number; diagnostic?: z.infer<typeof ManagedDiagnostic> }>,
  ) {
    super(`Managed experimental collection failed: ${reason}`)
    this.name = "ManagedCollectionError"
    this.bytes = evidence.bytes
    this.diagnostic = evidence.diagnostic
  }
}
export async function collectManagedTurn(
  input: Readonly<{
    rpc: SubscriptionToolRpc
    frame: PreparedRpcFrame
    threadId: string
    signal: AbortSignal
    timeoutMs: number
    collectorBytes: number
    maxBytes: number
  }>,
) {
  const { rpc } = input,
    state = new ManagedTurnEvents(input.threadId, input.collectorBytes)
  let settled = false
  const rawBound = rpc.boundOutputBytes(input.collectorBytes + 64000)
  return new Promise<Readonly<{ text: string; turnId: string; usage: z.infer<typeof Usage> }>>(
    (resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        unsubscribe()
        rawBound()
        input.signal.removeEventListener("abort", cancel)
      }
      const fail = (
        reason: ManagedCollectionError["reason"],
        error: ManagedEventFault | SubscriptionRpcFault,
        stage: "turn-event" | "turn-start-response" = "turn-event",
      ) => {
        if (settled) return
        const observation = state.observation(rpc, error.fields)
        const diagnostic: z.infer<typeof ManagedDiagnostic> =
          error instanceof SubscriptionRpcFault
            ? {
                category: "transport",
                stage: "rpc",
                site: error.site,
                method: error.method,
                fields: error.fields,
                ...(error.frameCode ? { frameCode: error.frameCode } : {}),
                observation,
                ...(error.observation ? { transport: error.observation } : {}),
              }
            : {
                ...(state.diagnostic ?? { category: "collector", stage }),
                site: error.site,
                observation,
              }
        settled = true
        cleanup()
        rpc.stop()
        reject(new ManagedCollectionError(reason, state.usage, { bytes: state.bytes, diagnostic }))
      }
      const finish = () => {
        if (settled) return
        try {
          if (!state.complete(rpc.clientRequestRejected)) return
          if (state.final === undefined || state.turnId === undefined)
            throw new ManagedEventFault("terminal-missing-final")
          settled = true
          cleanup()
          resolve({ text: state.final, turnId: state.turnId, usage: state.usage })
        } catch (error) {
          if (error instanceof ManagedEventFault) fail("protocol", error)
          else throw error
        }
      }
      const unsubscribe = rpc.subscribe((method, raw) => {
        if (settled) return
        if (rpc.failure) {
          fail("closed", rpc.failure)
          return
        }
        try {
          state.consume(method, raw)
          finish()
        } catch (error) {
          if (!(error instanceof ManagedEventFault)) throw error
          fail(error.site === "collection-limit" ? "collection-overflow" : "protocol", error)
        }
      })
      const cancel = () => fail("cancelled", new ManagedEventFault("cancelled"))
      const timer = setTimeout(
        () => fail("closed", new ManagedEventFault("collection-timeout")),
        input.timeoutMs,
      )
      input.signal.addEventListener("abort", cancel, { once: true })
      if (input.signal.aborted) {
        cancel()
        return
      }
      void rpc.closed.then(() =>
        fail("closed", rpc.failure ?? new SubscriptionRpcFault("process-closed")),
      )
      void rpc
        .requestPrepared(input.frame, input.timeoutMs, {
          maxBytes: input.maxBytes,
          expectedBinding: input.frame.binding,
        })
        .then(
          (raw) => {
            if (settled) return
            try {
              state.acknowledge(raw)
              finish()
            } catch (error) {
              if (!(error instanceof ManagedEventFault)) throw error
              if (error.site === "ack-shape")
                state.diagnostic = { category: "invalid-response", stage: "turn-start-response" }
              fail("protocol", error, "turn-start-response")
            }
          },
          (error: unknown) => {
            if (error instanceof SubscriptionRpcRejection) {
              state.diagnostic = {
                category: "rpc-rejection",
                stage: "turn-start-response",
                code: error.rpcCode,
              }
              fail("protocol", new ManagedEventFault("rpc-rejection"))
            } else if (error instanceof RpcFrameError)
              fail(
                "protocol",
                new SubscriptionRpcFault("frame-invalid", undefined, { frameCode: error.code }),
              )
            else
              fail(
                "closed",
                error instanceof SubscriptionRpcFault
                  ? error
                  : new SubscriptionRpcFault("write-failed"),
              )
          },
        )
    },
  )
}
