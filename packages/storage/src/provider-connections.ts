import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { z } from "zod"

const Envelope = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
})
export class CodexConnectionError extends Error {
  override readonly name = "CodexConnectionError"
  constructor() {
    super("Official Codex route unavailable")
  }
}
export class CodexSession {
  private nextId = 0
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  private readonly listeners = new Set<(method: string, params: unknown) => void>()
  private readonly process
  private readonly lines
  private closed = false
  constructor(home: string) {
    const cwd = join(home, "workspace")
    mkdirSync(cwd, { recursive: true, mode: 0o700 })
    this.process = spawn(
      process.env["STUDIO_CODEX_BINARY"] ?? "codex",
      [
        "app-server",
        "-c",
        'cli_auth_credentials_store="file"',
        "-c",
        "features.shell_tool=false",
        "-c",
        'web_search="disabled"',
      ],
      {
        cwd,
        stdio: ["pipe", "pipe", "ignore"],
        env: { PATH: process.env["PATH"], HOME: home, CODEX_HOME: home },
      },
    )
    this.lines = createInterface({ input: this.process.stdout })
    this.process.on("error", () => this.close())
    this.process.on("exit", () => this.close())
    this.process.stdin.on("error", () => this.close())
    this.lines.on("line", (line) => {
      try {
        const message = Envelope.parse(JSON.parse(line))
        if (typeof message.id === "number" && !message.method) {
          const pending = this.pending.get(message.id)
          this.pending.delete(message.id)
          if (message.error !== undefined) pending?.reject(new CodexConnectionError())
          else pending?.resolve(message.result)
        } else if (message.method && message.id !== undefined) {
          this.process.stdin.write(
            `${JSON.stringify({ id: message.id, error: { code: -32601, message: "Tools are not permitted" } })}\n`,
          )
        } else if (message.method) {
          for (const listener of this.listeners) listener(message.method, message.params)
        }
      } catch (error) {
        if (error instanceof Error) this.close()
        else throw error
      }
    })
  }
  async initialize(): Promise<void> {
    await this.request("initialize", { clientInfo: { name: "reading_studio", version: "1.0.0" } })
    this.process.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`)
  }
  request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new CodexConnectionError())
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new CodexConnectionError())
        this.close()
      }, 30_000)
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
      this.process.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }
  subscribe(listener: (method: string, params: unknown) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    this.lines.close()
    this.process.kill()
    for (const pending of this.pending.values()) pending.reject(new CodexConnectionError())
    this.pending.clear()
  }
}
export class CodexConnection {
  private login: CodexSession | undefined
  private loginTimer: ReturnType<typeof setTimeout> | undefined
  constructor(private readonly home: string) {}
  async open(): Promise<CodexSession> {
    if (!existsSync(join(this.home, "authorized"))) throw new CodexConnectionError()
    const session = new CodexSession(this.home)
    try {
      await session.initialize()
      return session
    } catch (error) {
      session.close()
      throw error
    }
  }
  async connect(): Promise<{ authUrl: string }> {
    if (this.login) throw new CodexConnectionError()
    mkdirSync(this.home, { recursive: true, mode: 0o700 })
    const session = new CodexSession(this.home)
    this.login = session
    try {
      await session.initialize()
      const result = z
        .object({ authUrl: z.url() })
        .parse(await session.request("account/login/start", { type: "chatgpt" }))
      const url = new URL(result.authUrl)
      if (url.protocol !== "https:" || url.hostname !== "auth.openai.com")
        throw new CodexConnectionError()
      writeFileSync(join(this.home, "authorized"), "pending", { mode: 0o600 })
      session.subscribe((method) => {
        if (method === "account/login/completed") this.close()
      })
      this.loginTimer = setTimeout(() => this.close(), 300_000)
      return result
    } catch (error) {
      this.close()
      throw error
    }
  }
  async disconnect(): Promise<void> {
    this.close()
    rmSync(join(this.home, "authorized"), { force: true })
    rmSync(join(this.home, "auth.json"), { force: true })
  }
  async models(): Promise<readonly { provider: "codex"; model: string; label: string }[]> {
    const session = await this.open()
    try {
      const account = z
        .object({ account: z.object({ type: z.literal("chatgpt") }) })
        .safeParse(await session.request("account/read", { refreshToken: true }))
      if (!account.success) throw new CodexConnectionError()
      const choices: { provider: "codex"; model: string; label: string }[] = []
      let cursor: string | null = null
      do {
        const page = z
          .object({
            data: z.array(
              z.object({
                model: z.string(),
                displayName: z.string(),
                hidden: z.boolean().optional(),
              }),
            ),
            nextCursor: z.string().nullable(),
          })
          .parse(await session.request("model/list", { cursor, limit: 100 }))
        choices.push(
          ...page.data
            .filter((model) => !model.hidden)
            .map((model) => ({
              provider: "codex" as const,
              model: model.model,
              label: `Codex / ${model.displayName}`,
            })),
        )
        cursor = page.nextCursor
      } while (cursor)
      return choices
    } finally {
      session.close()
    }
  }
  close(): void {
    clearTimeout(this.loginTimer)
    this.login?.close()
    this.login = undefined
  }
}
export class ProviderConnections {
  private readonly connections = new Map<string, CodexConnection>()
  constructor(private readonly root: string) {}
  codex(ownerId: string, installationId: string): CodexConnection {
    const key = createHash("sha256")
      .update(JSON.stringify([ownerId, installationId]))
      .digest("hex")
    let connection = this.connections.get(key)
    if (!connection) {
      connection = new CodexConnection(join(this.root, "provider-connections", key))
      this.connections.set(key, connection)
    }
    return connection
  }
  close(): void {
    for (const connection of this.connections.values()) connection.close()
  }
}
