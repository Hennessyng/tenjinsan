import { createHash } from "node:crypto"
import type { Writable } from "node:stream"
import type { LocalSubscriptionProvider } from "@reading-studio/contracts"

export const APP_RPC_FRAME_VERSION = "app-rpc-frame-1" as const
export type PreparedRpcFrame = Readonly<{
  version: typeof APP_RPC_FRAME_VERSION
  provider: LocalSubscriptionProvider
  id: number
  method: string
  binding: string | null
  serialized: string
  bytes: number
  sha256: string
}>
export class RpcFrameError extends Error {
  override readonly name = "RpcFrameError"
  constructor(readonly code: "invalid-frame" | "frame-limit") {
    super(code)
  }
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex")
export function serializeRpcFrame(input: {
  readonly provider: LocalSubscriptionProvider
  readonly id: number
  readonly method: string
  readonly params: unknown
  readonly binding?: string | null
}): PreparedRpcFrame {
  const { provider, id, method, params, binding = null } = input
  if (
    !Number.isSafeInteger(id) ||
    id < 1 ||
    !method ||
    (binding !== null && !/^[a-f0-9]{64}$/u.test(binding))
  )
    throw new RpcFrameError("invalid-frame")
  const serialized = `${JSON.stringify({ ...{ "chatgpt-subscription": {}, "grok-subscription": { jsonrpc: "2.0" } }[provider], id, method, params })}\n`
  return Object.freeze({
    version: APP_RPC_FRAME_VERSION,
    provider,
    id,
    method,
    binding,
    serialized,
    bytes: Buffer.byteLength(serialized, "utf8"),
    sha256: digest(serialized),
  })
}
export class RpcFrameWriter {
  private nextId: number
  private readonly owned = new WeakSet<PreparedRpcFrame>()
  constructor(
    private readonly provider: LocalSubscriptionProvider,
    private readonly input: Writable,
    initialId = 0,
  ) {
    this.nextId = initialId
  }
  prepare(method: string, params: unknown, binding: string | null = null): PreparedRpcFrame {
    const frame = serializeRpcFrame({
      provider: this.provider,
      id: ++this.nextId,
      method,
      params,
      binding,
    })
    this.owned.add(frame)
    return frame
  }
  assertWritable(
    frame: PreparedRpcFrame,
    constraints: { readonly maxBytes?: number; readonly expectedBinding?: string | null } = {},
  ): void {
    if (
      !this.owned.has(frame) ||
      frame.provider !== this.provider ||
      frame.version !== APP_RPC_FRAME_VERSION ||
      digest(frame.serialized) !== frame.sha256 ||
      Buffer.byteLength(frame.serialized, "utf8") !== frame.bytes ||
      (constraints.expectedBinding !== undefined && constraints.expectedBinding !== frame.binding)
    )
      throw new RpcFrameError("invalid-frame")
    if (
      constraints.maxBytes !== undefined &&
      (!Number.isSafeInteger(constraints.maxBytes) ||
        constraints.maxBytes < 0 ||
        frame.bytes > constraints.maxBytes)
    )
      throw new RpcFrameError("frame-limit")
  }
  write(
    frame: PreparedRpcFrame,
    constraints: { readonly maxBytes?: number; readonly expectedBinding?: string | null } = {},
  ): void {
    this.assertWritable(frame, constraints)
    this.owned.delete(frame)
    this.input.write(frame.serialized, "utf8")
  }
}
export function rpcFrameObservation(frame: PreparedRpcFrame) {
  return {
    version: frame.version,
    layer: "app-server-stdin-frame" as const,
    id: frame.id,
    method: frame.method,
    bytes: frame.bytes,
    sha256: frame.sha256,
    binding: frame.binding,
    downstreamInput: "unmeasured" as const,
  }
}
