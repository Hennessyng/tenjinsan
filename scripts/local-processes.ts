import type { ChildProcess } from "node:child_process"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { get } from "node:http"
import { createServer } from "node:net"
import { setTimeout as delay } from "node:timers/promises"
import type { LocalConfig } from "./local-config.ts"

const childNames = ["api", "studio", "worker"] as const
type ChildName = (typeof childNames)[number]
export type LocalChildren = Readonly<Record<ChildName, ChildProcess>>

export class LocalPortUnavailableError extends Error {
  override readonly name = "LocalPortUnavailableError"

  constructor(service: "API" | "studio", port: number) {
    super(`${service} port ${port} is already in use on 127.0.0.1`)
  }
}

export class LocalChildError extends Error {
  override readonly name = "LocalChildError"

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EADDRINUSE"
}

async function assertPortAvailable(service: "API" | "studio", port: number): Promise<void> {
  const server = createServer()
  try {
    server.listen({ exclusive: true, host: "127.0.0.1", port })
    await once(server, "listening", { signal: AbortSignal.timeout(5_000) })
  } catch (error: unknown) {
    if (isAddressInUse(error)) throw new LocalPortUnavailableError(service, port)
    throw error
  } finally {
    if (server.listening) {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error === undefined) resolveClose()
          else rejectClose(error)
        })
      })
    }
  }
}

export async function assertLocalPortsAvailable(config: LocalConfig): Promise<void> {
  await Promise.all([
    assertPortAvailable("API", config.serverPort),
    assertPortAvailable("studio", config.studioPort),
  ])
}

type ChildCommand = {
  readonly name: ChildName
  readonly args: readonly string[]
}

function childCommands(config: LocalConfig): readonly ChildCommand[] {
  return [
    {
      name: "api",
      args: ["--experimental-transform-types", "apps/server/src/index.ts"],
    },
    {
      name: "worker",
      args: ["--experimental-transform-types", "apps/worker/src/index.ts"],
    },
    {
      name: "studio",
      args: [
        "node_modules/vite/bin/vite.js",
        "apps/studio",
        "--host",
        config.host,
        "--port",
        String(config.studioPort),
        "--strictPort",
      ],
    },
  ]
}

async function spawnChild(
  command: ChildCommand,
  config: LocalConfig,
  workspaceRoot: string,
): Promise<ChildProcess> {
  const child = spawn(process.execPath, command.args, {
    cwd: workspaceRoot,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      DATABASE_PATH: config.databasePath,
      PRIVATE_DATA_ROOT: config.privateDataRoot,
    },
    stdio: "inherit",
  })
  try {
    await once(child, "spawn", { signal: AbortSignal.timeout(5_000) })
  } catch (error: unknown) {
    throw new LocalChildError(`Unable to start local ${command.name}`, { cause: error })
  }
  if (child.pid === undefined) throw new LocalChildError(`Local ${command.name} has no process ID`)
  process.stdout.write(
    `LOCAL_EVENT ${JSON.stringify({ event: "local-child-started", name: command.name, pid: child.pid })}\n`,
  )
  return child
}

export async function startLocalChildren(
  config: LocalConfig,
  workspaceRoot: string,
): Promise<LocalChildren> {
  const started = new Map<ChildName, ChildProcess>()
  try {
    for (const command of childCommands(config)) {
      started.set(command.name, await spawnChild(command, config, workspaceRoot))
    }
  } catch (error: unknown) {
    await stopLocalChildren(Object.fromEntries(started))
    throw error
  }
  const api = started.get("api")
  const studio = started.get("studio")
  const worker = started.get("worker")
  if (api === undefined || studio === undefined || worker === undefined) {
    await stopLocalChildren(Object.fromEntries(started))
    throw new LocalChildError("Local process set is incomplete")
  }
  return { api, studio, worker }
}

function endpointReady(url: string): Promise<boolean> {
  return new Promise((resolveReady) => {
    const request = get(url, { signal: AbortSignal.timeout(1_000) }, (response) => {
      response.resume()
      resolveReady(response.statusCode !== undefined && response.statusCode < 500)
    })
    request.once("error", () => resolveReady(false))
  })
}

function assertChildrenRunning(children: LocalChildren): void {
  for (const name of childNames) {
    const child = children[name]
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new LocalChildError(`Local ${name} exited before readiness`)
    }
  }
}

export async function waitForLocalReadiness(
  children: LocalChildren,
  config: LocalConfig,
): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    assertChildrenRunning(children)
    const [apiReady, studioReady] = await Promise.all([
      endpointReady(`${config.apiUrl}/health`),
      endpointReady(config.studioUrl),
    ])
    if (apiReady && studioReady) return
    await delay(50)
  }
  throw new LocalChildError("Local readiness timed out")
}

export async function waitForChildExit(children: LocalChildren): Promise<ChildName> {
  for (const name of childNames) {
    const child = children[name]
    if (child.exitCode !== null || child.signalCode !== null) return name
  }
  return Promise.race(
    childNames.map(async (name) => {
      await once(children[name], "close")
      return name
    }),
  )
}

function signalChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  try {
    if (process.platform === "win32") child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error
  }
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const closed = once(child, "close")
  signalChild(child, "SIGTERM")
  const outcome = await Promise.race([
    closed.then(() => "closed" as const),
    delay(5_000, "timeout"),
  ])
  if (outcome === "timeout") {
    signalChild(child, "SIGKILL")
    await closed
  }
}

export async function stopLocalChildren(children: Partial<LocalChildren>): Promise<void> {
  await Promise.all(
    childNames
      .map((name) => children[name])
      .filter((child) => child !== undefined)
      .map(stopChild),
  )
}
