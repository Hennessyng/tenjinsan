import { execFileSync } from "node:child_process"
import { DatabaseSync } from "node:sqlite"
import { chromium, expect as visible } from "@playwright/test"
import { expect, it } from "vitest"
import { sourceViewerFixture } from "../../apps/server/src/testing/source-viewer-fixture.ts"

it("TEN-16 S5 F4 announces actual owner expiry without retaining source content", async () => {
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
    await page.goto(`${fixture.origin}/sources/revision-fixture`)
    await visible(page.getByText("Attention begins with a question.")).toBeVisible()
    expect((await page.request.get(`${fixture.origin}/api/library-context`)).status()).toBe(200)
    const database = new DatabaseSync(fixture.databasePath)
    try {
      const expired = database
        .prepare("UPDATE auth_sessions SET expires_at = 0 WHERE expires_at > ?")
        .run(Date.now())
      expect(Number(expired.changes)).toBeGreaterThan(0)
    } finally {
      database.close()
    }
    const refusal = page.waitForResponse((response) =>
      response.url().endsWith("/api/library-context"),
    )
    await page
      .getByRole("navigation", { name: "Reading route / 読書ルート" })
      .getByRole("button", { name: /1\. Import & read/ })
      .click()
    expect((await refusal).status()).toBe(401)
    await visible(page.getByRole("heading", { name: /Authentication required/ })).toBeVisible()

    expect(await page.getByRole("alert").count()).toBe(1)
    await visible(page.getByRole("alert")).toBeVisible()
    await visible(page.getByRole("link", { name: "Sign in / ログイン" })).toHaveAttribute(
      "href",
      "/login",
    )
    await visible(page.getByText("Attention begins with a question.")).toHaveCount(0)
  } finally {
    await browser.close()
    await fixture.close()
  }
}, 120_000)
