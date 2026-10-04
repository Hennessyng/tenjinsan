import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { openDatabase } from "../src/database.ts"
import {
  ImmutableRecordError,
  openStorage,
  PrivatePathError,
  StorageConstraintError,
} from "../src/index.ts"

class ManualQaError extends Error {
  override readonly name: string = "ManualQaError"
}

function requireRejection(
  check: string,
  operation: () => void,
  expected: typeof ImmutableRecordError | typeof PrivatePathError | typeof StorageConstraintError,
): void {
  try {
    operation()
  } catch (error) {
    if (error instanceof expected) {
      console.log(JSON.stringify({ check, status: "rejected" }))
      return
    }
    throw error
  }
  throw new ManualQaError(`${check} was accepted`)
}

function requireSqlRejection(check: string, operation: () => void): void {
  try {
    operation()
  } catch (error) {
    if (error instanceof Error && error.message.includes("immutable")) {
      console.log(JSON.stringify({ check, status: "rejected" }))
      return
    }
    throw error
  }
  throw new ManualQaError(`${check} was accepted`)
}

const directory = mkdtempSync(join(tmpdir(), "reading-studio-manual-"))
const paths = {
  databasePath: join(directory, "studio.sqlite"),
  privateDataRoot: join(directory, "private-data"),
}
const hash = "a".repeat(64)
const edition = {
  id: "manual-edition",
  originalHash: hash,
  originalBlobHash: hash,
  title: "Synthetic manual edition",
}

try {
  const initial = openStorage(paths)
  initial.sources.createOwner("manual-owner")
  initial.sources.appendEdition(edition)
  initial.sources.createStudy({
    id: "manual-study-1",
    ownerId: "manual-owner",
    editionId: edition.id,
  })
  initial.sources.createStudy({
    id: "manual-study-2",
    ownerId: "manual-owner",
    editionId: edition.id,
  })
  initial.close()

  const direct = openDatabase(paths.databasePath)
  requireSqlRejection("immutable-replace", () => {
    direct.sqlite
      .prepare(
        "INSERT OR REPLACE INTO book_editions (id, original_hash, original_blob_hash, title, record_json) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        edition.id,
        edition.originalHash,
        edition.originalBlobHash,
        "Replacement",
        JSON.stringify({ ...edition, title: "Replacement" }),
      )
  })
  direct.sqlite.close()

  const reopened = openStorage(paths)
  const storedEdition = reopened.sources.getEdition(edition.id)
  const studies = reopened.sources.listStudiesByEdition(edition.id)
  console.log(
    JSON.stringify({
      editionId: storedEdition?.id,
      studyIds: studies.map((study) => study.id),
      counts: reopened.counts(),
    }),
  )
  requireRejection(
    "immutable-update",
    () => {
      reopened.sources.appendEdition({ ...edition, title: "Changed" })
    },
    ImmutableRecordError,
  )
  requireRejection(
    "path-traversal",
    () => {
      reopened.blobs.pathFor("../outside")
    },
    PrivatePathError,
  )
  const linkedHash = "b".repeat(64)
  const linkedCandidate = reopened.blobs.pathFor(linkedHash)
  mkdirSync(dirname(linkedCandidate), { recursive: true })
  symlinkSync(directory, linkedCandidate)
  requireRejection(
    "final-symlink",
    () => {
      reopened.blobs.pathFor(linkedHash)
    },
    PrivatePathError,
  )
  requireRejection(
    "foreign-key",
    () => {
      reopened.sources.createStudy({
        id: "manual-invalid-study",
        ownerId: "manual-owner",
        editionId: "missing-edition",
      })
    },
    StorageConstraintError,
  )
  reopened.close()
} finally {
  rmSync(directory, { recursive: true, force: true })
}

console.log(JSON.stringify({ cleanup: { disposableDatabasesRemaining: 0 } }))
