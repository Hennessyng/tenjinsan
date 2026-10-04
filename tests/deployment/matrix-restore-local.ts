import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { type Browser, type BrowserContext, expect } from "@playwright/test"
import { z } from "zod"
import {
  type LocalFixture,
  LocalLauncher,
  makeLocalFixture,
  removeLocalFixture,
  workspaceRoot,
} from "./local-fixture.ts"
import { assertRestoredLibrary, type RestoreTargets, runAgeTransfer } from "./matrix-restore.ts"
import { readRestoreInspection } from "./matrix-restore-inspect.ts"

export async function restoreLocalMatrix(
  browser: Browser,
  source: LocalFixture,
  targets: RestoreTargets,
) {
  const sourcePaths = z
    .object({ DATABASE_PATH: z.string(), PRIVATE_DATA_ROOT: z.string() })
    .parse(source.environment)
  const beforeSource = readRestoreInspection(
    sourcePaths.DATABASE_PATH,
    sourcePaths.PRIVATE_DATA_ROOT,
  )
  if (Object.values(beforeSource.maintenanceBlockers).some((count) => count > 0))
    throw new TypeError(
      `Source needs maintenance drain: ${JSON.stringify(beforeSource.maintenanceBlockers)}`,
    )
  const destination = await makeLocalFixture(false)
  const environment = { ...destination.environment }
  for (const key of [
    "STUDIO_SYNTHETIC_TEST_MODE",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "STUDIO_PROVIDER_BASE_URL",
  ])
    delete environment[key]
  const destinationPaths = z
    .object({ DATABASE_PATH: z.string(), PRIVATE_DATA_ROOT: z.string() })
    .parse(environment)
  let launcher: LocalLauncher | undefined
  let context: BrowserContext | undefined
  let freshContext: BrowserContext | undefined
  try {
    const provisioned = spawnSync(
      "expect",
      ["tests/deployment/owner-tty-fixture.exp", "--destination", "bun", "run", "owner"],
      { cwd: workspaceRoot, env: environment, timeout: 90_000, encoding: "utf8" },
    )
    expect(provisioned.status).toBe(0)
    const before = readRestoreInspection(
      destinationPaths.DATABASE_PATH,
      destinationPaths.PRIVATE_DATA_ROOT,
    )
    expect(destination.directory).not.toBe(source.directory)
    expect(destinationPaths.DATABASE_PATH).not.toBe(sourcePaths.DATABASE_PATH)
    expect(destinationPaths.PRIVATE_DATA_ROOT).not.toBe(sourcePaths.PRIVATE_DATA_ROOT)
    launcher = new LocalLauncher(environment)
    const ready = await launcher.ready()
    context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${ready.apiUrl}/login`)
    await page.getByLabel("Email").fill("destination-owner@example.test")
    await page.getByLabel("Password").fill("correct horse battery staple")
    await page.getByRole("button", { name: "Log in" }).click()
    await expect(page.locator("#root")).toBeVisible()
    const destinationSessionCookie = (await context.cookies(ready.apiUrl)).find((cookie) =>
      cookie.name.endsWith("better-auth.session_token"),
    )?.value
    expect(destinationSessionCookie).toBeTruthy()
    expect(destinationSessionCookie).not.toBe(targets.sourceSessionCookie)
    const archive = runAgeTransfer(
      [
        "local",
        join(source.directory, "matrix-source.age"),
        sourcePaths.DATABASE_PATH,
        sourcePaths.PRIVATE_DATA_ROOT,
        join(destination.directory, "matrix-destination.age"),
        destinationPaths.DATABASE_PATH,
        destinationPaths.PRIVATE_DATA_ROOT,
      ],
      environment,
    )
    const restored = readRestoreInspection(
      destinationPaths.DATABASE_PATH,
      destinationPaths.PRIVATE_DATA_ROOT,
    )
    assertRestoredLibrary({ source: beforeSource, before, restored, archive })
    const afterSource = readRestoreInspection(
      sourcePaths.DATABASE_PATH,
      sourcePaths.PRIVATE_DATA_ROOT,
    )
    expect(JSON.stringify(afterSource) === JSON.stringify(beforeSource)).toBe(true)
    const current = await page.request.get(`${ready.apiUrl}/api/publications/${targets.studyId}`)
    expect(current.status()).toBe(200)
    expect(
      z.object({ history: z.array(z.unknown()).length(0) }).parse(await current.json()),
    ).toBeDefined()
    const generation = await page.request.post(
      `${ready.apiUrl}/api/publications/${targets.studyId}/outputs/${targets.publicationId}`,
      { data: {}, headers: { origin: ready.apiUrl } },
    )
    expect(generation.status()).toBe(404)
    const download = await page.request.get(
      `${ready.apiUrl}/publication-artifacts/${targets.outputId}`,
    )
    expect(download.status()).toBe(404)
    const ledger = await page.request.get(`${ready.apiUrl}/api/study-jobs`)
    expect(ledger.status()).toBe(200)
    expect(
      z
        .object({ jobs: z.array(z.object({ state: z.string() })).length(0) })
        .parse(await ledger.json()).jobs,
    ).toEqual([])
    freshContext = await browser.newContext()
    const freshPage = await freshContext.newPage()
    await freshPage.goto(`${ready.apiUrl}/login`)
    await freshPage.getByLabel("Email").fill("destination-owner@example.test")
    await freshPage.getByLabel("Password").fill("correct horse battery staple")
    await freshPage.getByRole("button", { name: "Log in" }).click()
    await expect(freshPage.locator("#root")).toBeVisible()
    const fresh = await freshPage.request.get(`${ready.apiUrl}/api/publications/${targets.studyId}`)
    expect(fresh.status()).toBe(200)
    await launcher.stop(ready.launcherPid)
    return {
      archive,
      destinationOwnerId: restored.owner.id,
      restoredStudies: restored.studies.length,
      pausedJobs: restored.jobs.length,
      historicalGrants: restored.grants.length,
      verifiedBlobCount: restored.blobs.length,
      allBlobsMatched: true as const,
      destinationCredentialPreserved: true as const,
      publicStudyHttp: current.status(),
      historicalGenerationHttp: generation.status(),
      historicalDownloadHttp: download.status(),
      activeSessionHttp: ledger.status(),
      freshLoginHttp: fresh.status(),
      separateStorage: true,
      sessionCookiesDistinct: true,
      wrongPassphraseRejected: true,
      corruptCiphertextRejected: true,
    }
  } finally {
    await freshContext?.close()
    await context?.close()
    if (launcher) {
      if (launcher.child.exitCode === null && launcher.child.signalCode === null)
        launcher.forceStop()
      await launcher.waitForExit()
    }
    await removeLocalFixture(destination)
  }
}
