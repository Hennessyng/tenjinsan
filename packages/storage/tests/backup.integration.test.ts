import { readFileSync } from "node:fs"
import { AnalysisCacheInput, analysisCacheKey, Job } from "@reading-studio/contracts"
import { afterEach, expect, it } from "vitest"
import { captureLibrary, restoreLibrary } from "../src/backup.ts"
import { referencedHashes } from "../src/backup-records.ts"
import { openDatabase } from "../src/database.ts"
import { openStorage } from "../src/index.ts"
import { deleteLibraryItem } from "../src/library-deletion.ts"
import { recoverMaintenance } from "../src/maintenance.ts"
import { cleanupLibraries, library } from "./backup-fixture.ts"
import { completeGraphFixtures } from "./fixtures.ts"

afterEach(cleanupLibraries)

it("keeps a completed job's semantic checkpoint out of the private blob manifest", () => {
  const hash = "f".repeat(64)
  const job = Job.parse({
    ...completeGraphFixtures().job,
    state: "completed",
    checkpoint: hash,
    resultHash: hash,
  })
  const referenced = referencedHashes({
    tables: [{ name: "jobs", rows: [{ record_json: JSON.stringify(job) }] }],
    history: [],
  })
  expect(referenced.has(hash)).toBe(false)
})

it("restores logical domain rows and verified bytes under the destination owner without credentials", () => {
  // Given distinct source and destination credentials and an immutable source.
  const source = library("source-owner", true)
  const destination = library("destination-owner")
  // When a logical archive is captured and restored.
  const archive = captureLibrary(source)
  restoreLibrary(destination, archive)
  // Then identities never enter the archive and source ownership is remapped.
  const text = archive.toString("utf8")
  for (const secret of [
    "source-owner",
    "PRIVATE IDENTITY",
    "PASSWORD-CANARY",
    "SESSION-CANARY",
    "VERIFICATION-CANARY",
    "auth_users",
  ])
    expect(text).not.toContain(secret)
  const restored = openStorage(destination)
  expect(restored.sources.listStudiesByEdition("edition-1")[0]?.ownerId).toBe("destination-owner")
  const edition = restored.sources.getEdition("edition-1")
  expect(edition).not.toBeNull()
  if (edition)
    expect(readFileSync(restored.blobs.pathFor(edition.originalBlobHash), "utf8")).toBe(
      "Synthetic immutable source",
    )
  restored.close()
})

it("rejects a nonempty destination without changing either library", () => {
  // Given an existing destination library.
  const source = library("source", true)
  const destination = library("destination", true)
  const before = captureLibrary(destination)
  // When restoring into it, then reject without changing domain data.
  expect(() => restoreLibrary(destination, captureLibrary(source))).toThrow(/empty/)
  expect(captureLibrary(destination)).toEqual(before)
})

it("rejects corrupt bytes in staging without adding domain rows", () => {
  // Given a damaged archive.
  const destination = library("destination")
  const original = captureLibrary(library("source", true)).toString("utf8")
  const damaged = original.replace(
    Buffer.from("Synthetic immutable source").toString("base64"),
    "AAAA",
  )
  // When the staged archive fails its digest check, then the destination stays empty.
  expect(() => restoreLibrary(destination, Buffer.from(damaged))).toThrow()
  const storage = openStorage(destination)
  expect(storage.counts().editions).toBe(0)
  storage.close()
})

it("restores an executed graph with historical grants, paused jobs, and no publication authority", () => {
  // Given a full graph, a running lease and distinct destination credentials.
  const paths = library("owner-1", true)
  const destination = library("new-owner")
  const storage = openStorage(paths)
  const fixture = completeGraphFixtures()
  const hash = storage.sources.getEdition("edition-1")?.originalHash
  const setup = { ...fixture.setup, analysis: { ...fixture.setup.analysis, editionHash: hash } }
  const cacheInput = AnalysisCacheInput.parse(setup.analysis)
  storage.sources.createInstallation({ id: "installation-1", ownerId: "owner-1" })
  storage.sources.appendSetup({ record: setup, parentRevisionId: null })
  storage.sources.appendGrant(fixture.grant)
  storage.workflow.appendAnalysis({
    record: { ...fixture.analysis, cacheInput, cacheKey: analysisCacheKey(cacheInput) },
    parentRevisionId: null,
  })
  storage.workflow.appendQuestion({ record: fixture.question, parentRevisionId: null })
  storage.workflow.appendAnswer({
    id: "input-1",
    studyId: "study-1",
    parentRevisionId: null,
    submission: fixture.submission,
  })
  storage.workflow.appendBrief({ record: fixture.brief, parentRevisionId: null })
  storage.workflow.appendOutline({ record: fixture.outline, parentRevisionId: null })
  storage.workflow.appendLesson({ record: fixture.lesson, parentRevisionId: null })
  storage.workflow.appendEvidenceReport(fixture.evidenceReport)
  storage.workflow.appendPrivacyReview({ record: fixture.privacyReview, parentRevisionId: null })
  storage.workflow.appendPublication({ record: fixture.publication, parentRevisionId: null })
  storage.execution.appendRun({ ...fixture.run, state: "running" })
  storage.execution.appendAttempt(fixture.attempt)
  storage.execution.appendJob(fixture.job)
  storage.execution.claimNextJob({
    token: "LEASE-CANARY",
    now: "2026-09-21T00:00:01Z",
    expiresAt: "2026-09-21T00:00:02Z",
  })
  storage.close()
  // When backing up and restoring the executed graph.
  const archive = captureLibrary(paths)
  restoreLibrary(destination, archive)
  // Then no source authority can execute or publish on the destination.
  expect(archive.toString()).not.toContain("LEASE-CANARY")
  expect(archive.toString()).not.toContain("owner-1")
  const restored = openStorage(destination)
  const job = restored.execution.getJob("job-1")
  expect(job).toMatchObject({
    state: "paused",
    reason: "restored",
    grant: { kind: "historical", ownerId: "new-owner" },
  })
  expect(Job.safeParse({ ...job, state: "queued" }).success).toBe(false)
  expect(
    restored.execution.claimNextJob({
      token: "destination",
      now: "2026-09-22T00:00:01Z",
      expiresAt: "2026-09-22T00:00:02Z",
    }),
  ).toBeNull()
  expect(restored.workflow.getLesson("lesson-1")?.id).toBe("lesson-1")
  expect(restored.counts()).toMatchObject({
    approvals: 0,
    publications: 0,
    privacyReviews: 0,
    jobs: 1,
  })
  restored.close()
  const { sqlite } = openDatabase(destination.databasePath)
  expect(sqlite.prepare("SELECT password FROM auth_accounts").get()).toEqual({
    password: "PASSWORD-CANARY",
  })
  expect(sqlite.prepare("SELECT lease_token, lease_fence FROM jobs").get()).toEqual({
    lease_token: null,
    lease_fence: 0,
  })
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM backup_history").get()).toEqual({ count: 5 })
  sqlite.close()
  expect(() => captureLibrary(destination)).not.toThrow()
})

it("rolls back all domain inserts and preserves auth when the destination rejects a late insert", () => {
  // Given a destination-specific failure after source rows and blobs are staged.
  const destination = library("destination")
  const { sqlite } = openDatabase(destination.databasePath)
  sqlite.exec(
    "CREATE TRIGGER fail_restore BEFORE INSERT ON studies BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
  )
  const authBefore = sqlite.prepare("SELECT * FROM auth_users").all()
  sqlite.close()
  // When a destination trigger aborts the transaction.
  expect(() => restoreLibrary(destination, captureLibrary(library("source", true)))).toThrow(
    /injected failure/,
  )
  // Then no partial graph or authentication changes are visible.
  const after = openDatabase(destination.databasePath).sqlite
  expect(after.prepare("SELECT * FROM auth_users").all()).toEqual(authBefore)
  expect(after.prepare("SELECT id FROM book_editions").all()).toEqual([])
  expect(after.prepare("SELECT id FROM installations").all()).toEqual([])
  after.close()
})

it("refuses a snapshot while a paid dispatch has no durable receipt", () => {
  const paths = library("owner-1", true)
  const storage = openStorage(paths)
  const fixture = completeGraphFixtures()
  const hash = storage.sources.getEdition("edition-1")?.originalHash
  const setup = { ...fixture.setup, analysis: { ...fixture.setup.analysis, editionHash: hash } }
  const cacheInput = AnalysisCacheInput.parse(setup.analysis)
  storage.sources.createInstallation({ id: "installation-1", ownerId: "owner-1" })
  storage.sources.appendSetup({ record: setup, parentRevisionId: null })
  storage.sources.appendGrant(fixture.grant)
  storage.workflow.appendAnalysis({
    record: { ...fixture.analysis, cacheInput, cacheKey: analysisCacheKey(cacheInput) },
    parentRevisionId: null,
  })
  storage.workflow.appendQuestion({ record: fixture.question, parentRevisionId: null })
  storage.workflow.appendAnswer({
    id: "input-1",
    studyId: "study-1",
    parentRevisionId: null,
    submission: fixture.submission,
  })
  storage.execution.appendRun({ ...fixture.run, state: "running" })
  storage.execution.appendAttempt(fixture.attempt)
  storage.execution.appendJob(fixture.job)
  storage.close()
  const { sqlite } = openDatabase(paths.databasePath)
  sqlite
    .prepare("UPDATE external_attempts SET state = 'dispatching', record_json = ? WHERE id = ?")
    .run(
      JSON.stringify({
        ...fixture.attempt,
        state: "dispatching",
        dispatchedAt: "2026-09-21T00:00:01Z",
      }),
      fixture.attempt.id,
    )
  sqlite.close()

  expect(() => captureLibrary(paths, 100)).toThrow(/dispatch|unknown|drain/i)
})

it("releases a timed-out drain and requires explicit recovery after an operator crash", () => {
  const paths = library("owner", true)
  const storage = openStorage(paths)
  const request = storage.maintenance.enter()
  if (request === null) throw new TypeError("request admission failed")
  expect(() => captureLibrary(paths, 75)).toThrow(/timed out/)
  expect(storage.maintenance.active()).toBe(false)
  storage.maintenance.leave(request)
  const sqlite = openDatabase(paths.databasePath).sqlite
  sqlite
    .prepare("UPDATE maintenance_gate SET phase = 'frozen', token = 'crashed' WHERE id = 1")
    .run()
  sqlite.prepare("INSERT INTO maintenance_requests (token) VALUES ('orphan')").run()
  expect(() => captureLibrary(paths, 75)).toThrow(/already active/)
  expect(() => recoverMaintenance(sqlite)).toThrow(/active|quiesc/i)
  storage.close()
  recoverMaintenance(sqlite)
  sqlite.close()
  expect(captureLibrary(paths).byteLength).toBeGreaterThan(0)
})

it("deletes a project without removing a shared source or another project", () => {
  // Given two projects on one immutable source.
  const paths = library("owner", true)
  const storage = openStorage(paths)
  storage.sources.createStudy({ id: "study-2", ownerId: "owner", editionId: "edition-1" })
  const hash = storage.sources.getEdition("edition-1")?.originalBlobHash
  storage.close()
  // When deleting the first project.
  const result = deleteLibraryItem(paths, { kind: "project", id: "study-1" })
  // Then the shared source, sibling project and auth remain.
  expect(result.deletedRows).toBe(1)
  expect(result.sharedBlobs).toContain(hash)
  const reopened = openStorage(paths)
  expect(reopened.sources.listStudiesByEdition("edition-1").map((study) => study.id)).toEqual([
    "study-2",
  ])
  expect(reopened.counts().editions).toBe(1)
  reopened.close()
})

it("deletes a source and its dependent projects without deleting destination credentials", () => {
  // Given a source with a project and authentication records.
  const paths = library("owner", true)
  // When deleting the source.
  const result = deleteLibraryItem(paths, { kind: "source", id: "edition-1" })
  // Then descendants disappear but auth remains.
  expect(result.retainedBlobs).toEqual([])
  const storage = openStorage(paths)
  expect(storage.counts()).toMatchObject({
    editions: 0,
    studies: 0,
    normalizations: 0,
    sourceBlocks: 0,
  })
  storage.close()
  const { sqlite } = openDatabase(paths.databasePath)
  expect(sqlite.prepare("SELECT id FROM auth_users").get()).toEqual({ id: "owner" })
  expect(
    sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = 'book_editions_no_delete'",
      )
      .get(),
  ).toEqual({ count: 1 })
  sqlite.close()
})
