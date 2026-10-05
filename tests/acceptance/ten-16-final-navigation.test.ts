import { execFileSync } from "node:child_process"
import { chromium, expect as visible } from "@playwright/test"
import { expect, it } from "vitest"
import { sourceViewerFixture } from "../../apps/server/src/testing/source-viewer-fixture.ts"

it("TEN-16 S1 F3 retains applicable language and history without carrying unrelated resource context", async () => {
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const fixture = await sourceViewerFixture({ studioAssets: true })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.waitForURL(`${fixture.origin}/`)
    const initial = "/?lang=ja&chapter=2&citation=unrelated&step=3#unrelated"
    await page.goto(`${fixture.origin}${initial}`)
    const navigation = page.getByRole("navigation", { name: "Reading route / 読書ルート" })
    await visible(navigation).toBeVisible()
    const importRoom = navigation.getByRole("button", { name: /1\. Accession/ })

    await importRoom.click()
    await visible(page.getByLabel("Choose EPUB")).toBeVisible()
    expect(new URL(page.url()).search).toBe("?lang=ja")
    expect(new URL(page.url()).hash).toBe("")
    await page.reload()
    await visible(page.getByLabel("Choose EPUB")).toBeVisible()
    expect(new URL(page.url()).search).toBe("?lang=ja")
    await page.goBack()
    await visible(page.getByRole("main")).toBeVisible()
    expect(
      new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash,
    ).toBe(initial)
    await importRoom.click()
    await importRoom.click()
    await visible(page.getByLabel("Choose EPUB")).toBeVisible()
    expect(new URL(page.url()).search).toBe("?lang=ja")
    await page.goto(`${fixture.origin}/sources/revision-fixture/setup?lang=ja&step=2`)
    const chapter = page.getByRole("checkbox", { name: "chapter-two.xhtml", exact: true })
    await visible(chapter).toBeVisible()
    const mutations: string[] = []
    page.on("request", (request) => {
      if (request.method() === "POST") mutations.push(new URL(request.url()).pathname)
    })
    await chapter.check()
    await importRoom.click()
    await visible(page.getByRole("dialog")).toBeVisible()
    await page.getByRole("button", { name: /^Stay/ }).click()
    await visible(chapter).toBeChecked()
    expect(new URL(page.url()).search).toBe("?lang=ja&step=2")
    await importRoom.click()
    await page.getByRole("button", { name: /^Leave and discard/ }).click()
    await visible(page.getByLabel("Choose EPUB")).toBeVisible()
    expect(new URL(page.url()).search).toBe("?lang=ja")
    expect(mutations).toEqual([])
    await page.goto(`${fixture.origin}/sources/revision-fixture?chapter=1`)
    await visible(page.getByText("Reading is a conversation across time.")).toBeVisible()
    await navigation.getByRole("button", { name: /2\. The stacks/ }).click()
    expect(new URL(page.url()).search).toBe("?chapter=1")
    await navigation.getByRole("button", { name: /3\. Lending desk/ }).click()
    await visible(
      page.getByRole("combobox", { name: "Provider and model", exact: true }),
    ).toBeVisible()
    expect(new URL(page.url()).search).toBe("")
    await page.goto(`${fixture.origin}/sources/revision-fixture/setup?lang=ja`)
    await visible(
      page.getByRole("combobox", { name: "Provider and model", exact: true }),
    ).toBeVisible()
    await navigation.getByRole("button", { name: /2\. The stacks/ }).click()
    await visible(page.getByText("Attention begins with a question.")).toBeVisible()
    expect(new URL(page.url()).searchParams.has("lang")).toBe(false)
  } finally {
    await browser.close()
    await fixture.close()
  }
}, 120_000)
