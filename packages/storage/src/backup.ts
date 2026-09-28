import { randomUUID } from "node:crypto"
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import Database from "better-sqlite3"
import { z } from "zod"
import { verifySourceGraph } from "./backup-integrity.ts"
import { digest, snapshot, validatePayload } from "./backup-records.ts"
import { Archive, BackupError, type Payload } from "./backup-schema.ts"
import { assertEmpty, insertPayload, stagingIdentity } from "./backup-transaction.ts"
import { PrivateBlobStore } from "./blob-store.ts"
import { openDatabase } from "./database.ts"
import { withMaintenance } from "./maintenance.ts"

export type LibraryPaths = { readonly databasePath: string; readonly privateDataRoot: string }

export function openMaintenanceDatabase(path: string): Database.Database {
  const sqlite = new Database(path, { fileMustExist: true, timeout: 100 })
  sqlite.pragma("foreign_keys = ON")
  sqlite.pragma("recursive_triggers = ON")
  return sqlite
}

export function captureLibrary(
  paths: LibraryPaths,
  timeoutMs = 30_000,
  progress?: (phase: "draining" | "frozen") => void,
): Buffer {
  const sqlite = openMaintenanceDatabase(paths.databasePath)
  try {
    return withMaintenance(
      sqlite,
      () =>
        sqlite
          .transaction(() => {
            const payload = snapshot(sqlite, new PrivateBlobStore(paths.privateDataRoot))
            validatePayload(payload)
            return Buffer.from(JSON.stringify({ digest: digest(JSON.stringify(payload)), payload }))
          })
          .exclusive(),
      timeoutMs,
      progress,
    )
  } finally {
    sqlite.close()
  }
}

function syncPath(path: string): void {
  const fd = openSync(path, "r")
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function stagePayload(payload: Payload, root: string): void {
  const { sqlite } = openDatabase(join(root, "validation.sqlite"))
  try {
    sqlite.prepare("INSERT INTO owners (id) VALUES (?)").run(stagingIdentity.owner)
    sqlite.transaction(() => insertPayload(sqlite, payload, stagingIdentity)).exclusive()
    verifySourceGraph(sqlite)
  } finally {
    sqlite.close()
  }
  for (const blob of payload.blobs) {
    const path = join(root, blob.hash)
    writeFileSync(path, Buffer.from(blob.bytes, "base64"), { flag: "wx", mode: 0o600 })
    syncPath(path)
    if (digest(readFileSync(path)) !== blob.hash)
      throw new BackupError("staged blob digest mismatch")
  }
  syncPath(root)
}

export function restoreLibrary(
  paths: LibraryPaths,
  bytes: Uint8Array,
  progress?: (phase: "draining" | "frozen") => void,
): void {
  const archive = Archive.parse(JSON.parse(Buffer.from(bytes).toString("utf8")))
  if (digest(JSON.stringify(archive.payload)) !== archive.digest)
    throw new BackupError("manifest digest mismatch")
  validatePayload(archive.payload)
  const blobs = new PrivateBlobStore(paths.privateDataRoot)
  const staging = mkdtempSync(join(paths.privateDataRoot, ".restore-"))
  const installed: string[] = []
  let committed = false
  try {
    stagePayload(archive.payload, staging)
    const sqlite = openMaintenanceDatabase(paths.databasePath)
    try {
      withMaintenance(
        sqlite,
        () =>
          sqlite
            .transaction(() => {
              sqlite.prepare("UPDATE maintenance_gate SET phase = 'restoring' WHERE id = 1").run()
              assertEmpty(sqlite)
              const owner = z
                .object({ id: z.string() })
                .parse(sqlite.prepare("SELECT id FROM owners").get()).id
              for (const blob of archive.payload.blobs) {
                const target = blobs.pathFor(blob.hash)
                if (existsSync(target)) {
                  if (digest(readFileSync(target)) !== blob.hash)
                    throw new BackupError("destination blob collision")
                } else {
                  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
                  linkSync(join(staging, blob.hash), target)
                  installed.push(target)
                  syncPath(dirname(target))
                }
              }
              syncPath(join(paths.privateDataRoot, "blobs"))
              rmSync(staging, { recursive: true, force: true })
              syncPath(paths.privateDataRoot)
              insertPayload(sqlite, archive.payload, {
                owner,
                installation: `restored-${randomUUID()}`,
              })
              sqlite.prepare("UPDATE maintenance_gate SET phase = 'frozen' WHERE id = 1").run()
            })
            .exclusive(),
        30_000,
        progress,
      )
      committed = true
    } finally {
      sqlite.close()
    }
  } finally {
    if (!committed) {
      for (const path of installed) unlinkSync(path)
      rmSync(staging, { recursive: true, force: true })
    }
  }
}
