import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { openStorage } from "../src/index.ts"
import { cleanupLibraries, library } from "../tests/backup-fixture.ts"

const operator = fileURLToPath(new URL("../../../scripts/library.ts", import.meta.url))
const ageDriver = fileURLToPath(new URL("../tests/age-tty.exp", import.meta.url))
const deletionDriver = fileURLToPath(new URL("../tests/lifecycle-delete.exp", import.meta.url))

function check(status: number | null, operation: string): void {
  if (status !== 0) throw new Error(`lifecycle QA failed: ${operation}`)
  process.stdout.write(`${operation}: ok\n`)
}

function run(
  paths: ReturnType<typeof library>,
  args: readonly [string, string, string, string],
): number | null {
  return spawnSync("expect", [args[0], operator, ...args.slice(1)], {
    env: {
      ...process.env,
      DATABASE_PATH: paths.databasePath,
      PRIVATE_DATA_ROOT: paths.privateDataRoot,
    },
    timeout: 90_000,
    stdio: "inherit",
  }).status
}

try {
  check(spawnSync("age", ["--version"], { stdio: "ignore" }).status, "age available")
  check(spawnSync("expect", ["-v"], { stdio: "ignore" }).status, "expect available")
  check(
    spawnSync(process.execPath, ["--experimental-transform-types", operator, "backup", "--help"], {
      stdio: "ignore",
    }).status,
    "backup --help",
  )
  const source = library("synthetic-source-owner", true)
  const target = library("synthetic-target-owner")
  const archive = join(source.databasePath, "..", "synthetic.age")
  check(run(source, [ageDriver, "backup", archive, "correct"]), "TTY backup")
  check(run(target, [ageDriver, "restore", archive, "correct"]), "TTY restore")
  const restored = openStorage(target)
  try {
    if (restored.sources.listStudiesByEdition("edition-1")[0]?.ownerId !== "synthetic-target-owner")
      throw new Error("destination owner mismatch")
  } finally {
    restored.close()
  }
  process.stdout.write("destination owner read: ok\n")
  check(run(target, [deletionDriver, "delete-project", "study-1", "decline"]), "deletion denied")
  const retained = openStorage(target)
  try {
    if (retained.sources.listStudiesByEdition("edition-1").length !== 1)
      throw new Error("unconfirmed deletion changed project")
  } finally {
    retained.close()
  }
  check(run(target, [deletionDriver, "delete-project", "study-1", "confirm"]), "deletion confirmed")
  const deleted = openStorage(target)
  try {
    if (deleted.sources.listStudiesByEdition("edition-1").length !== 0)
      throw new Error("confirmed deletion retained project")
  } finally {
    deleted.close()
  }
  process.stdout.write("project removal and source retention: ok\n")
} finally {
  cleanupLibraries()
}
