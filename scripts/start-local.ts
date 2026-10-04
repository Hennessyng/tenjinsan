import { execFile } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import {
  assertLocalOwner,
  OwnerNotProvisionedError,
  ServerConfigError,
} from "@reading-studio/server/local-startup"
import {
  LocalConfigError,
  LocalDataPathError,
  parseLocalConfig,
  prepareLocalData,
} from "./local-config.ts"
import {
  assertLocalPortsAvailable,
  LocalChildError,
  type LocalChildren,
  LocalPortUnavailableError,
  startLocalChildren,
  stopLocalChildren,
  waitForChildExit,
  waitForLocalReadiness,
} from "./local-processes.ts"

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url))
const buildStudio = promisify(execFile)

type StopReason =
  | { readonly kind: "signal"; readonly signal: "SIGINT" | "SIGTERM" }
  | { readonly kind: "child-exit"; readonly child: "api" | "studio" | "worker" }

function waitForSignal(): Promise<Extract<StopReason, { readonly kind: "signal" }>> {
  return new Promise((resolveSignal) => {
    process.once("SIGINT", () => resolveSignal({ kind: "signal", signal: "SIGINT" }))
    process.once("SIGTERM", () => resolveSignal({ kind: "signal", signal: "SIGTERM" }))
  })
}

function waitForStop(
  children: LocalChildren,
  signal: Promise<Extract<StopReason, { readonly kind: "signal" }>>,
): Promise<StopReason> {
  const childExit = waitForChildExit(children).then(
    (child): StopReason => ({ kind: "child-exit", child }),
  )
  return Promise.race([signal, childExit])
}

function assertNever(value: never): never {
  throw new LocalChildError(`Unsupported local launcher state: ${String(value)}`)
}

function childPids(children: LocalChildren): Readonly<Record<keyof LocalChildren, number>> {
  const { api, studio, worker } = children
  if (api.pid === undefined || studio.pid === undefined || worker.pid === undefined) {
    throw new LocalChildError("Local process IDs are unavailable")
  }
  return { api: api.pid, studio: studio.pid, worker: worker.pid }
}

export async function runLocalLauncher(): Promise<void> {
  const config = parseLocalConfig(process.env, workspaceRoot)
  await prepareLocalData(config)
  assertLocalOwner(config.databasePath)
  await assertLocalPortsAvailable(config)
  await buildStudio(process.execPath, ["node_modules/vite/bin/vite.js", "build", "apps/studio"], {
    cwd: workspaceRoot,
  })
  const signal = waitForSignal()
  process.stdout.write(
    `LOCAL_EVENT ${JSON.stringify({ event: "local-starting", launcherPid: process.pid })}\n`,
  )
  const children = await startLocalChildren(config, workspaceRoot)

  try {
    const stop = waitForStop(children, signal)
    const startup = await Promise.race([
      waitForLocalReadiness(children, config).then(() => ({ kind: "ready" }) as const),
      stop,
    ])
    switch (startup.kind) {
      case "signal":
        return
      case "child-exit":
        throw new LocalChildError(`Local ${startup.child} exited before readiness`)
      case "ready":
        process.stdout.write(
          `LOCAL_EVENT ${JSON.stringify({
            event: "local-ready",
            launcherPid: process.pid,
            apiUrl: config.apiUrl,
            studioUrl: config.studioUrl,
            children: childPids(children),
          })}\n`,
        )
        break
      default:
        return assertNever(startup)
    }
    const reason = await stop
    switch (reason.kind) {
      case "signal":
        return
      case "child-exit":
        throw new LocalChildError(`Local ${reason.child} exited unexpectedly`)
      default:
        return assertNever(reason)
    }
  } finally {
    await stopLocalChildren(children)
    process.stdout.write(`LOCAL_EVENT ${JSON.stringify({ event: "local-stopped" })}\n`)
  }
}

function isExpectedStartupError(error: unknown): boolean {
  return (
    error instanceof LocalConfigError ||
    error instanceof LocalDataPathError ||
    error instanceof LocalPortUnavailableError ||
    error instanceof OwnerNotProvisionedError ||
    error instanceof ServerConfigError
  )
}

export async function executeLocalLauncher(): Promise<void> {
  try {
    await runLocalLauncher()
  } catch (error: unknown) {
    if (error instanceof OwnerNotProvisionedError) {
      process.stderr.write(`${error.name}: ${error.message}. Run bun run owner, then retry.\n`)
      process.exitCode = 2
      return
    }
    if (isExpectedStartupError(error) && error instanceof Error) {
      process.stderr.write(`${error.name}: ${error.message}\n`)
      process.exitCode = 2
      return
    }
    if (error instanceof Error) process.stderr.write(`${error.name}: ${error.message}\n`)
    else process.stderr.write("Local launcher failed.\n")
    process.exitCode = 1
  }
}

const executablePath = process.argv[1]
if (executablePath !== undefined && import.meta.url === pathToFileURL(executablePath).href) {
  await executeLocalLauncher()
}
