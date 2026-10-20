import { execFileSync } from "node:child_process"
import { chromium, expect as visible } from "@playwright/test"
import { expect, it } from "vitest"
import { InterviewState } from "../../apps/studio/src/interview/client.ts"
import { JobList } from "../../apps/studio/src/jobs/client.ts"
import { LibraryContext } from "../../apps/studio/src/library/client.ts"
import { startLocalMatrix } from "../deployment/matrix-deployments.ts"
import { syntheticEpub } from "../e2e/synthetic-epub.ts"

it("TEN-16 S4 F7 protects actual drafts after settled hall-to-native-room entry", async () => {
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const browser = await chromium.launch()
  const inherited = process.env["VITEST"]
  delete process.env["VITEST"]
  const running = await startLocalMatrix(browser).finally(() => {
    if (inherited !== undefined) process.env["VITEST"] = inherited
  })
  const { page, origin } = running.deployment
  try {
    await page.goto(`${origin}/login`)
    await page.getByLabel("Email").fill("owner@example.test")
    await page.getByLabel("Password").fill("correct horse battery staple")
    await page.getByRole("button", { name: "Log in", exact: true }).click()
    await page.waitForURL(`${origin}/`)
    await page.getByRole("status", { name: "Entering the library" }).waitFor({ state: "detached" })
    const route = page.getByRole("navigation", { name: "Reading route / 読書ルート" })
    await route.getByRole("button", { name: /Import & read/ }).click()
    await page.getByLabel("Choose EPUB").setInputFiles({
      name: "synthetic.epub",
      mimeType: "application/epub+zip",
      buffer: await syntheticEpub(),
    })
    await page.getByRole("button", { name: "Import EPUB", exact: true }).click()
    await visible(page.getByRole("heading", { name: "Import accepted" })).toBeVisible()
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${origin}/api/source-library`)).json()).documents.length,
      )
      .toBe(1)
    await page.getByRole("button", { name: "Return to hall / 広間に戻る", exact: true }).click()
    const context = LibraryContext.parse(
      await (await page.request.get(`${origin}/api/library-context`)).json(),
    )
    const study = context.studies[0]
    if (!study) throw new TypeError("Owned normalized study missing")
    await page.getByLabel("Selected study / 選択した読書").selectOption(study.id)
    const selected = page.waitForResponse((response) =>
      response.url().endsWith("/api/library-selection"),
    )
    await page.getByRole("button", { name: "Select study / 読書を選ぶ", exact: true }).click()
    expect((await selected).status()).toBe(200)
    await expect
      .poll(
        async () =>
          LibraryContext.parse(
            await (await page.request.get(`${origin}/api/library-context`)).json(),
          ).selectedStudyId,
      )
      .toBe(study.id)
    await route.getByRole("button", { name: /Lending desk/ }).click()
    await page.getByRole("button", { name: "Review transmission", exact: true }).click()
    await page.getByRole("button", { name: "Send", exact: true }).click()
    await visible(page.getByRole("heading", { name: "Transmission approved" })).toBeVisible()
    await expect
      .poll(async () => (await page.request.get(`${origin}/api/interviews/${study.id}`)).status())
      .toBe(200)
    await page.getByRole("button", { name: "Return to hall / 広間に戻る", exact: true }).click()
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }),
    )
    await visible(page.getByRole("main")).toHaveCount(1)
    await route.getByRole("button", { name: /Reference desk/ }).focus()
    await page.keyboard.press("Enter")
    await visible(page.getByLabel("Your own response")).toBeVisible()
    await visible(page.locator("#desk")).not.toHaveAttribute("role", "main")
    await visible(page.locator("#desk-title")).toBeFocused()
    await visible(page.getByRole("main")).toHaveCount(1)
    const interviewUrl = page.url()
    const stored = InterviewState.parse(
      await (await page.request.get(`${origin}/api/interviews/${study.id}`)).json(),
    )
    const jobs = JobList.parse(await (await page.request.get(`${origin}/api/study-jobs`)).json())
    const mutations: string[] = []
    page.on("request", (request) => {
      if (request.method() !== "GET") mutations.push(request.url())
    })
    await page.getByLabel("Your own response").fill("Unsaved owned draft through the hall")
    await route.getByRole("button", { name: /Display case/ }).click()
    await visible(page.getByRole("dialog")).toBeVisible()
    expect(page.url()).toBe(interviewUrl)
    await page.getByRole("button", { name: /Stay/ }).click()
    await visible(page.getByLabel("Your own response")).toHaveValue(
      "Unsaved owned draft through the hall",
    )
    await route.getByRole("button", { name: /Display case/ }).click()
    await visible(page.getByRole("dialog")).toBeVisible()
    await page.getByRole("button", { name: /Leave and discard/ }).click()
    await page.waitForURL(`${origin}/publications/${study.id}`)
    expect(mutations).toEqual([])
    await route.getByRole("button", { name: /Reference desk/ }).click()
    await visible(page.getByLabel("Your own response")).toHaveValue("")
    const after = InterviewState.parse(
      await (await page.request.get(`${origin}/api/interviews/${study.id}`)).json(),
    )
    expect(after.answers).toEqual(stored.answers)
    const observed = JobList.parse(
      await (await page.request.get(`${origin}/api/study-jobs`)).json(),
    )
    expect(observed.jobs.map(({ id, attempts }) => ({ id, attempts }))).toEqual(
      jobs.jobs.map(({ id, attempts }) => ({ id, attempts })),
    )
    await page.getByLabel("Notice", { exact: true }).check()
    const saved = page.waitForResponse(
      (response) =>
        response.url() === `${origin}/api/interviews/${study.id}` &&
        response.request().method() === "POST",
    )
    const documentStart = await page.evaluate(() => performance.timeOrigin)
    await page.getByRole("button", { name: "Save choices", exact: true }).click()
    expect((await saved).status()).toBe(200)
    await page.waitForFunction((started) => performance.timeOrigin !== started, documentStart)
    await page.waitForLoadState("load")
    await visible(page.getByRole("status").filter({ hasText: /saved/i })).toBeVisible()
    await route.getByRole("button", { name: /Display case/ }).click()
    await page.waitForURL(`${origin}/publications/${study.id}?lang=en`)
    await visible(page.getByRole("dialog")).toHaveCount(0)
    expect(mutations).toEqual([`${origin}/api/interviews/${study.id}`])
    await route.getByRole("button", { name: /Reference desk/ }).click()
    await visible(page.getByLabel("Notice", { exact: true })).toBeChecked()
    await visible(page.getByRole("main")).toHaveCount(1)
  } finally {
    await running.stop()
    await browser.close()
  }
}, 300_000)
