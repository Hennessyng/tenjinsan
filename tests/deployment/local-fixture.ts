import type { ChildProcessByStdio } from "node:child_process"
import { spawn } from "node:child_process"
import { EventEmitter, once } from "node:events"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { Readable } from "node:stream"
import { z } from "zod"

type LauncherChild = ChildProcessByStdio<null, Readable, Readable>

const readyEventSchema = z.object({
  event: z.literal("local-ready"),
  launcherPid: z.number().int().positive(),
  apiUrl: z.url(),
  studioUrl: z.url(),
  children: z.object({
    api: z.number().int().positive(),
    studio: z.number().int().positive(),
    worker: z.number().int().positive(),
  }),
})

const startedEventSchema = z.object({
  event: z.literal("local-child-started"),
  name: z.enum(["api", "studio", "worker"]),
  pid: z.number().int().positive(),
})

const startingEventSchema = z.object({
  event: z.literal("local-starting"),
  launcherPid: z.number().int().positive(),
})

export type LocalReadyEvent = z.infer<typeof readyEventSchema>

export type LocalFixture = {
  readonly directory: string
  readonly environment: NodeJS.ProcessEnv
  readonly apiPort: number
  readonly studioPort: number
}

export const workspaceRoot = resolve(import.meta.dirname, "../..")
const authSecret = "deployment-secret-with-at-least-thirty-two-characters"
const ownerEmail = "owner@example.test"
const ownerName = "Studio Owner"
const ownerPassword = "correct horse battery staple"

async function listeningServer(port: number): Promise<Server> {
  const server = createServer()
  server.listen(port, "127.0.0.1")
  await once(server, "listening", { signal: AbortSignal.timeout(5_000) })
  return server
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error === undefined) resolveClose()
      else rejectClose(error)
    })
  })
}

async function allocatePorts(): Promise<readonly [number, number]> {
  const first = await listeningServer(0)
  const second = await listeningServer(0)
  const firstAddress = first.address()
  const secondAddress = second.address()
  if (
    firstAddress === null ||
    typeof firstAddress === "string" ||
    secondAddress === null ||
    typeof secondAddress === "string"
  ) {
    throw new TypeError("Unable to allocate local deployment ports")
  }
  await Promise.all([closeServer(first), closeServer(second)])
  return [firstAddress.port, secondAddress.port]
}

export async function occupyPort(port: number): Promise<Server> {
  return listeningServer(port)
}

export async function releasePort(server: Server): Promise<void> {
  await closeServer(server)
}

async function provisionFixtureOwner(environment: NodeJS.ProcessEnv): Promise<void> {
  const child = spawn(
    process.execPath,
    ["--experimental-transform-types", "apps/server/src/testing/provision-owner-fixture.ts"],
    {
      cwd: workspaceRoot,
      env: {
        ...environment,
        OWNER_EMAIL: ownerEmail,
        OWNER_NAME: ownerName,
        OWNER_PASSWORD: ownerPassword,
      },
      stdio: "ignore",
    },
  )
  const exitCode = await new Promise<number | null>((resolveExit) => {
    child.once("close", resolveExit)
  })
  if (exitCode !== 0) throw new TypeError(`Owner fixture exited with code ${exitCode}`)
}

export async function makeLocalFixture(provisionOwner: boolean): Promise<LocalFixture> {
  const directory = await mkdtemp(join(tmpdir(), "reading studio local "))
  const [apiPort, studioPort] = await allocatePorts()
  const dataRoot = join(directory, "private data")
  const databasePath = join(dataRoot, "studio.sqlite")
  const privateDataRoot = join(dataRoot, "library files")
  await mkdir(privateDataRoot, { mode: 0o700, recursive: true })

  const environment = {
    ...process.env,
    AUTH_BASE_URL: `http://127.0.0.1:${apiPort}`,
    AUTH_SECRET: authSecret,
    DATABASE_PATH: databasePath,
    PRIVATE_DATA_ROOT: privateDataRoot,
    SERVER_HOST: "127.0.0.1",
    SERVER_PORT: String(apiPort),
    STUDIO_PORT: String(studioPort),
    TRUSTED_ORIGINS: `http://127.0.0.1:${apiPort}`,
    TRUST_PROXY: "0",
  }
  if (provisionOwner) await provisionFixtureOwner(environment)

  return {
    directory,
    apiPort,
    studioPort,
    environment,
  }
}

export async function removeLocalFixture(fixture: LocalFixture): Promise<void> {
  await rm(fixture.directory, { force: true, recursive: true })
}

export class LocalLauncher {
  readonly child: LauncherChild
  readonly #outputEvents = new EventEmitter()
  #output = ""

  constructor(environment: NodeJS.ProcessEnv) {
    this.child = spawn("bun", ["run", "start:local"], {
      cwd: workspaceRoot,
      detached: true,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const capture = (chunk: Buffer): void => {
      this.#output += chunk.toString("utf8")
      this.#outputEvents.emit("changed")
    }
    this.child.stdout.on("data", capture)
    this.child.stderr.on("data", capture)
  }

  get output(): string {
    return this.#output
  }

  async waitForOutput(text: string): Promise<void> {
    if (this.#output.includes(text)) return
    await new Promise<void>((resolveOutput, rejectOutput) => {
      const timeout = setTimeout(
        () => finish(new Error(`Timed out waiting for ${text}:\n${this.#output}`)),
        20_000,
      )
      const onChanged = (): void => {
        if (this.#output.includes(text)) finish()
      }
      const onClose = (): void =>
        finish(new Error(`Launcher exited before ${text}:\n${this.#output}`))
      const finish = (error?: Error): void => {
        clearTimeout(timeout)
        this.#outputEvents.off("changed", onChanged)
        this.child.off("close", onClose)
        if (error === undefined) resolveOutput()
        else rejectOutput(error)
      }
      this.#outputEvents.on("changed", onChanged)
      this.child.once("close", onClose)
    })
  }

  async ready(): Promise<LocalReadyEvent> {
    await this.waitForOutput('"event":"local-ready"')
    const line = this.#output
      .split("\n")
      .find(
        (candidate) => candidate.startsWith("LOCAL_EVENT ") && candidate.includes("local-ready"),
      )
    if (line === undefined) throw new TypeError("Local readiness event is missing")
    return readyEventSchema.parse(JSON.parse(line.slice("LOCAL_EVENT ".length)))
  }

  startedPids(): readonly number[] {
    return this.#output
      .split("\n")
      .filter((line) => line.startsWith("LOCAL_EVENT ") && line.includes("local-child-started"))
      .map((line) => startedEventSchema.parse(JSON.parse(line.slice("LOCAL_EVENT ".length))).pid)
  }

  startingPid(): number {
    const line = this.#output
      .split("\n")
      .find(
        (candidate) => candidate.startsWith("LOCAL_EVENT ") && candidate.includes("local-starting"),
      )
    if (line === undefined) throw new TypeError("Local starting event is missing")
    return startingEventSchema.parse(JSON.parse(line.slice("LOCAL_EVENT ".length))).launcherPid
  }

  async waitForExit(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return
    await once(this.child, "close", { signal: AbortSignal.timeout(20_000) })
  }

  async stop(launcherPid: number): Promise<void> {
    process.kill(launcherPid, "SIGTERM")
    await this.waitForOutput('"event":"local-stopped"')
    await this.waitForExit()
  }

  forceStop(): void {
    if (
      this.child.exitCode === null &&
      this.child.signalCode === null &&
      this.child.pid !== undefined
    ) {
      try {
        process.kill(-this.child.pid, "SIGKILL")
      } catch (error: unknown) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error
      }
    }
    for (const pid of this.startedPids()) {
      try {
        process.kill(-pid, "SIGKILL")
      } catch (error: unknown) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error
      }
    }
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false
    throw error
  }
}
