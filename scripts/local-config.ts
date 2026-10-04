import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { parseServerConfig, type ServerConfig } from "@reading-studio/server/local-startup"
import { z } from "zod"

const loopbackHost = "127.0.0.1" as const

const localEnvironmentSchema = z.object({
  PRIVATE_DATA_ROOT: z.string().trim().min(1),
  STUDIO_PORT: z.coerce.number().int().min(1).max(65_535),
})

export type LocalConfig = {
  readonly apiUrl: string
  readonly databasePath: string
  readonly host: typeof loopbackHost
  readonly privateDataRoot: string
  readonly serverPort: number
  readonly studioPort: number
  readonly studioUrl: string
}

export class LocalConfigError extends Error {
  override readonly name = "LocalConfigError"
}

export class LocalDataPathError extends Error {
  override readonly name = "LocalDataPathError"

  constructor(
    readonly field: "DATABASE_PATH" | "PRIVATE_DATA_ROOT",
    path: string,
    cause?: unknown,
  ) {
    super(`${field} is not a writable private path: ${path}`, { cause })
  }
}

function assertLoopback(server: ServerConfig, studioPort: number): void {
  const authBaseUrl = new URL(server.authBaseURL)
  const expectedApiOrigin = `http://${loopbackHost}:${server.port}`
  if (server.host !== loopbackHost) {
    throw new LocalConfigError(`SERVER_HOST must be ${loopbackHost} for local startup`)
  }
  if (authBaseUrl.origin !== expectedApiOrigin) {
    throw new LocalConfigError(`AUTH_BASE_URL must be ${expectedApiOrigin} for local startup`)
  }
  if (server.trustProxy) {
    throw new LocalConfigError("TRUST_PROXY must be 0 for local startup")
  }
  if (server.trustedOrigins.length !== 1 || server.trustedOrigins[0] !== expectedApiOrigin) {
    throw new LocalConfigError(`TRUSTED_ORIGINS must contain only ${expectedApiOrigin}`)
  }
  if (server.port === studioPort) {
    throw new LocalConfigError("SERVER_PORT and STUDIO_PORT must be different")
  }
}

export function parseLocalConfig(
  environment: NodeJS.ProcessEnv,
  workspaceRoot: string,
): LocalConfig {
  const server = parseServerConfig(environment)
  const local = localEnvironmentSchema.safeParse(environment)
  if (!local.success) {
    const fields = local.error.issues
      .map((issue) => issue.path[0])
      .filter((field): field is string => typeof field === "string")
      .toSorted()
    throw new LocalConfigError(`Invalid local configuration: ${fields.join(", ")}`)
  }
  assertLoopback(server, local.data.STUDIO_PORT)
  return {
    apiUrl: `http://${loopbackHost}:${server.port}`,
    databasePath: resolve(workspaceRoot, server.databasePath),
    host: loopbackHost,
    privateDataRoot: resolve(workspaceRoot, local.data.PRIVATE_DATA_ROOT),
    serverPort: server.port,
    studioPort: local.data.STUDIO_PORT,
    studioUrl: `http://${loopbackHost}:${local.data.STUDIO_PORT}`,
  }
}

async function assertWritableDirectory(
  path: string,
  field: LocalDataPathError["field"],
  rejectSymlink: boolean,
): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700, recursive: true })
    const status = await lstat(path)
    if (!status.isDirectory() || (rejectSymlink && status.isSymbolicLink())) {
      throw new LocalDataPathError(field, path)
    }
    const probe = await mkdtemp(join(path, ".local-write-"))
    await rm(probe, { recursive: true })
  } catch (error: unknown) {
    if (error instanceof LocalDataPathError) throw error
    throw new LocalDataPathError(field, path, error)
  }
}

export async function prepareLocalData(config: LocalConfig): Promise<void> {
  await assertWritableDirectory(dirname(config.databasePath), "DATABASE_PATH", false)
  await assertWritableDirectory(config.privateDataRoot, "PRIVATE_DATA_ROOT", true)
}
