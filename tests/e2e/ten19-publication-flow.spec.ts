import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import { expect, test } from "@playwright/test"
import { publicationFixture } from "@reading-studio/server/publication-fixture"

const run = promisify(execFile)

test("published file language survives a later app-language switch through HTML and PDF release", async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const fixture = await publicationFixture({ studioAssets: true })
  const context = await browser.newContext()
  try {
    await context.addInitScript(() => localStorage.setItem("tenjinsan.ui-language", "ja"))
    const page = await context.newPage()
    await page.goto(`${fixture.origin}/publications/${fixture.lesson.studyId}`)
    await page.getByRole("combobox", { name: "出力ファイルの表示言語" }).selectOption("ja")
    await page.getByRole("button", { name: "公開用に承認", exact: true }).click()
    await expect(page.locator("#export-ui")).toBeDisabled()
    await expect(page.locator("#export-ui")).toHaveValue("ja")
    await page.getByRole("button", { name: "English", exact: true }).click()
    await expect(page.getByRole("dialog")).not.toBeVisible()
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    await expect(page.locator("#export-ui")).toHaveValue("ja")
    await page.getByRole("button", { name: "Generate approved files", exact: true }).click()
    await expect(
      page.getByRole("link", { name: "Download PDF · version 1", exact: true }),
    ).toBeVisible({ timeout: 60_000 })
    const snapshot = fixture.storage.publicationOutputs.list(fixture.lesson.studyId)[0]
    if (!snapshot) throw new TypeError("Missing published snapshot")
    const outputs = fixture.storage.publicationOutputs.outputs(snapshot.publication.id)
    expect(outputs.map((output) => [output.format, output.state, output.exportUi])).toEqual([
      ["html", "released", "ja"],
      ["pdf", "released", "ja"],
    ])
    const htmlJob = outputs.find((output) => output.format === "html")
    const pdfJob = outputs.find((output) => output.format === "pdf")
    if (!htmlJob || !pdfJob) throw new TypeError("Missing released outputs")
    const html = await (await fetch(`${fixture.origin}/publication-artifacts/${htmlJob.id}`)).text()
    expect(html).toContain('<legend><span data-ui-copy lang="ja">本文の表示言語</span></legend>')
    expect(html).not.toContain("tenjinsan.ui-language")
    const evidence = join(
      process.cwd(),
      ".sisyphus/runs/TEN-19/evidence/publication-flow",
      crypto.randomUUID(),
    )
    await mkdir(evidence, { recursive: true })
    await writeFile(join(evidence, "lesson.html"), html)
    const pdf = join(evidence, "lesson.pdf")
    await writeFile(
      pdf,
      Buffer.from(
        await (await fetch(`${fixture.origin}/publication-artifacts/${pdfJob.id}`)).arrayBuffer(),
      ),
    )
    const { stdout } = await run("pdftotext", ["-layout", pdf, "-"], { maxBuffer: 4 * 1024 * 1024 })
    await writeFile(join(evidence, "lesson.txt"), stdout)
    expect(stdout.replace(/\s/g, "")).toContain("出典付録")
    expect(stdout.replace(/\s/g, "")).not.toContain("Sourcesappendix")
    console.log(`TEN-19 publication-flow evidence: ${evidence}`)
  } finally {
    await context.close()
    await fixture.close()
  }
})
