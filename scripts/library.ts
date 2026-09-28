import { closeSync, openSync, readSync } from "node:fs"
import { resolve } from "node:path"
import {
  backupEncryptedLibrary,
  deleteLibraryItem,
  maintenanceStatus,
  openMaintenanceDatabase,
  recoverMaintenance,
  restoreEncryptedLibrary,
} from "@reading-studio/storage"

const [command, operand, ...extra] = process.argv.slice(2)
if (process.argv.slice(2).includes("--help")) {
  process.stdout.write(
    "Usage: library backup|restore ARCHIVE | delete-project|delete-source ID | maintenance-status | maintenance-recover\nRecovery requires stopping all API/worker processes; encryption requires age and a controlling TTY.\n",
  )
  process.exit(0)
}
if (
  (!["maintenance-recover", "maintenance-status"].includes(command ?? "") && !operand) ||
  (["maintenance-recover", "maintenance-status"].includes(command ?? "") && operand) ||
  extra.length > 0 ||
  !process.stdin.isTTY
)
  throw new TypeError(
    "Usage (TTY only): library backup|restore ARCHIVE | delete-source|delete-project ID | maintenance-status | maintenance-recover",
  )
const paths = {
  databasePath: resolve(process.env["DATABASE_PATH"] ?? "data/studio.sqlite"),
  privateDataRoot: resolve(process.env["PRIVATE_DATA_ROOT"] ?? "data/private"),
}
const target = operand ?? ""
function confirm(expected: string): void {
  process.stdout.write(`Type '${expected}' to confirm: `)
  const fd = openSync("/dev/tty", "r")
  let answer = ""
  try {
    const byte = Buffer.alloc(1)
    while (answer.length <= 256 && readSync(fd, byte, 0, 1, null) === 1) {
      if (byte[0] === 10 || byte[0] === 13) break
      answer += byte.toString("utf8")
    }
  } finally {
    closeSync(fd)
  }
  if (answer !== expected) throw new TypeError("Operator confirmation failed")
}
switch (command) {
  case "backup":
    backupEncryptedLibrary({ ...paths, archivePath: resolve(target) })
    process.stdout.write("Encrypted logical backup created. Keep its passphrase separate.\n")
    break
  case "restore":
    restoreEncryptedLibrary({ ...paths, archivePath: resolve(target) })
    process.stdout.write(
      "Restored. Jobs are paused; grant, privacy and publication approval must be renewed here.\n",
    )
    break
  case "maintenance-recover": {
    process.stdout.write(
      "Stop all API and worker processes first. Recovery refuses any live process; uncertain paid attempts remain historical.\n",
    )
    confirm("maintenance-recover")
    const sqlite = openMaintenanceDatabase(paths.databasePath)
    try {
      recoverMaintenance(sqlite)
    } finally {
      sqlite.close()
    }
    process.stdout.write(
      "Operator cleared maintenance. Uncertain provider attempts remain quarantined.\n",
    )
    break
  }
  case "maintenance-status": {
    const sqlite = openMaintenanceDatabase(paths.databasePath)
    try {
      process.stdout.write(`${JSON.stringify(maintenanceStatus(sqlite))}\n`)
    } finally {
      sqlite.close()
    }
    break
  }
  case "delete-source":
  case "delete-project":
    confirm(`${command} ${target}`)
    process.stdout.write(
      `${JSON.stringify(
        deleteLibraryItem(paths, {
          kind: command === "delete-source" ? "source" : "project",
          id: operand,
        }),
      )}\n`,
    )
    break
  default:
    throw new TypeError("Unknown library operation")
}
