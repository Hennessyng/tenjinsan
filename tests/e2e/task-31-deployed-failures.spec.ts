import { expect, test } from "@playwright/test"
import { analysisCacheKey, contentDigest } from "@reading-studio/contracts"
import { openStorage } from "@reading-studio/storage"
import { LocalLauncher, makeLocalFixture, removeLocalFixture } from "../deployment/local-fixture.ts"
import { syntheticEpub } from "./synthetic-epub.ts"

for (const [fault, state] of [
  ["invalid-output", "failed"],
  ["accepted-timeout", "paused"],
] as const) {
  test(`local fixture ${fault} retains an honest ${state} paid-attempt state`, async ({ page }) => {
    test.setTimeout(60_000)
    const fixture = await makeLocalFixture(true)
    const launcher = new LocalLauncher({
      ...fixture.environment,
      STUDIO_SYNTHETIC_TEST_MODE: "enabled",
      STUDIO_SYNTHETIC_TEST_FAULT: fault,
    })
    try {
      const ready = await launcher.ready()
      await page.goto(`${ready.apiUrl}/login`)
      await page.getByLabel("Email").fill("owner@example.test")
      await page.getByLabel("Password").fill("correct horse battery staple")
      await page.getByRole("button", { name: "Log in" }).click()
      const upload = await page.request.post(`${ready.apiUrl}/api/imports/upload`, {
        headers: { origin: ready.apiUrl, "content-type": "application/epub+zip" },
        data: await syntheticEpub(),
      })
      expect(upload.status()).toBe(202)
      await page.goto(`${ready.apiUrl}/sources`)
      await page.getByRole("link", { name: "Synthetic attention journal" }).click()
      await page.getByRole("link", { name: "Set up a study" }).click()
      await page.getByRole("button", { name: "Review transmission" }).click()
      await expect(page.getByRole("heading", { name: "Review transmission" })).toBeVisible()
      const setupId = new URL(page.url()).pathname.split("/").at(-1)
      if (!setupId) throw new TypeError("Missing reviewed setup")
      await page.getByRole("button", { name: "Send", exact: true }).click()
      await expect(page.getByRole("heading", { name: "Transmission approved" })).toBeVisible()
      const databasePath = fixture.environment["DATABASE_PATH"]
      const privateDataRoot = fixture.environment["PRIVATE_DATA_ROOT"]
      if (!databasePath || !privateDataRoot) throw new TypeError("Missing fixture database")
      const storage = openStorage({ databasePath, privateDataRoot })
      try {
        const setup = storage.sources.getSetup(setupId)
        if (!setup) throw new TypeError("Missing persisted setup")
        const identity = contentDigest(
          JSON.stringify([setup.id, `grant-${setup.id}`, analysisCacheKey(setup.analysis)]),
        )
        const runId = `${identity}-0`
        await expect
          .poll(() => storage.execution.getJob(runId)?.state, { timeout: 10_000 })
          .toBe(state)
        const attempts = storage.execution.listAttempts(runId)
        expect(attempts).toHaveLength(fault === "invalid-output" ? 2 : 1)
        expect(attempts.map((attempt) => attempt.state)).toEqual(
          fault === "accepted-timeout"
            ? ["outcome_unknown"]
            : ["response-received", "response-received"],
        )
        expect(storage.interviews.latest(setup.studyId)).toBeNull()
      } finally {
        storage.close()
      }
      await launcher.stop(ready.launcherPid)
    } finally {
      launcher.forceStop()
      await removeLocalFixture(fixture)
    }
  })
}
