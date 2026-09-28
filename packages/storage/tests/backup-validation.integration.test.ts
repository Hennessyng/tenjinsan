import { mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { afterEach, expect, it } from "vitest"
import { captureLibrary, restoreLibrary } from "../src/backup.ts"
import { digest } from "../src/backup-records.ts"
import { Archive, type Payload } from "../src/backup-schema.ts"
import { openDatabase } from "../src/database.ts"
import { openStorage, PrivatePathError } from "../src/index.ts"
import { cleanupLibraries, library } from "./backup-fixture.ts"

afterEach(cleanupLibraries)
const mutations: readonly {
  readonly name: string
  readonly mutate: (payload: Payload) => unknown
}[] = [
  { name: "unsupported version", mutate: (payload) => ({ ...payload, version: 99 }) },
  {
    name: "unknown auth table",
    mutate: (payload) => ({
      ...payload,
      tables: [...payload.tables, { name: "auth_users", rows: [] }],
    }),
  },
  {
    name: "duplicate table",
    mutate: (payload) => ({ ...payload, tables: [...payload.tables, payload.tables[0]] }),
  },
  { name: "missing blob", mutate: (payload) => ({ ...payload, blobs: [] }) },
  {
    name: "blob digest mismatch",
    mutate: (payload) => ({
      ...payload,
      blobs: payload.blobs.map((blob) => ({ ...blob, bytes: "AAAA" })),
    }),
  },
  {
    name: "blob path traversal",
    mutate: (payload) => ({
      ...payload,
      blobs: payload.blobs.map((blob) => ({ ...blob, hash: "../../outside" })),
    }),
  },
  {
    name: "invalid record schema",
    mutate: (payload) => ({
      ...payload,
      tables: payload.tables.map((table) =>
        table.name === "book_editions"
          ? { ...table, rows: table.rows.map((row) => ({ ...row, record_json: "{}" })) }
          : table,
      ),
    }),
  },
  {
    name: "dangling foreign key",
    mutate: (payload) => ({
      ...payload,
      tables: payload.tables.map((table) =>
        table.name === "studies"
          ? { ...table, rows: table.rows.map((row) => ({ ...row, edition_id: "absent-edition" })) }
          : table,
      ),
    }),
  },
  {
    name: "identifying owner",
    mutate: (payload) => ({
      ...payload,
      tables: payload.tables.map((table) =>
        table.name === "studies"
          ? {
              ...table,
              rows: table.rows.map((row) => ({ ...row, owner_id: "person@example.test" })),
            }
          : table,
      ),
    }),
  },
  {
    name: "inconsistent normalized block index",
    mutate: (payload) => ({
      ...payload,
      tables: payload.tables.map((table) =>
        table.name === "source_blocks"
          ? { ...table, rows: table.rows.map((row) => ({ ...row, text: "forged source text" })) }
          : table,
      ),
    }),
  },
]

it.each(mutations)(
  "rejects $name in staging even with a recomputed manifest hash",
  ({ mutate }) => {
    // Given an authenticated-looking but structurally invalid logical payload.
    const destination = library("destination")
    const original = Archive.parse(JSON.parse(captureLibrary(library("source", true)).toString()))
    const payload = mutate(original.payload)
    const bytes = Buffer.from(JSON.stringify({ payload, digest: digest(JSON.stringify(payload)) }))
    // When restore validates the payload, then domain and authentication remain unchanged.
    expect(() => restoreLibrary(destination, bytes)).toThrow()
    const { sqlite } = openDatabase(destination.databasePath)
    expect(sqlite.prepare("SELECT id FROM book_editions").all()).toEqual([])
    expect(sqlite.prepare("SELECT id FROM owners").all()).toEqual([{ id: "destination" }])
    expect(sqlite.prepare("SELECT token FROM auth_sessions").get()).toEqual({
      token: "SESSION-CANARY",
    })
    sqlite.close()
  },
)

it("refuses to overwrite an existing blob whose bytes disagree with its hash", () => {
  // Given a destination content-address collision.
  const destination = library("destination")
  const bytes = captureLibrary(library("source", true))
  const archive = Archive.parse(JSON.parse(bytes.toString()))
  const storage = openStorage(destination)
  const hash = archive.payload.blobs[0]?.hash
  if (!hash) throw new TypeError("missing fixture blob")
  const path = storage.blobs.pathFor(hash)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, "preexisting destination bytes")
  storage.close()
  // When restore encounters the collision, then it refuses rather than replacing bytes.
  expect(() => restoreLibrary(destination, bytes)).toThrow(/collision/)
})

it("rejects a symlink blob instead of reading outside the source library", () => {
  // Given an edition that points at a symlink, not an immutable blob.
  const paths = library("owner")
  const storage = openStorage(paths)
  const hash = "a".repeat(64)
  const path = storage.blobs.pathFor(hash)
  mkdirSync(dirname(path), { recursive: true })
  symlinkSync(paths.databasePath, path)
  storage.sources.appendEdition({
    id: "edition",
    originalHash: hash,
    originalBlobHash: hash,
    title: "source",
  })
  storage.close()
  // When exporting, then the unsafe filesystem reference is rejected.
  expect(() => captureLibrary(paths)).toThrow(PrivatePathError)
})

it("refuses backup while another SQLite writer holds the library", () => {
  // Given a concurrent writer that has not committed.
  const paths = library("owner", true)
  const { sqlite } = openDatabase(paths.databasePath)
  sqlite.exec("BEGIN IMMEDIATE")
  // When backup attempts to quiesce persisted writes, then it fails closed.
  try {
    expect(() => captureLibrary(paths, 200)).toThrow(/locked/)
  } finally {
    sqlite.exec("ROLLBACK")
    sqlite.close()
  }
})
