import { spawn, spawnSync } from "node:child_process"
import { renameSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import { afterEach, expect, it } from "vitest"
import { captureLibrary } from "../src/backup.ts"
import { cleanupLibraries, library } from "./backup-fixture.ts"

afterEach(cleanupLibraries)

it("recovers a killed frozen holder through the confirmed owner TTY CLI only after it exits", async () => {
  const paths = library("owner", true)
  const holder = spawn(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--experimental-transform-types",
      fileURLToPath(new URL("../../../tests/deployment/maintenance-hold.ts", import.meta.url)),
      paths.databasePath,
      paths.privateDataRoot,
      join(paths.privateDataRoot, "release"),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  )
  const closed = new Promise<void>((resolve) => holder.once("close", () => resolve()))
  const cli = (operation: "maintenance-status" | "maintenance-recover") =>
    spawnSync(
      "expect",
      [
        fileURLToPath(new URL("./maintenance-cli.exp", import.meta.url)),
        fileURLToPath(new URL("../../../scripts/library.ts", import.meta.url)),
        operation,
      ],
      {
        env: {
          ...process.env,
          DATABASE_PATH: paths.databasePath,
          PRIVATE_DATA_ROOT: paths.privateDataRoot,
        },
        encoding: "utf8",
        timeout: 10_000,
      },
    )
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new TypeError("Holder did not freeze")), 5_000)
      holder.stdout.once("data", (data: Buffer) => {
        clearTimeout(timer)
        data.toString().includes("frozen")
          ? resolve()
          : reject(new TypeError("Holder did not freeze"))
      })
      holder.once("error", reject)
    })
    expect(cli("maintenance-status").stdout).toContain('"processes":"active"')
    expect(cli("maintenance-recover").status).not.toBe(0)
    holder.kill("SIGKILL")
    await closed
    expect(cli("maintenance-status").stdout).toContain('"processes":"quiesced"')
    const operatorLock = `${paths.databasePath}.maintenance-operator.sqlite`
    const misplacedLock = `${operatorLock}.missing`
    renameSync(operatorLock, misplacedLock)
    expect(cli("maintenance-status").stdout).toContain('"holder":"unverified"')
    expect(cli("maintenance-recover").status).not.toBe(0)
    renameSync(misplacedLock, operatorLock)
    const alteredLock = new Database(operatorLock)
    alteredLock.pragma("journal_mode = WAL")
    alteredLock.close()
    expect(cli("maintenance-recover").status).not.toBe(0)
    const rollbackLock = new Database(operatorLock)
    rollbackLock.pragma("journal_mode = DELETE")
    rollbackLock.close()
    const processLock = `${paths.databasePath}.maintenance-lock.sqlite`
    const alteredProcessLock = new Database(processLock)
    alteredProcessLock.pragma("journal_mode = WAL")
    alteredProcessLock.close()
    expect(cli("maintenance-recover").status).not.toBe(0)
    const rollbackProcessLock = new Database(processLock)
    rollbackProcessLock.pragma("journal_mode = DELETE")
    rollbackProcessLock.close()
    const recovered = cli("maintenance-recover")
    expect(recovered.status, recovered.stdout + recovered.stderr).toBe(0)
    expect(cli("maintenance-status").stdout).toContain('"phase":"idle"')
    expect(captureLibrary(paths).byteLength).toBeGreaterThan(0)
  } finally {
    if (holder.exitCode === null && holder.signalCode === null) holder.kill("SIGKILL")
    await closed
  }
}, 20_000)
