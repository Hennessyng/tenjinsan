import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { AnalysisCacheInput, analysisCacheKey } from "@reading-studio/contracts"
import { afterEach, expect, it } from "vitest"
import { captureLibrary, restoreLibrary } from "../src/backup.ts"
import { openStorage } from "../src/index.ts"
import { cleanupLibraries, library } from "./backup-fixture.ts"
import { completeGraphFixtures } from "./fixtures.ts"

afterEach(cleanupLibraries)

it("backs up a stopped unknown attempt without erasing its uncertain paid history", () => {
  const paths = library("owner-1", true)
  const destination = library("destination")
  const storage = openStorage(paths)
  const fixture = completeGraphFixtures()
  const editionHash = storage.sources.getEdition("edition-1")?.originalHash
  const setup = {
    ...fixture.setup,
    analysis: { ...fixture.setup.analysis, editionHash },
  }
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
  storage.execution.appendRun({ ...fixture.run, state: "paused" })
  storage.execution.appendAttempt({
    ...fixture.attempt,
    state: "outcome_unknown",
    dispatchedAt: fixture.attempt.preparedAt,
    usage: { kind: "unknown" },
    resolution: "awaiting-owner",
  })
  storage.execution.appendJob({ ...fixture.job, state: "paused", reason: "outcome_unknown" })
  storage.close()

  expect(() => captureLibrary(paths, 100)).toThrow(/drain timed out/)

  const owner = openStorage(paths)
  const decision = { attemptId: fixture.attempt.id, resolution: "stop-approved" }
  const resolved = owner.execution.resolveUnknownAttempt(decision)
  expect(owner.execution.getJob(fixture.job.id)?.state).toBe("cancelled")
  expect(owner.execution.getRun(fixture.run.id)?.state).toBe("cancelled")
  owner.close()

  const child = spawnSync(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--experimental-transform-types",
      fileURLToPath(new URL("../../../tests/deployment/maintenance-capture.ts", import.meta.url)),
      paths.databasePath,
      paths.privateDataRoot,
    ],
    { encoding: "buffer", timeout: 10_000 },
  )
  expect(child.status, child.stderr.toString()).toBe(0)
  const archive = child.stdout
  expect(archive.byteLength).toBeGreaterThan(0)
  const payload = JSON.parse(archive.toString("utf8"))
  const attempts = payload.payload.tables.find(
    (table: { name: string }) => table.name === "external_attempts",
  )
  expect(JSON.parse(attempts.rows[0].record_json)).toMatchObject({
    state: "outcome_unknown",
    resolution: "stop-approved",
    usage: { kind: "unknown" },
  })
  const checked = openStorage(paths)
  expect(checked.execution.resolveUnknownAttempt(decision)).toEqual(resolved)
  expect(() =>
    checked.execution.resolveUnknownAttempt({
      attemptId: fixture.attempt.id,
      resolution: "retry-approved",
    }),
  ).toThrow(/awaiting owner/)
  checked.close()
  restoreLibrary(destination, archive)
  const restored = openStorage(destination)
  expect(restored.execution.listAttempts(fixture.run.id)[0]).toMatchObject({
    state: "outcome_unknown",
    usage: { kind: "unknown" },
    resolution: "stop-approved",
  })
  expect(restored.execution.getJob(fixture.job.id)?.state).toBe("paused")
  expect(
    restored.execution.claimNextJob({
      token: "should-not-run",
      now: "2026-09-22T00:00:01Z",
      expiresAt: "2026-09-22T00:00:02Z",
    }),
  ).toBeNull()
  restored.close()
})
