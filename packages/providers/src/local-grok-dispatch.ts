import type { LocalToolSession } from "@reading-studio/storage"
import { z } from "zod"
import type { StructuredRequest } from "./adapter.ts"
import { ProviderError } from "./catalog.ts"
import { localToolInput } from "./local-tool-request.ts"
import type { ProviderReceipt } from "./provider-receipt.ts"

export async function dispatchLocalGrok(
  session: LocalToolSession,
  request: StructuredRequest,
  authorize: () => void,
): Promise<ProviderReceipt> {
  const { rpc } = session
  const started = z.object({ sessionId: z.string().min(1).max(256) }).parse(
    await rpc.request("session/new", {
      cwd: rpc.cwd,
      mcpServers: [],
      _meta: {
        yoloMode: false,
        autoMode: false,
        systemPromptOverride:
          "Use only the supplied study content. Return the requested JSON. Do not use tools or external sources.",
      },
    }),
  )
  z.object({}).parse(
    await rpc.request("session/set_model", {
      sessionId: started.sessionId,
      modelId: request.model,
    }),
  )
  let text = ""
  let denied = false
  const abort = () => rpc.stop()
  const unsubscribe = rpc.subscribe((method, raw) => {
    if (method !== "session/update") return
    const parsed = z
      .object({
        sessionId: z.string(),
        update: z.object({
          sessionUpdate: z.string(),
          content: z.object({ type: z.literal("text"), text: z.string() }).optional(),
        }),
      })
      .safeParse(raw)
    if (!parsed.success || parsed.data.sessionId !== started.sessionId) return
    const update = parsed.data.update
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      denied = true
      rpc.stop()
      return
    }
    if (update.sessionUpdate === "agent_message_chunk" && update.content) {
      text += update.content.text
      if (Buffer.byteLength(text, "utf8") > 128000) {
        denied = true
        rpc.stop()
      }
    }
  })
  request.signal.addEventListener("abort", abort, { once: true })
  try {
    if (request.signal.aborted) throw new ProviderError("outcome-unknown")
    authorize()
    const result = z
      .object({ stopReason: z.string() })
      .parse(
        await rpc.request(
          "session/prompt",
          { sessionId: started.sessionId, ...localToolInput("grok-subscription", request) },
          90000,
        ),
      )
    return result.stopReason === "end_turn" && !denied && !rpc.clientRequestRejected
      ? { kind: "output", text, usage: { kind: "unknown" } }
      : {
          kind: "error",
          code: result.stopReason === "max_tokens" ? "truncated" : "unavailable",
          usage: { kind: "unknown" },
        }
  } finally {
    unsubscribe()
    request.signal.removeEventListener("abort", abort)
  }
}
