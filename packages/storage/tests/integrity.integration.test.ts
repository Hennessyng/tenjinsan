import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Database from "better-sqlite3"
import { afterEach, expect, it } from "vitest"
import { openDatabase } from "../src/database.ts"
import {
  ContractBoundaryError,
  ImmutableRecordError,
  openStorage,
  StorageConstraintError,
  StorageWriteError,
  StoredRecordError,
} from "../src/index.ts"
import { sourceFixtures } from "./fixtures.ts"

const temporaryDirectories: string[] = []

function temporaryStorage() {
  const directory = mkdtempSync(join(tmpdir(), "reading-studio-integrity-"))
  temporaryDirectories.push(directory)
  return {
    databasePath: join(directory, "studio.sqlite"),
    privateDataRoot: join(directory, "private-data"),
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

it("enables foreign keys, WAL, and a bounded busy timeout on every reopened connection", () => {
  const paths = temporaryStorage()
  const storage = openStorage(paths)
  expect(storage.diagnostics()).toEqual({
    foreignKeys: true,
    recursiveTriggers: true,
    journalMode: "wal",
    busyTimeoutMs: 5000,
  })
  storage.close()
  const reopened = openStorage(paths)
  expect(reopened.diagnostics()).toEqual({
    foreignKeys: true,
    recursiveTriggers: true,
    journalMode: "wal",
    busyTimeoutMs: 5000,
  })
  reopened.close()
})

it("rejects missing and cross-edition foreign records without partial writes", () => {
  const paths = temporaryStorage()
  const fixture = sourceFixtures()
  const storage = openStorage(paths)
  storage.sources.createOwner("owner-1")
  expect(() =>
    storage.sources.createStudy({ id: "study-missing", ownerId: "owner-1", editionId: "missing" }),
  ).toThrow(StorageConstraintError)

  storage.sources.appendEdition(fixture.edition)
  storage.sources.appendEdition({
    ...fixture.edition,
    id: "edition-2",
    originalHash: "b".repeat(64),
    originalBlobHash: "b".repeat(64),
  })
  storage.sources.createStudy({ id: "study-2", ownerId: "owner-1", editionId: "edition-2" })
  storage.sources.appendNormalization({ record: fixture.normalization, parentRevisionId: null })
  expect(() =>
    storage.sources.appendSetup({
      record: { ...fixture.setup, studyId: "study-2", editionId: "edition-2" },
      parentRevisionId: null,
    }),
  ).toThrow(ContractBoundaryError)
  expect(storage.counts().setups).toBe(0)
  storage.close()
})

it("rejects immutable API rewrites and direct SQL updates", () => {
  const paths = temporaryStorage()
  const fixture = sourceFixtures()
  const storage = openStorage(paths)
  storage.sources.appendEdition(fixture.edition)
  storage.sources.appendNormalization({ record: fixture.normalization, parentRevisionId: null })
  expect(() =>
    storage.sources.appendEdition({ ...fixture.edition, title: "Mutated title" }),
  ).toThrow(ImmutableRecordError)
  expect(() =>
    storage.sources.appendNormalization({
      record: { ...fixture.normalization, parserVersion: "mutated-parser" },
      parentRevisionId: null,
    }),
  ).toThrow(ImmutableRecordError)
  storage.close()

  const sqlite = new Database(paths.databasePath)
  expect(() =>
    sqlite.prepare("UPDATE book_editions SET title = ? WHERE id = ?").run("Mutated", "edition-1"),
  ).toThrow(/immutable/u)
  expect(() =>
    sqlite
      .prepare("UPDATE normalization_revisions SET parser_version = ? WHERE id = ?")
      .run("mutated", "normalization-1"),
  ).toThrow(/immutable/u)
  expect(() =>
    sqlite.prepare("DELETE FROM normalization_revisions WHERE id = ?").run("normalization-1"),
  ).toThrow(/immutable/u)
  sqlite.close()

  const reopened = openStorage(paths)
  expect(reopened.sources.getEdition("edition-1")?.title).toBe(fixture.edition.title)
  expect(reopened.sources.getNormalization("normalization-1")?.parserVersion).toBe(
    fixture.normalization.parserVersion,
  )
  reopened.close()
})

it("rejects INSERT OR REPLACE for an unreferenced immutable edition across reopen", () => {
  const paths = temporaryStorage()
  const fixture = sourceFixtures()
  const storage = openStorage(paths)
  storage.sources.appendEdition(fixture.edition)
  storage.close()

  const context = openDatabase(paths.databasePath)
  const replacement = { ...fixture.edition, title: "Replacement title" }
  expect(() =>
    context.sqlite
      .prepare(
        "INSERT OR REPLACE INTO book_editions (id, original_hash, original_blob_hash, title, record_json) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        replacement.id,
        replacement.originalHash,
        replacement.originalBlobHash,
        replacement.title,
        JSON.stringify(replacement),
      ),
  ).toThrow(/immutable/u)
  context.sqlite.close()

  const reopened = openStorage(paths)
  expect(reopened.sources.getEdition(fixture.edition.id)?.title).toBe(fixture.edition.title)
  reopened.close()
})

it("fails explicitly when persisted JSON does not satisfy its contract", () => {
  const paths = temporaryStorage()
  const storage = openStorage(paths)
  storage.close()
  const sqlite = new Database(paths.databasePath)
  sqlite
    .prepare(
      "INSERT INTO book_editions (id, original_hash, original_blob_hash, title, record_json) VALUES (?, ?, ?, ?, ?)",
    )
    .run("edition-invalid", "a".repeat(64), "a".repeat(64), "Synthetic", "{}")
  sqlite.close()
  const reopened = openStorage(paths)
  expect(() => reopened.sources.getEdition("edition-invalid")).toThrow(StoredRecordError)
  reopened.close()
})

it("rolls back a multi-row normalization append when a child insert is interrupted", () => {
  const paths = temporaryStorage()
  const fixture = sourceFixtures()
  const storage = openStorage(paths)
  storage.sources.appendEdition(fixture.edition)
  const sqlite = new Database(paths.databasePath)
  sqlite.exec(
    "CREATE TRIGGER interrupt_normalization BEFORE INSERT ON normalization_resources BEGIN SELECT RAISE(ABORT, 'simulated interruption'); END",
  )
  sqlite.close()
  expect(() =>
    storage.sources.appendNormalization({ record: fixture.normalization, parentRevisionId: null }),
  ).toThrow(StorageWriteError)
  expect(storage.counts()).toMatchObject({ normalizations: 0, sourceBlocks: 0 })
  storage.close()

  const reopened = openStorage(paths)
  expect(reopened.counts()).toMatchObject({ normalizations: 0, sourceBlocks: 0 })
  reopened.close()
})
