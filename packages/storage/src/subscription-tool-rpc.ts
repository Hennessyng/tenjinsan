import { EventEmitter } from "node:events"
import { createInterface } from "node:readline"
import type { Writable } from "node:stream"
import type { LocalSubscriptionProvider } from "@reading-studio/contracts"
import { z } from "zod"
import { SubscriptionLoginError } from "./subscription-session-store.ts"
import { launchSubscriptionTool } from "./subscription-tool-launch.ts"

const Envelope = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
})
export class SubscriptionToolRpc {
  private readonly process
  private readonly lines
  private readonly input: Writable
  private readonly events = new EventEmitter()
  private readonly notices: { readonly method: string; readonly params: unknown }[] = []
  private readonly pending = new Map<
    number,
    { readonly resolve: (value: unknown) => void; readonly reject: (error: Error) => void }
  >()
  private nextId = 0
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
  ) {
    const launched = launchSubscriptionTool(home, provider)
    this.cwd = launched.cwd
    this.profileAllowed = launched.profileAllowed
    this.process = launched.child
    if (!this.process.stdin || !this.process.stdout)
      throw new SubscriptionLoginError("tool-unavailable")
    this.input = this.process.stdin
    this.closed = new Promise((resolve) =>
      this.process.once("close", () => {
        this.stop()
        resolve()
      }),
    )
    this.process.on("error", () => this.stop())
    this.process.stdin.on("error", () => this.stop())
    this.lines = createInterface({ input: this.process.stdout })
    this.lines.on("line", (line) => {
      try {
        if (line.length > 1_000_000) throw new SubscriptionLoginError("protocol-error")
        const event = Envelope.parse(JSON.parse(line))
        if (event.method && event.id !== undefined) {
          this.rejectedRequest = true
          this.input.write(
            `${JSON.stringify({ jsonrpc: "2.0", id: event.id, error: { code: -32601, message: "Client capabilities disabled" } })}\n`,
          )
        } else if (typeof event.id === "number") {
          const pending = this.pending.get(event.id)
          this.pending.delete(event.id)
          if (event.error !== undefined)
            pending?.reject(new SubscriptionLoginError("protocol-error"))
          else pending?.resolve(event.result)
        } else if (event.method) {
          this.events.emit("notification", event.method, event.params)
          if (event.method !== "account/login/completed") return
          if (this.notices.length >= 32) throw new SubscriptionLoginError("protocol-error")
          this.notices.push({ method: event.method, params: event.params })
          this.events.emit("notice")
        }
      } catch (error) {
        if (
          error instanceof SyntaxError ||
          error instanceof z.ZodError ||
          error instanceof SubscriptionLoginError
        )
          this.stop()
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
            throw new SubscriptionLoginError("protocol-error")
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
    if (this.stopped) return Promise.reject(new SubscriptionLoginError("tool-unavailable"))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.stop()
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
      this.input.write(
        `${JSON.stringify({ ...{ "chatgpt-subscription": {}, "grok-subscription": { jsonrpc: "2.0" } }[this.provider], id, method, params })}\n`,
      )
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
  stop(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.process.connected) this.process.send("stop", () => {})
    this.input.end()
    this.lines?.close()
    for (const pending of this.pending.values())
      pending.reject(new SubscriptionLoginError("tool-unavailable"))
    this.pending.clear()
    this.events.emit("stop")
  }
}
function assertNever(value: never): never {
  throw new TypeError(`Unexpected provider: ${value}`)
}
