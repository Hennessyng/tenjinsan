import { stdin, stdout } from "node:process"
import { createInterface } from "node:readline"
import { Writable } from "node:stream"
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

class OwnerTerminal {
  private readonly lines: string[] = []
  private waiter:
    | { readonly resolve: (line: string) => void; readonly reject: (error: Error) => void }
    | undefined
  private readonly terminal: ReturnType<typeof createInterface>
  private secret = false
  private remainingPublic: number | undefined
  private displayed = 0
  private closed = false
  private failure: OwnerCliUsageError | undefined

  constructor() {
    const output = new Writable({
      write: (chunk, _encoding, done) => {
        if (!this.secret) stdout.write(chunk)
        done()
      },
    })
    this.terminal = createInterface({ input: stdin, output, terminal: true, historySize: 0 })
    this.terminal.on("line", (line: string) => {
      if (this.secret) stdout.write("\n")
      this.displayed = 0
      if (this.remainingPublic === undefined) {
        const action = line.trim().toLowerCase()
        this.remainingPublic = action === "p" || action === "provision" ? 2 : 0
      } else if (this.remainingPublic > 0) this.remainingPublic -= 1
      this.secret = this.remainingPublic === 0
      if (this.waiter !== undefined) {
        this.waiter.resolve(line)
        this.waiter = undefined
      } else this.lines.push(line)
    })
    this.terminal.on("SIGINT", () => this.fail())
    this.terminal.on("close", () => {
      if (!this.closed) this.fail()
    })
    stdin.on("keypress", this.mask)
  }

  private readonly mask = (): void => {
    if (!this.secret) return
    const count = [...this.terminal.line].length
    if (count > this.displayed) stdout.write("*".repeat(count - this.displayed))
    if (count < this.displayed) stdout.write("\b \b".repeat(this.displayed - count))
    this.displayed = count
  }

  private fail(): void {
    this.failure = new OwnerCliUsageError()
    this.waiter?.reject(this.failure)
    this.waiter = undefined
    this.close()
  }

  read(label: string): Promise<string> {
    stdout.write(label)
    if (this.failure !== undefined) return Promise.reject(this.failure)
    const line = this.lines.shift()
    if (line !== undefined) return Promise.resolve(line)
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject }
    })
  }

  close(): void {
    this.closed = true
    stdin.off("keypress", this.mask)
    this.terminal.close()
    this.lines.length = 0
    stdin.pause()
  }
}

async function readConfirmedPassword(terminal: OwnerTerminal): Promise<string> {
  stdout.write("Any non-empty password is accepted, up to 128 characters.\n")
  const password = await terminal.read("Password: ")
  const confirmation = await terminal.read("Confirm password: ")
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
  const terminal = new OwnerTerminal()
  try {
    const action = (await terminal.read("Action ([p]rovision/[r]eset): ")).trim().toLowerCase()
    if (action === "p" || action === "provision") {
      const email = await terminal.read("Email: ")
      const name = await terminal.read("Name: ")
      const password = await readConfirmedPassword(terminal)
      terminal.close()
      await owner.provision({ email, name, password })
      stdout.write("Owner provisioned.\n")
      return
    }
    if (action === "r" || action === "reset") {
      const password = await readConfirmedPassword(terminal)
      terminal.close()
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
