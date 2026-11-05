import { contentDigest } from "@reading-studio/contracts"
import { type LocalToolSession, rpcFrameObservation } from "@reading-studio/storage"
import { z } from "zod"
import type { StructuredRequest } from "./adapter.ts"
import { ProviderError } from "./catalog.ts"
import { codexTerminalFailure } from "./local-codex-error.ts"
import { codexOutputFormat, Item, Phase, Started, Terminal, Usage } from "./local-codex-schema.ts"
import { localToolInput } from "./local-tool-request.ts"
import type { ProviderReceipt } from "./provider-receipt.ts"

export async function dispatchLocalCodex(
  session: LocalToolSession,
  request: StructuredRequest,
  execution:
    | (() => void)
    | {
        readonly authorize: () => void
        readonly binding: string
        readonly maxFrameBytes: number
      },
): Promise<ProviderReceipt> {
  const wire =
    typeof execution === "function"
      ? {
          authorize: execution,
          binding: contentDigest(JSON.stringify(request)),
          maxFrameBytes: 32000,
        }
      : execution
  const { authorize } = wire
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
  const threadFrame = rpc.prepareRequest(
    "thread/start",
    {
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
    },
    wire.binding,
  )
  try {
    authorize()
    started = Started.parse(
      await rpc.requestPrepared(threadFrame, 30000, {
        maxBytes: wire.maxFrameBytes,
        expectedBinding: wire.binding,
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
  const turnFrame = rpc.prepareRequest(
    "turn/start",
    {
      threadId: started.thread.id,
      ...localToolInput("chatgpt-subscription", request),
    },
    wire.binding,
  )
  if (threadFrame.bytes + turnFrame.bytes > wire.maxFrameBytes)
    throw new ProviderError("input-limit")
  const appWire = {
    version: "app-rpc-frame-1" as const,
    layer: "app-server-stdin-frames" as const,
    frames: [rpcFrameObservation(threadFrame), rpcFrameObservation(turnFrame)],
    bytes: threadFrame.bytes + turnFrame.bytes,
    downstreamInput: "unmeasured" as const,
  }
  return new Promise<ProviderReceipt>((resolve, reject) => {
    let turnId: string | undefined
    let terminal: z.infer<typeof Terminal> | undefined
    const outputs = new Map<string, z.infer<typeof Item>["item"]>()
    const unsupportedPhases = new Set<string>()
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
      if (
        terminal.turn.status === "completed" &&
        !rpc.clientRequestRejected &&
        unsupportedPhases.has(turnId)
      ) {
        resolve({
          kind: "error",
          code: "protocol-error",
          diagnostic: "unsupported-message-phase",
          usage,
          outputFormat,
          appWire,
        })
        return
      }
      resolve(
        terminal.turn.status === "completed" && !rpc.clientRequestRejected
          ? { kind: "output", text: outputs.get(turnId)?.text ?? "", usage, outputFormat, appWire }
          : {
              kind: "error",
              ...codexTerminalFailure(
                terminal.turn.error?.codexErrorInfo,
                rpc.clientRequestRejected,
              ),
              usage,
              outputFormat,
              appWire,
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
          const phase = Phase.safeParse(item.data.item.phase)
          if (!phase.success) {
            unsupportedPhases.add(item.data.turnId)
            outputs.set(item.data.turnId, item.data.item)
            return
          }
          const phaseValue = phase.data
          switch (phaseValue) {
            case "final_answer":
              outputs.set(item.data.turnId, item.data.item)
              break
            case undefined:
            case null:
              if (outputs.get(item.data.turnId)?.phase !== "final_answer")
                outputs.set(item.data.turnId, item.data.item)
              break
            case "commentary":
            case "partial_answer":
              break
            default: {
              const unreachable: never = phaseValue
              throw new TypeError(`Unknown message phase: ${unreachable}`)
            }
          }
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
      .requestPrepared(turnFrame, 90000, {
        maxBytes: wire.maxFrameBytes - threadFrame.bytes,
        expectedBinding: wire.binding,
      })
      .then((value) => {
        turnId = z.object({ turn: z.object({ id: z.string().max(256) }) }).parse(value).turn.id
        finish()
      })
      .catch(fail)
  })
}
