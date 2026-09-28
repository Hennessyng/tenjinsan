import { spawnSync } from "node:child_process"
import { closeSync, fsyncSync, linkSync, mkdtempSync, openSync, rmSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"
import { isatty } from "node:tty"
import { z } from "zod"
import { captureLibrary, restoreLibrary } from "./backup.ts"
import { BackupError } from "./backup-schema.ts"

const Options = z.strictObject({
  databasePath: z.string().refine(isAbsolute),
  privateDataRoot: z.string().refine(isAbsolute),
  archivePath: z.string().refine(isAbsolute),
})

function requireTty(): void {
  const fd = openSync("/dev/tty", "r+")
  try {
    if (!isatty(fd)) throw new BackupError("passphrase requires a controlling TTY")
  } finally {
    closeSync(fd)
  }
}

function age(args: readonly string[], input: Buffer | undefined, output?: string): Buffer {
  requireTty()
  const fd = output === undefined ? undefined : openSync(output, "wx", 0o600)
  try {
    const result = spawnSync("age", [...args], {
      stdio: ["pipe", fd ?? "pipe", "inherit"],
      input,
      maxBuffer: 1024 * 1024 * 1024,
      timeout: 600_000,
      env: { PATH: process.env["PATH"], HOME: process.env["HOME"], TERM: process.env["TERM"] },
    })
    if (result.error || result.status !== 0)
      throw new BackupError(
        result.error && "code" in result.error && result.error.code === "ENOENT"
          ? "age is required; install age from https://age-encryption.org/ and retry"
          : "age failed; no archive or restore committed",
      )
    if (fd !== undefined) fsyncSync(fd)
    return result.stdout ?? Buffer.alloc(0)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export function backupEncryptedLibrary(input: unknown): void {
  const options = Options.parse(input)
  requireTty()
  const temporary = mkdtempSync(join(dirname(options.archivePath), ".age-backup-"))
  try {
    const encrypted = join(temporary, "archive.age")
    age(
      ["--passphrase"],
      captureLibrary(options, 30_000, (phase) => process.stderr.write(`Maintenance: ${phase}\n`)),
      encrypted,
    )
    linkSync(encrypted, options.archivePath)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

export function restoreEncryptedLibrary(input: unknown): void {
  const options = Options.parse(input)
  requireTty()
  process.stderr.write("Maintenance: decrypting and staging archive\n")
  restoreLibrary(options, age(["--decrypt", options.archivePath], undefined), (phase) =>
    process.stderr.write(`Maintenance: ${phase}\n`),
  )
}
