import { expect, test } from "@playwright/test"
import { readTask31Records } from "@reading-studio/server/task31-records"
import { openStorage } from "@reading-studio/storage"
import { LocalLauncher, makeLocalFixture, removeLocalFixture } from "../deployment/local-fixture.ts"
import { runDeployedJourney, verifyDeployedOffline } from "./deployed-journey.ts"
import { assertSavedManifest, verifyDeployedEvidence } from "./verify-deployed-evidence.ts"

const evidence = ".omo/evidence/reading-studio/task-31/deployed-local"

test("local launcher completes a consented synthetic study and offline export", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000)
  const fixture = await makeLocalFixture(true)
  const launcher = new LocalLauncher({
    ...fixture.environment,
    STUDIO_SYNTHETIC_TEST_MODE: "enabled",
  })
  try {
    const ready = await launcher.ready()
    const journey = await runDeployedJourney(page, ready.apiUrl, evidence)
    expect(journey).toHaveProperty("runId", expect.any(String))
    expect(journey).toHaveProperty("manifestPath", expect.stringContaining("/runs/"))
    const { lessonId } = journey
    const databasePath = fixture.environment["DATABASE_PATH"]
    const privateDataRoot = fixture.environment["PRIVATE_DATA_ROOT"]
    if (!databasePath || !privateDataRoot) throw new TypeError("Missing fixture database")
    const storage = openStorage({ databasePath, privateDataRoot })
    let records: ReturnType<typeof readTask31Records>
    try {
      expect(storage.workflow.getLesson(lessonId)).not.toBeNull()
      expect(storage.counts().attempts).toBeGreaterThan(0)
      expect(storage.counts().grants).toBe(1)
      records = readTask31Records(storage, journey.studyId, journey.forkId)
      expect(records.fork.parent).toEqual({
        studyId: journey.studyId,
        setupRevisionId: records.original.setupId,
      })
      expect(records.original.publication.lessonId).toBe(lessonId)
      expect(records.original.outputs.map((output) => output.state)).toEqual([
        "released",
        "released",
      ])
    } finally {
      storage.close()
    }
    await launcher.stop(ready.launcherPid)
    await verifyDeployedOffline(browser, journey.runDir)
    await verifyDeployedEvidence(journey, records, "local")
    await assertSavedManifest(journey, records, "local")
  } finally {
    launcher.forceStop()
    await removeLocalFixture(fixture)
  }
})
