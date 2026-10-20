import { execFileSync } from "node:child_process"
import { chromium, expect as visible } from "@playwright/test"
import { expect, it } from "vitest"
import { z } from "zod"
import { JobList } from "../../apps/studio/src/jobs/client.ts"
import { LibraryContext } from "../../apps/studio/src/library/client.ts"
import { Library } from "../../apps/studio/src/source-viewer/client.ts"
import { startLocalMatrix } from "../deployment/matrix-local.ts"
import { syntheticEpub } from "../e2e/synthetic-epub.ts"

it("TEN-16 S2 T4 observes a recorded unknown outcome without another decision or paid attempt", async () => {
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const browser = await chromium.launch()
  const inherited = process.env["VITEST"]
  delete process.env["VITEST"]
  const running = await startLocalMatrix(browser).finally(() => {
    if (inherited !== undefined) process.env["VITEST"] = inherited
  })
  try {
    const { page, origin } = running.deployment
    const post = (path: string, data: object) =>
      page.request.post(`${origin}${path}`, { data, headers: { origin } })
    const jobs = async () =>
      JobList.parse(await (await page.request.get(`${origin}/api/study-jobs`)).json()).jobs
    await page.goto(`${origin}/login`)
    await page.getByLabel("Email").fill("owner@example.test")
    await page.getByLabel("Password").fill("correct horse battery staple")
    await page.getByRole("button", { name: "Log in", exact: true }).click()
    await page.waitForURL(`${origin}/`)
    await page.getByRole("status", { name: "Entering the library" }).waitFor({ state: "detached" })
    expect(
      (
        await page.request.post(`${origin}/api/imports/upload`, {
          data: await syntheticEpub(),
          headers: { origin, "content-type": "application/epub+zip" },
        })
      ).status(),
    ).toBe(202)
    await expect
      .poll(
        async () =>
          Library.parse(await (await page.request.get(`${origin}/api/source-library`)).json())
            .documents.length,
        { timeout: 60_000 },
      )
      .toBe(1)
    const source = Library.parse(
      await (await page.request.get(`${origin}/api/source-library`)).json(),
    ).documents[0]
    const study = LibraryContext.parse(
      await (await page.request.get(`${origin}/api/library-context`)).json(),
    ).studies[0]
    if (!source || !study) throw new TypeError("Persisted synthetic study missing")
    const setupResponse = await post(`/api/study-setup/${source.normalization.id}`, {
      provider: "openrouter",
      model: "gpt-4.1-mini",
    })
    expect(setupResponse.status()).toBe(201)
    const setupId = z.object({ setupId: z.string() }).parse(await setupResponse.json()).setupId
    await running.deployment.fault("hold")
    expect(
      (
        await post(`/api/study-setup/${source.normalization.id}/${setupId}`, { decision: "send" })
      ).status(),
    ).toBe(200)
    expect((await post("/api/library-selection", { studyId: study.id })).status()).toBe(200)
    await expect.poll(async () => running.deployment.heldCount(), { timeout: 60_000 }).toBe(1)
    await page
      .getByRole("navigation", { name: "Reading route / 読書ルート" })
      .getByRole("button", { name: /Bindery/ })
      .click()
    await visible(page.getByRole("heading", { name: /analysis · running/ })).toBeVisible()
    const held = (await jobs()).find((job) => job.stage === "analysis" && job.state === "running")
    if (!held) throw new TypeError("Held persisted analysis job missing")
    const writes: string[] = []
    page.on("request", (request) => {
      if (request.method() !== "GET") writes.push(new URL(request.url()).pathname)
    })
    const control = page.getByRole("button", { name: /Refresh status/ })
    await control.focus()
    await running.deployment.fault("normal")
    await running.deployment.releaseHeld()
    await expect
      .poll(async () => (await jobs()).find((job) => job.stage === "analysis")?.state, {
        timeout: 60_000,
      })
      .toBe("paused")
    await visible(page.getByRole("heading", { name: /analysis · paused/ })).toBeVisible({
      timeout: 15_000,
    })
    await visible(control).toBeFocused()
    const baseline = await jobs()
    expect(baseline.find((job) => job.id === held.id)).toMatchObject({
      state: "paused",
      reason: "outcome_unknown",
      attempts: held.attempts,
    })
    const calls = await running.deployment.wireCount()
    for (let observation = 0; observation < 3; observation++) {
      await page.waitForResponse(
        (response) =>
          response.request().method() === "GET" && response.url().endsWith("/api/study-jobs"),
      )
    }
    expect(await jobs()).toEqual(baseline)
    expect(await running.deployment.wireCount()).toBe(calls)
    expect(writes).toEqual([])
    await page.getByRole("button", { name: "Return to hall / 広間に戻る", exact: true }).click()
    const stopped: string[] = []
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/study-jobs") stopped.push(request.url())
    })
    await page
      .getByRole("navigation", { name: "Reading route / 読書ルート" })
      .getByRole("button", { name: /Import & read/ })
      .click()
    await visible(page.getByLabel("Choose EPUB")).toBeVisible()
    expect(stopped).toEqual([])
  } finally {
    await running.stop()
    await browser.close()
  }
}, 300_000)
