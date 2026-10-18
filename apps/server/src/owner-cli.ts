import { openAuthStorage } from "@reading-studio/storage"
import { parseServerConfig, ServerConfigError } from "./config.ts"

export class OwnerCliUsageError extends Error {
  override readonly name = "OwnerCliUsageError"
  constructor() {
    super("Run owner without arguments; authentication and password provisioning have been removed")
  }
}

export function assertInteractiveInvocation(
  argv: readonly string[],
  _inputTty: boolean,
  _outputTty: boolean,
): void {
  if (argv.length !== 2) throw new OwnerCliUsageError()
}

export async function executeOwnerCli(): Promise<void> {
  try {
    assertInteractiveInvocation(process.argv, process.stdin.isTTY, process.stdout.isTTY)
    const config = parseServerConfig(process.env)
    const storage = openAuthStorage(config.databasePath)
    try {
      storage.ensureLibraryOwner()
      process.stdout.write("Library owner namespace is ready. No login or password is required.\n")
    } finally {
      storage.close()
    }
  } catch (error: unknown) {
    if (error instanceof OwnerCliUsageError || error instanceof ServerConfigError) {
      process.stderr.write(`${error.name}: ${error.message}\n`)
      process.exitCode = 2
      return
    }
    process.stderr.write("Library initialization failed.\n")
    process.exitCode = 1
  }
}
