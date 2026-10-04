import type { ChildProcessByStdio } from "node:child_process"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { Readable } from "node:stream"
import { openAuthStorage } from "@reading-studio/storage"
import { afterEach, describe, expect, it } from "vitest"
import { createOwnerAuth } from "./auth/auth.ts"
import { createOwnerService } from "./auth/owner.ts"

type ServerProcess = ChildProcessByStdio<null, Readable, Readable>

type ServerResult = {
  readonly body: unknown
  readonly status: number
}

class ServerStartError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ServerStartError"
  }
}

const workspaceRoot = resolve(import.meta.dirname, "../../..")
const authSecret = "test-secret-with-at-least-thirty-two-characters"
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

async function makeTemporaryWorkspace(provisionOwner = true, port = 8787): Promise<string> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "reading-studio-startup-"))
  temporaryDirectories.push(temporaryRoot)
  await mkdir(join(temporaryRoot, "apps"), { recursive: true })
  await mkdir(join(temporaryRoot, "apps/studio/dist/assets"), { recursive: true })
  await writeFile(
    join(temporaryRoot, "apps/studio/dist/index.html"),
    '<!doctype html><div id="root"></div>',
  )
  await writeFile(
    join(temporaryRoot, "apps/studio/dist/favicon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  )
  await writeFile(
    join(temporaryRoot, "package.json"),
    await readFile(join(workspaceRoot, "package.json"), "utf8"),
  )
  const databasePath = join(temporaryRoot, "data", "studio.sqlite")
  const environmentFile = (await readFile(join(workspaceRoot, ".env.example"), "utf8"))
    .replace("AUTH_SECRET=", `AUTH_SECRET=${authSecret}`)
    .replace("AUTH_BASE_URL=http://127.0.0.1:8787", `AUTH_BASE_URL=http://127.0.0.1:${port}`)
    .replace("TRUSTED_ORIGINS=http://127.0.0.1:8787", `TRUSTED_ORIGINS=http://127.0.0.1:${port}`)
    .replace("DATABASE_PATH=data/studio.sqlite", `DATABASE_PATH=${databasePath}`)
    .replace("SERVER_PORT=8787", `SERVER_PORT=${port}`)
  await writeFile(join(temporaryRoot, ".env"), environmentFile)
  await cp(join(workspaceRoot, "apps/server"), join(temporaryRoot, "apps/server"), {
    recursive: true,
    filter: (source) => !source.endsWith("node_modules") && !source.endsWith(".tsbuildinfo"),
  })
  await symlink(
    join(workspaceRoot, "apps/server/node_modules"),
    join(temporaryRoot, "apps/server/node_modules"),
    "dir",
  )
  if (provisionOwner) {
    const storage = openAuthStorage(databasePath)
    const auth = createOwnerAuth(storage, {
      baseURL: `http://127.0.0.1:${port}`,
      secret: authSecret,
      sessionExpiresIn: 60 * 60,
    })
    await createOwnerService(storage, auth).provision({
      email: "owner@example.test",
      name: "Studio Owner",
      password: "correct horse battery staple",
    })
    storage.close()
  }
  return temporaryRoot
}

function waitForReadiness(child: ServerProcess): Promise<void> {
  return new Promise((resolveReadiness, rejectReadiness) => {
    let output = ""
    const timeout = setTimeout(() => {
      rejectReadiness(new ServerStartError(`Server readiness timed out:\n${output}`))
    }, 10_000)
    const finish = (): void => {
      clearTimeout(timeout)
      child.stdout.off("data", onData)
      child.stderr.off("data", onData)
      child.off("exit", onExit)
    }
    const onData = (chunk: Buffer): void => {
      output += chunk.toString("utf8")
      if (output.includes("Reading studio API listening")) {
        finish()
        resolveReadiness()
      } else if (
        output.includes("ServerConfigError") ||
        output.includes("OwnerNotProvisionedError")
      ) {
        finish()
        rejectReadiness(new ServerStartError(`Server configuration failed:\n${output}`))
      }
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish()
      rejectReadiness(
        new ServerStartError(`Server exited before readiness (${code ?? signal}):\n${output}`),
      )
    }
    child.stdout.on("data", onData)
    child.stderr.on("data", onData)
    child.once("exit", onExit)
  })
}

async function stopServer(child: ServerProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) {
    return
  }
  process.kill(-child.pid, "SIGTERM")
  await once(child, "exit", { signal: AbortSignal.timeout(5_000) })
}

async function getAvailablePort(): Promise<number> {
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening", { signal: AbortSignal.timeout(5_000) })
  const address = server.address()
  if (address === null || typeof address === "string") {
    throw new ServerStartError("Unable to allocate a test port")
  }
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error === undefined) {
        resolveClose()
      } else {
        rejectClose(error)
      }
    })
  })
  return address.port
}

async function runDocumentedServer(
  command: readonly string[],
  port: number,
  environmentOverrides: NodeJS.ProcessEnv = {},
): Promise<ServerResult> {
  const temporaryRoot = await makeTemporaryWorkspace(true, port)
  const environment = { ...process.env, ...environmentOverrides }
  const { SERVER_HOST: inheritedHost, SERVER_PORT: inheritedPort } = environmentOverrides
  if (inheritedHost === undefined) {
    Reflect.deleteProperty(environment, "SERVER_HOST")
  }
  if (inheritedPort === undefined) {
    Reflect.deleteProperty(environment, "SERVER_PORT")
  }
  const child = spawn("bun", command, {
    cwd: temporaryRoot,
    detached: true,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"] as const,
  })

  try {
    await waitForReadiness(child)
    const response = await fetch(`http://127.0.0.1:${port}/health`)
    return { body: await response.json(), status: response.status }
  } finally {
    await stopServer(child)
  }
}

async function runUnprovisionedServer(): Promise<string> {
  const temporaryRoot = await makeTemporaryWorkspace(false, await getAvailablePort())
  const child = spawn("bun", ["run", "--cwd", "apps/server", "start"], {
    cwd: temporaryRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"] as const,
  })
  let output = ""
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8")
  })
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8")
  })
  await once(child, "exit", { signal: AbortSignal.timeout(10_000) })
  return output
}

describe("documented server startup", () => {
  it("loads a copied root .env without injected server variables", async () => {
    const port = await getAvailablePort()
    const result = await runDocumentedServer(["run", "dev:server"], port)

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ status: "ok" })
  }, 15_000)

  it("loads the same root .env through the workspace start command", async () => {
    const port = await getAvailablePort()
    const result = await runDocumentedServer(["run", "--cwd", "apps/server", "start"], port)

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ status: "ok" })
  }, 15_000)

  it("keeps inherited environment values ahead of the root file", async () => {
    const port = await getAvailablePort()
    const result = await runDocumentedServer(["run", "--cwd", "apps/server", "start"], port, {
      SERVER_PORT: String(port),
    })

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ status: "ok" })
  }, 15_000)

  it("exits before listening when the owner has not been provisioned", async () => {
    const output = await runUnprovisionedServer()

    expect(output).toContain("OwnerNotProvisionedError")
    expect(output).not.toContain("Reading studio API listening")
  })
})
