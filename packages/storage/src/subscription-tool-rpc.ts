import { EventEmitter } from "node:events"
import { createInterface } from "node:readline"
import type { Writable } from "node:stream"
import type { LocalSubscriptionProvider } from "@reading-studio/contracts"
import { z } from "zod"
import { SafeSignal, safeMethod } from "./protocol-observation.ts"
import { type PreparedRpcFrame, RpcFrameError, RpcFrameWriter } from "./rpc-frame.ts"
import { SubscriptionRpcFault } from "./subscription-rpc-fault.ts"
import { readRpcLine } from "./subscription-rpc-reader.ts"
import { SubscriptionRpcRejection } from "./subscription-rpc-rejection.ts"
import { SubscriptionRpcTrace } from "./subscription-rpc-trace.ts"
import { SubscriptionLoginError } from "./subscription-session-store.ts"
import { launchSubscriptionTool } from "./subscription-tool-launch.ts"

export class SubscriptionToolRpc {
  private readonly trace = new SubscriptionRpcTrace()
  get failure() {
    return this.trace.fault
  }
  observation() {
    return this.trace.snapshot()
  }
  private readonly process
  private readonly lines
  private readonly input: Writable
  private readonly events = new EventEmitter()
  private readonly notices: { readonly method: string; readonly params: unknown }[] = []
  private readonly pending = new Map<
    number,
    { readonly resolve: (value: unknown) => void; readonly reject: (error: Error) => void }
  >()
  private readonly writer: RpcFrameWriter
  private stopped = false
  get active(): boolean {
    return !this.stopped
  }
  readonly closed: Promise<void>
  readonly cwd: string
  readonly profileAllowed: () => boolean
  private rejectedRequest = false
  get clientRequestRejected(): boolean {
    return this.rejectedRequest
  }
  readonly authMethods = new Set<string>()
  constructor(
    home: string,
    readonly provider: LocalSubscriptionProvider = "chatgpt-subscription",
    syntheticOnly = false,
  ) {
    const launched = launchSubscriptionTool(home, provider, syntheticOnly)
    this.cwd = launched.cwd
    this.profileAllowed = launched.profileAllowed
    this.process = launched.child
    if (!this.process.stdin || !this.process.stdout)
      throw new SubscriptionLoginError("tool-unavailable")
    this.input = this.process.stdin
    this.writer = new RpcFrameWriter(provider, this.input)
    this.closed = new Promise((resolve) =>
      this.process.once("close", (code, signal) => {
        this.trace.closed = true
        this.trace.exitCode = code
        this.trace.signal = signal === null ? null : (SafeSignal.safeParse(signal).data ?? "other")
        this.stop(new SubscriptionRpcFault("process-closed"))
        resolve()
      }),
    )
    this.process.on("message", (raw) => this.trace.observeNative(raw))
    this.process.on("error", () => this.stop(new SubscriptionRpcFault("process-error")))
    this.process.stdin.on("error", () => this.stop(new SubscriptionRpcFault("stdin-error")))
    this.lines = createInterface({ input: this.process.stdout })
    this.lines.once("close", () => {
      this.trace.stdoutClosed = true
    })
    this.lines.on("line", (line) => {
      if (this.stopped) return
      try {
        const event = readRpcLine(line)
        if (event.method && event.id !== undefined) {
          this.rejectedRequest = true
          this.input.write(
            `${JSON.stringify({ jsonrpc: "2.0", id: event.id, error: { code: -32601, message: "Client capabilities disabled" } })}\n`,
          )
          this.stop(
            new SubscriptionRpcFault("server-request", undefined, {
              method: safeMethod(event.method),
            }),
          )
        } else if (typeof event.id === "number") {
          const pending = this.pending.get(event.id)
          if (!pending) throw new SubscriptionRpcFault("response-id")
          this.pending.delete(event.id)
          if (event.error !== undefined) pending?.reject(new SubscriptionRpcRejection(event.error))
          else pending?.resolve(event.result)
        } else if (event.method) {
          this.events.emit("notification", event.method, event.params)
          if (event.method !== "account/login/completed") return
          if (this.notices.length >= 32) throw new SubscriptionRpcFault("notice-overflow")
          this.notices.push({ method: event.method, params: event.params })
          this.events.emit("notice")
        }
      } catch (error) {
        if (
          error instanceof SyntaxError ||
          error instanceof z.ZodError ||
          error instanceof SubscriptionLoginError
        )
          this.stop(
            error instanceof SubscriptionRpcFault
              ? error
              : new SubscriptionRpcFault("envelope-invalid"),
          )
        else throw error
      }
    })
  }
  async initialize(): Promise<void> {
    switch (this.provider) {
      case "grok-subscription": {
        const initialized = z
          .object({
            authMethods: z.array(
              z.object({
                id: z.string(),
                _meta: z.object({ external_provider: z.boolean().optional() }).optional(),
              }),
            ),
          })
          .parse(
            await this.request("initialize", {
              protocolVersion: 1,
              clientInfo: { name: "tenjinsan_local", version: "1.0.0" },
              clientCapabilities: {
                fs: { readTextFile: false, writeTextFile: false },
                terminal: false,
              },
            }),
          )
        for (const method of initialized.authMethods) {
          if (method.id === "xai.api_key" || method._meta?.external_provider)
            throw new SubscriptionRpcFault("initialize-auth")
          this.authMethods.add(method.id)
        }
        return
      }
      case "chatgpt-subscription": {
        await this.request("initialize", {
          clientInfo: { name: "tenjinsan_local", version: "1.0.0" },
          capabilities: { experimentalApi: true },
        })
        this.input.write(`${JSON.stringify({ method: "initialized" })}\n`)
        return
      }
      default:
        return assertNever(this.provider)
    }
  }
  subscribe(listener: (method: string, params: unknown) => void): () => void {
    this.events.on("notification", listener)
    return () => {
      this.events.off("notification", listener)
    }
  }
  request(method: string, params: unknown, timeoutMs = 30000): Promise<unknown> {
    if (this.stopped) return Promise.reject(this.failure ?? new SubscriptionRpcFault("stopped"))
    return this.requestPrepared(this.prepareRequest(method, params), timeoutMs)
  }
  boundOutputBytes(maxBytes: number): () => void {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new SubscriptionRpcFault("raw-bound")
    let seen = 0
    const check = (chunk: Buffer) => {
      seen += chunk.length
      if (seen > maxBytes) this.stop(new SubscriptionRpcFault("raw-overflow"))
    }
    this.process.stdout?.prependListener("data", check)
    return () => {
      this.process.stdout?.off("data", check)
    }
  }
  prepareRequest(method: string, params: unknown, binding: string | null = null): PreparedRpcFrame {
    if (this.stopped) throw this.failure ?? new SubscriptionRpcFault("stopped")
    return this.writer.prepare(method, params, binding)
  }
  requestPrepared(
    frame: PreparedRpcFrame,
    timeoutMs = 30000,
    constraints: { readonly maxBytes?: number; readonly expectedBinding?: string | null } = {},
  ): Promise<unknown> {
    if (this.stopped) return Promise.reject(this.failure ?? new SubscriptionRpcFault("stopped"))
    try {
      this.writer.assertWritable(frame, constraints)
    } catch (error) {
      if (error instanceof Error) return Promise.reject(error)
      throw error
    }
    const id = frame.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.stop(new SubscriptionRpcFault("request-timeout"))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      try {
        this.writer.write(frame, constraints)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        if (error instanceof RpcFrameError) reject(error)
        else if (error instanceof Error)
          reject(this.trace.fail(new SubscriptionRpcFault("write-failed")))
        else throw error
      }
    })
  }
  completion(loginId: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const done = () => {
        this.events.off("notice", check)
        this.events.off("stop", stop)
      }
      const stop = () => {
        done()
        reject(new SubscriptionLoginError("login-failed"))
      }
      const check = () => {
        for (const notice of this.notices) {
          const parsed = z
            .object({ loginId: z.string().nullable(), success: z.boolean() })
            .safeParse(notice.params)
          if (parsed.success && parsed.data.loginId === loginId) {
            done()
            resolve(parsed.data.success)
            return
          }
        }
      }
      this.events.on("notice", check)
      this.events.once("stop", stop)
      if (this.stopped) stop()
      else check()
    })
  }
  stop(error = new SubscriptionRpcFault("stopped")): void {
    if (this.stopped) return
    const failure = this.trace.fail(error)
    this.stopped = true
    this.trace.stopped = true
    if (this.process.connected) this.process.send("stop", () => {})
    this.input.end()
    this.lines?.close()
    for (const pending of this.pending.values()) pending.reject(failure)
    this.pending.clear()
    this.events.emit("stop")
  }
}
function assertNever(value: never): never {
  throw new TypeError(`Unexpected provider: ${value}`)
}
