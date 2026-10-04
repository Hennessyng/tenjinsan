import { stdin, stdout } from "node:process"
import { createInterface } from "node:readline/promises"
import { openAuthStorage } from "@reading-studio/storage"
import { createOwnerAuth } from "./auth/auth.ts"
import {
  createOwnerService,
  OwnerAlreadyExistsError,
  OwnerNotProvisionedError,
} from "./auth/owner.ts"
import { parseServerConfig, ServerConfigError } from "./config.ts"

export class OwnerCliUsageError extends Error {
  override readonly name = "OwnerCliUsageError"

  constructor() {
    super("Run the owner command without arguments from an interactive terminal")
  }
}

class OwnerPasswordMismatchError extends Error {
  override readonly name = "OwnerPasswordMismatchError"

  constructor() {
    super("The password confirmation did not match")
  }
}

class OwnerPasswordRejectedError extends Error {
  override readonly name = "OwnerPasswordRejectedError"

  constructor() {
    super("Enter a password of 1 to 128 characters")
  }
}

export function assertInteractiveInvocation(
  argv: readonly string[],
  inputIsTTY: boolean,
  outputIsTTY: boolean,
): void {
  if (argv.length !== 2 || !inputIsTTY || !outputIsTTY) {
    throw new OwnerCliUsageError()
  }
}

async function readPassword(label: string): Promise<string> {
  stdout.write(label)
  stdin.setRawMode(true)
  stdin.resume()
  return new Promise((resolvePassword, rejectPassword) => {
    let password = ""
    const finish = (): void => {
      stdin.off("data", onData)
      stdin.setRawMode(false)
      stdin.pause()
      stdout.write("\n")
      resolvePassword(password)
    }
    const fail = (): void => {
      stdin.off("data", onData)
      stdin.setRawMode(false)
      stdin.pause()
      stdout.write("\n")
      rejectPassword(new OwnerCliUsageError())
    }
    const onData = (chunk: Buffer): void => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\r" || character === "\n") {
          finish()
          return
        }
        if (character === "\u0003") {
          fail()
          return
        }
        if (character === "\u007f") {
          if (password.length > 0) {
            password = password.slice(0, -1)
            stdout.write("\b \b")
          }
        } else if (character >= " ") {
          password += character
          stdout.write("*")
        }
      }
    }
    stdin.on("data", onData)
  })
}

async function readConfirmedPassword(): Promise<string> {
  stdout.write("Any non-empty password is accepted, up to 128 characters.\n")
  const password = await readPassword("Password: ")
  const confirmation = await readPassword("Confirm password: ")
  if (password !== confirmation) {
    throw new OwnerPasswordMismatchError()
  }
  if (password.length < 1 || password.length > 128) {
    throw new OwnerPasswordRejectedError()
  }
  return password
}

async function runOwnerCli(): Promise<void> {
  assertInteractiveInvocation(process.argv, stdin.isTTY, stdout.isTTY)
  const config = parseServerConfig(process.env)
  const storage = openAuthStorage(config.databasePath)
  const auth = createOwnerAuth(storage, {
    baseURL: config.authBaseURL,
    secret: config.authSecret,
    sessionExpiresIn: config.sessionExpiresIn,
  })
  const owner = createOwnerService(storage, auth)
  const terminal = createInterface({ input: stdin, output: stdout })
  try {
    const action = (await terminal.question("Action ([p]rovision/[r]eset): ")).trim().toLowerCase()
    if (action === "p" || action === "provision") {
      const email = await terminal.question("Email: ")
      const name = await terminal.question("Name: ")
      terminal.close()
      const password = await readConfirmedPassword()
      await owner.provision({ email, name, password })
      stdout.write("Owner provisioned.\n")
      return
    }
    if (action === "r" || action === "reset") {
      terminal.close()
      const password = await readConfirmedPassword()
      await owner.resetPassword(password)
      stdout.write("Owner credentials reset; prior sessions invalidated.\n")
      return
    }
    throw new OwnerCliUsageError()
  } finally {
    terminal.close()
    storage.close()
  }
}

export async function executeOwnerCli(): Promise<void> {
  try {
    await runOwnerCli()
  } catch (error: unknown) {
    if (
      error instanceof OwnerCliUsageError ||
      error instanceof OwnerPasswordMismatchError ||
      error instanceof OwnerPasswordRejectedError ||
      error instanceof OwnerAlreadyExistsError ||
      error instanceof OwnerNotProvisionedError ||
      error instanceof ServerConfigError
    ) {
      process.stderr.write(`${error.name}: ${error.message}\n`)
      process.exitCode = 2
      return
    }
    process.stderr.write("Owner operation failed.\n")
    process.exitCode = 1
  }
}
