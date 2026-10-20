import { z } from "zod"
import type { AdapterConfig, ProviderReceipt, StructuredRequest } from "./adapter.ts"
import { ProviderError } from "./catalog.ts"

export function codexPayload(request: StructuredRequest) {
  return {
    input: [{ type: "text", text: request.prompt, text_elements: [] }],
    outputSchema: request.schema,
  }
}

export async function dispatchCodex(
  config: Pick<AdapterConfig, "codex" | "timeoutMs">,
  request: StructuredRequest,
): Promise<ProviderReceipt> {
  const connection = config.codex
  if (!connection) throw new ProviderError("missing-credentials")
  if (!(await connection.models()).some((choice) => choice.model === request.model)) {
    await connection.disconnect()
    return { kind: "error", code: "rejected", usage: { kind: "unknown" } }
  }
  const session = await connection.open()
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(config.timeoutMs ?? 90000)])
  try {
    const started = z.object({ thread: z.object({ id: z.string() }) }).parse(
      await session.request("thread/start", {
        model: request.model,
        ephemeral: true,
        approvalPolicy: "never",
        sandbox: "read-only",
        config: { "features.shell_tool": false, web_search: "disabled" },
      }),
    )
    const receipt = await new Promise<ProviderReceipt>((resolve, reject) => {
      let text = ""
      let usage: ProviderReceipt["usage"] = { kind: "unknown" }
      let completed = false
      const finish = (receipt: ProviderReceipt) => {
        unsubscribe()
        signal.removeEventListener("abort", abort)
        resolve(receipt)
      }
      const abort = () => {
        unsubscribe()
        signal.removeEventListener("abort", abort)
        if (completed && !request.signal.aborted) {
          resolve({ kind: "error", code: "unavailable", usage })
          return
        }
        reject(new ProviderError("outcome-unknown"))
      }
      const unsubscribe = session.subscribe((method, raw) => {
        const event = z.object({ threadId: z.string() }).passthrough().safeParse(raw)
        if (!event.success || event.data.threadId !== started.thread.id) return
        if (method === "thread/tokenUsage/updated") {
          const tokens = z
            .object({
              tokenUsage: z.object({
                last: z.object({
                  inputTokens: z.number().int().nonnegative(),
                  outputTokens: z.number().int().nonnegative(),
                }),
              }),
            })
            .safeParse(raw)
          if (tokens.success) {
            usage = { kind: "known", ...tokens.data.tokenUsage.last }
            if (completed) finish({ kind: "output", text, usage })
          }
        }
        if (method === "item/completed") {
          const item = z
            .object({ item: z.object({ type: z.literal("agentMessage"), text: z.string() }) })
            .safeParse(raw)
          if (item.success) text = item.data.item.text
        }
        if (method === "turn/completed") {
          const turn = z
            .object({
              turn: z.object({
                status: z.string(),
                error: z.object({ codexErrorInfo: z.unknown() }).nullish(),
              }),
            })
            .safeParse(raw)
          if (turn.success && turn.data.turn.status === "completed") {
            completed = true
            if (usage.kind === "known") finish({ kind: "output", text, usage })
            return
          }
          const error = turn.success ? turn.data.turn.error?.codexErrorInfo : undefined
          switch (error) {
            case "usageLimitExceeded":
            case "rateLimitExceeded":
            case "sessionBudgetExceeded":
              finish({ kind: "error", code: "rate-limited", usage })
              break
            case "unauthorized":
              finish({ kind: "error", code: "rejected", usage })
              break
            default:
              finish({ kind: "error", code: "unavailable", usage })
          }
        }
      })
      signal.addEventListener("abort", abort, { once: true })
      if (signal.aborted) {
        abort()
        return
      }
      session
        .request("turn/start", { threadId: started.thread.id, ...codexPayload(request) })
        .catch(() => {
          unsubscribe()
          signal.removeEventListener("abort", abort)
          resolve({ kind: "error", code: "rejected", usage })
        })
    })
    if (receipt.kind === "error" && receipt.code === "rejected") await connection.disconnect()
    return receipt
  } finally {
    session.close()
  }
}
