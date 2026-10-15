import { execFileSync } from "node:child_process"
import { chromium, expect as visible } from "@playwright/test"
import { epubEntries, zipFixture } from "@reading-studio/ingestion/test-support"
import { expect, it } from "vitest"
import { LibraryContext } from "../../apps/studio/src/library/client.ts"
import { Library } from "../../apps/studio/src/source-viewer/client.ts"
import { startLocalMatrix } from "../deployment/matrix-local.ts"
import { syntheticEpub } from "../e2e/synthetic-epub.ts"

it("TEN-16 S3 T5 inspects missing owned prerequisites with a next-step link and no mutation", async () => {
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const browser = await chromium.launch()
  const inherited = process.env["VITEST"]
  delete process.env["VITEST"]
  const running = await startLocalMatrix(browser).finally(() => {
    if (inherited !== undefined) process.env["VITEST"] = inherited
  })
  try {
    const { page, origin } = running.deployment
    await page.goto(`${origin}/login`)
    await page.getByLabel("Email").fill("owner@example.test")
    await page.getByLabel("Password").fill("correct horse battery staple")
    await page.getByRole("button", { name: "Log in", exact: true }).click()
    await page.waitForURL(`${origin}/`)
    await page.getByRole("status", { name: "Entering the library" }).waitFor({ state: "detached" })
    for (const bytes of [await syntheticEpub(), zipFixture(epubEntries)]) {
      expect(
        (
          await page.request.post(`${origin}/api/imports/upload`, {
            data: bytes,
            headers: { origin, "content-type": "application/epub+zip" },
          })
        ).status(),
      ).toBe(202)
    }
    const sources = async () =>
      Library.parse(await (await page.request.get(`${origin}/api/source-library`)).json())
    await expect.poll(async () => (await sources()).documents.length, { timeout: 60_000 }).toBe(2)
    const records = await sources()
    const context = LibraryContext.parse(
      await (await page.request.get(`${origin}/api/library-context`)).json(),
    )
    expect(context.studies).toHaveLength(2)
    for (const study of context.studies) {
      const source = records.documents.find((item) => item.edition.id === study.editionId)
      if (!source) throw new TypeError("Study has no owned persisted source")
      expect(study.title).toBe(source.edition.title)
      expect(
        (
          await page.request.post(`${origin}/api/library-selection`, {
            data: { studyId: study.id },
            headers: { origin },
          })
        ).status(),
      ).toBe(200)
      await page.reload()
      const baseline = (await running.deployment.snapshot()).counts
      const writes: string[] = []
      const watch = (request: import("@playwright/test").Request) => {
        if (request.method() !== "GET") writes.push(new URL(request.url()).pathname)
      }
      page.on("request", watch)
      await page
        .getByRole("navigation", { name: "Reading route / 読書ルート" })
        .getByRole("button", { name: /Reference desk/ })
        .click()
      await visible(page.locator("#desk-body")).toContainText(/question bank/i)
      await visible(page.getByRole("link", { name: /Lending desk/ })).toHaveAttribute(
        "href",
        `/sources/${source.normalization.id}/setup`,
      )
      expect(writes).toEqual([])
      expect((await running.deployment.snapshot()).counts).toEqual(baseline)
      await page.getByRole("button", { name: "Return to hall / 広間に戻る", exact: true }).click()
      await page
        .getByRole("navigation", { name: "Reading route / 読書ルート" })
        .getByRole("button", { name: /Display case/ })
        .click()
      await visible(page.getByRole("link", { name: /Review room/ })).toHaveAttribute(
        "href",
        `/evidence/${study.id}`,
      )
      await visible(page.getByRole("button", { name: /Publish \/ / })).toHaveCount(0)
      expect(writes).toEqual([])
      expect((await running.deployment.snapshot()).counts).toEqual(baseline)
      expect(await running.deployment.wireCount()).toBe(0)
      page.off("request", watch)
      await page.getByRole("button", { name: "Return to hall / 広間に戻る", exact: true }).click()
    }
  } finally {
    await running.stop()
    await browser.close()
  }
}, 300_000)
