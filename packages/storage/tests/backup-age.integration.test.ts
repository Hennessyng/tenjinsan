import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, expect, it } from "vitest"
import { openDatabase } from "../src/database.ts"
import { openStorage } from "../src/index.ts"

const roots: string[] = []
const cli = fileURLToPath(new URL("../../../scripts/library.ts", import.meta.url))
const driver = fileURLToPath(new URL("./age-tty.exp", import.meta.url))
function library(populated: boolean) {
  const root = mkdtempSync(join(tmpdir(), "age-library-"))
  roots.push(root)
  const paths = { databasePath: join(root, "db.sqlite"), privateDataRoot: join(root, "private") }
  const storage = openStorage(paths)
  storage.sources.createOwner(populated ? "source-owner" : "destination-owner")
  if (populated) {
    const bytes = Buffer.from("PRIVATE SOURCE CANARY")
    const hash = createHash("sha256").update(bytes).digest("hex")
    const path = storage.blobs.pathFor(hash)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
    storage.sources.appendEdition({
      id: "edition",
      originalHash: hash,
      originalBlobHash: hash,
      title: "PRIVATE SOURCE CANARY",
    })
  }
  storage.close()
  return { paths, archive: join(root, "backup.age") }
}
function run(paths: ReturnType<typeof library>["paths"], operation: string, archive: string) {
  return spawnSync(
    "expect",
    [
      driver,
      cli,
      operation === "wrong-restore" ? "restore" : operation,
      archive,
      operation === "wrong-restore" ? "wrong" : "correct",
    ],
    {
      env: {
        ...process.env,
        DATABASE_PATH: paths.databasePath,
        PRIVATE_DATA_ROOT: paths.privateDataRoot,
      },
      timeout: 90_000,
      encoding: "utf8",
    },
  )
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it("round trips through the real age CLI with passphrases delivered only over a TTY", () => {
  // Given real source and destination databases and an installed age binary.
  expect(spawnSync("age", ["--version"]).status).toBe(0)
  const source = library(true)
  const destination = library(false)
  // When the actual operator CLI encrypts and restores through a pseudo-terminal.
  expect(run(source.paths, "backup", source.archive).status).toBe(0)
  expect(run(destination.paths, "restore", source.archive).status).toBe(0)
  // Then only ciphertext is published and restored bytes match the source.
  const ciphertext = readFileSync(source.archive)
  expect(ciphertext.subarray(0, 22).toString()).toBe("age-encryption.org/v1\n")
  expect(ciphertext.includes(Buffer.from("PRIVATE SOURCE CANARY"))).toBe(false)
  const restored = openStorage(destination.paths)
  expect(restored.sources.getEdition("edition")?.title).toBe("PRIVATE SOURCE CANARY")
  restored.close()
  expect(readdirSync(destination.paths.privateDataRoot).some((name) => name.startsWith("."))).toBe(
    false,
  )
}, 90_000)

it("rejects a wrong TTY passphrase without touching destination domain or owners", () => {
  // Given an encrypted archive and an initialized empty destination.
  const source = library(true)
  const destination = library(false)
  expect(run(source.paths, "backup", source.archive).status).toBe(0)
  // When age rejects the passphrase.
  expect(run(destination.paths, "wrong-restore", source.archive).status).not.toBe(0)
  // Then destination ownership and empty domain state are unchanged.
  const { sqlite } = openDatabase(destination.paths.databasePath)
  expect(sqlite.prepare("SELECT id FROM owners").all()).toEqual([{ id: "destination-owner" }])
  expect(sqlite.prepare("SELECT id FROM book_editions").all()).toEqual([])
  sqlite.close()
  expect(readdirSync(destination.paths.privateDataRoot).some((name) => name.startsWith("."))).toBe(
    false,
  )
}, 90_000)

it("rejects non-TTY invocations instead of accepting passphrases from stdin or environment", () => {
  // Given a piped CLI invocation.
  const source = library(true)
  // When a caller attempts to supply a passphrase without a controlling terminal.
  const result = spawnSync(
    process.execPath,
    ["--experimental-transform-types", cli, "backup", source.archive, "--quiesced"],
    {
      input: "must-not-be-used",
      env: { ...process.env, AGE_PASSPHRASE: "must-not-be-used" },
    },
  )
  // Then it fails without producing an archive.
  expect(result.status).not.toBe(0)
  expect(readdirSync(dirname(source.archive))).not.toContain("backup.age")
})

it("shows backup help without a TTY and refuses deletion without confirmation", () => {
  // Given an initialized source with a project.
  const source = library(true)
  // When help is requested and a non-interactive deletion is attempted.
  const help = spawnSync(
    process.execPath,
    ["--experimental-transform-types", cli, "backup", "--help"],
    { encoding: "utf8" },
  )
  const deletion = spawnSync(
    process.execPath,
    ["--experimental-transform-types", cli, "delete-project", "edition", "--quiesced"],
    {
      env: {
        ...process.env,
        DATABASE_PATH: source.paths.databasePath,
        PRIVATE_DATA_ROOT: source.paths.privateDataRoot,
      },
      encoding: "utf8",
    },
  )
  // Then help works and the project cannot be removed by a non-TTY caller.
  expect(help.status).toBe(0)
  expect(help.stdout).toContain("backup")
  expect(deletion.status).not.toBe(0)
  const storage = openStorage(source.paths)
  expect(storage.sources.getEdition("edition")?.id).toBe("edition")
  storage.close()
})
