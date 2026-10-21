import type { LocalToolSession } from "@reading-studio/storage"
import { z } from "zod"
import type { StructuredRequest } from "./adapter.ts"
import { ProviderError } from "./catalog.ts"
import { codexTerminalFailure } from "./local-codex-error.ts"
import { codexOutputFormat } from "./local-codex-schema.ts"
import { localToolInput } from "./local-tool-request.ts"
import type { ProviderReceipt } from "./provider-receipt.ts"

export async function dispatchLocalCodex(
  session: LocalToolSession,
  request: StructuredRequest,
  authorize: () => void,
): Promise<ProviderReceipt> {
  const { rpc } = session
  const outputFormat = codexOutputFormat(request.schema)
  const mcp = z
    .object({ data: z.array(z.unknown()), nextCursor: z.string().nullable() })
    .parse(await rpc.request("mcpServerStatus/list", {}))
  if (mcp.data.length > 0 || mcp.nextCursor) throw new ProviderError("subscription-unverified")
  let environmentConnected = false
  const watch = rpc.subscribe((method) => {
    if (method === "thread/environment/connected") environmentConnected = true
  })
  let started: z.infer<typeof Started>
  try {
    started = Started.parse(
      await rpc.request("thread/start", {
        model: request.model,
        modelProvider: "openai",
        allowProviderModelFallback: false,
        ephemeral: true,
        cwd: rpc.cwd,
        runtimeWorkspaceRoots: [rpc.cwd],
        environments: [],
        dynamicTools: [],
        selectedCapabilityRoots: [],
        approvalPolicy: "never",
        sandbox: "read-only",
        baseInstructions:
          "Use only the supplied study content. Return the requested JSON. Do not use tools or external sources.",
        developerInstructions: "",
        config: {
          project_doc_max_bytes: 0,
          web_search: "disabled",
          "features.shell_tool": false,
          "features.code_mode": false,
          "features.multi_agent": false,
          "features.hooks": false,
          "features.plugins": false,
          "features.apps": false,
        },
      }),
    )
  } finally {
    watch()
  }
  if (
    environmentConnected ||
    started.cwd !== rpc.cwd ||
    started.model !== request.model ||
    started.modelProvider !== "openai" ||
    started.instructionSources.length > 0
  )
    throw new ProviderError("subscription-unverified")
  return new Promise<ProviderReceipt>((resolve, reject) => {
    let turnId: string | undefined
    let terminal: z.infer<typeof Terminal> | undefined
    const outputs = new Map<string, string>()
    let usage: ProviderReceipt["usage"] = { kind: "unknown" }
    let bytes = 0
    const fail = () => {
      unsubscribe()
      request.signal.removeEventListener("abort", fail)
      rpc.stop()
      reject(new ProviderError("outcome-unknown"))
    }
    const finish = () => {
      if (!turnId || !terminal || terminal.turn.id !== turnId) return
      unsubscribe()
      request.signal.removeEventListener("abort", fail)
      resolve(
        terminal.turn.status === "completed" && !rpc.clientRequestRejected
          ? { kind: "output", text: outputs.get(turnId) ?? "", usage, outputFormat }
          : {
              kind: "error",
              ...codexTerminalFailure(
                terminal.turn.error?.codexErrorInfo,
                rpc.clientRequestRejected,
              ),
              usage,
              outputFormat,
            },
      )
    }
    const unsubscribe = rpc.subscribe((method, raw) => {
      const event = z.object({ threadId: z.string() }).safeParse(raw)
      if (!event.success || event.data.threadId !== started.thread.id) return
      if (method === "item/completed") {
        const item = Item.safeParse(raw)
        if (item.success) {
          if (turnId && item.data.turnId !== turnId) return
          if (outputs.size >= 8 && !outputs.has(item.data.turnId)) {
            fail()
            return
          }
          bytes += Buffer.byteLength(item.data.item.text, "utf8")
          if (bytes > 128000) {
            fail()
            return
          }
          outputs.set(item.data.turnId, item.data.item.text)
        }
      }
      if (method === "thread/tokenUsage/updated") {
        const parsed = Usage.safeParse(raw)
        if (parsed.success) usage = { kind: "known", ...parsed.data.tokenUsage.last }
      }
      if (method === "turn/completed") {
        const parsed = Terminal.safeParse(raw)
        if (parsed.success) {
          terminal = parsed.data
          finish()
        }
      }
    })
    request.signal.addEventListener("abort", fail, { once: true })
    if (request.signal.aborted) {
      fail()
      return
    }
    void rpc.closed.then(fail)
    try {
      authorize()
    } catch (error) {
      unsubscribe()
      request.signal.removeEventListener("abort", fail)
      throw error
    }
    void rpc
      .request(
        "turn/start",
        { threadId: started.thread.id, ...localToolInput("chatgpt-subscription", request) },
        90000,
      )
      .then((value) => {
        turnId = z.object({ turn: z.object({ id: z.string().max(256) }) }).parse(value).turn.id
        finish()
      })
      .catch(fail)
  })
}
const Started = z.object({
  cwd: z.string(),
  thread: z.object({ id: z.string().max(256) }),
  model: z.string(),
  modelProvider: z.string(),
  instructionSources: z.array(z.string()),
  sandbox: z.object({ type: z.literal("readOnly") }),
})
const Item = z.object({
  turnId: z.string().max(256),
  item: z.object({ type: z.literal("agentMessage"), text: z.string() }),
})
const Terminal = z.object({
  turn: z.object({
    id: z.string(),
    status: z.string(),
    error: z.object({ codexErrorInfo: z.unknown().optional() }).nullish(),
  }),
})
const Usage = z.object({
  tokenUsage: z.object({
    last: z.object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    }),
  }),
})
