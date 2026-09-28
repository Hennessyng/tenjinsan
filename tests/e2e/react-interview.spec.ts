import { expect, test } from "@playwright/test"
import { interviewFixture } from "@reading-studio/server/interview-fixture"

test.describe("React interview", () => {
  let fixture: Awaited<ReturnType<typeof interviewFixture>>
  test.beforeEach(async ({ page }) => {
    fixture = await interviewFixture()
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.route(/\/api\/interviews(?:\/.*)?$/, async (route) => {
      const url = new URL(route.request().url())
      await route.fulfill({
        response: await route.fetch({
          url: `${fixture.origin}${url.pathname}${url.search}`,
          headers: { ...route.request().headers(), origin: fixture.origin },
        }),
      })
    })
  })
  test.afterEach(async () => {
    await fixture.close()
  })

  for (const width of [375, 768, 1280]) {
    test(`saves and replaces answers at ${width}px`, async ({ page }, testInfo) => {
      // Given: an authenticated reader with an owned question bank.
      await page.setViewportSize({ width, height: 900 })
      await page.goto("http://127.0.0.1:4173/interviews/study-fixture")
      await expect(page.getByRole("heading", { name: "Shape your reading" })).toBeVisible()
      // When: a single choice is saved, then a multi-choice is replaced by custom text.
      await page.getByLabel("Ask a more open question").check()
      await page.getByRole("button", { name: "Save choices" }).click()
      await expect(page.getByRole("status")).toContainText("Answer saved")
      await page.reload()
      await expect(page.getByLabel("Ask a more open question")).toBeChecked()
      await page.getByRole("link", { name: "Next", exact: true }).click()
      await page.getByLabel("At work", { exact: true }).check()
      await page.getByLabel("At home", { exact: true }).check()
      await page.getByRole("button", { name: "Save choices" }).click()
      await expect(page.getByRole("status")).toContainText("Answer saved")
      await page.getByLabel("Your own response").fill("Listen first.\n相手の話を聞く。")
      await page.getByRole("button", { name: "Save custom response" }).click()
      await expect
        .poll(
          () =>
            fixture.storage.interviews
              .answers("interview-fixture")
              .find((saved) => saved.question.id === "context")?.answer.kind,
        )
        .toBe("custom")
      await page.reload()
      // Then: replacement is persisted and language navigation retains the step.
      await expect(page.getByLabel("At work", { exact: true })).not.toBeChecked()
      await page.getByRole("link", { name: "日本語", exact: true }).click()
      await expect(page.locator("html")).toHaveAttribute("lang", "ja")
      await expect(page.getByLabel("自分の言葉で回答")).toHaveValue(
        "Listen first.\n相手の話を聞く。",
      )
      await page.getByRole("link", { name: "戻る", exact: true }).click()
      await expect(page.getByLabel("より開かれた問いを立てる")).toBeChecked()
      await page.screenshot({
        path: testInfo.outputPath(`react-interview-${width}.png`),
        fullPage: true,
      })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    })
  }

  test("requires explicit approval choices and does not grant downstream work", async ({
    page,
  }) => {
    await page.goto("http://127.0.0.1:4173/interviews/study-fixture?step=decision")
    await expect(page.getByRole("button", { name: "Skip this question" })).toHaveCount(0)
    await page.getByRole("button", { name: "Save choices" }).click()
    await expect(page.getByRole("alert")).toBeVisible()
    await page.getByLabel("Defer this decision").check()
    await page.getByRole("button", { name: "Save choices" }).click()
    await page.reload()
    await expect(page.getByLabel("Defer this decision")).toBeChecked()
    expect(fixture.storage.counts()).toMatchObject({ approvals: 0, grants: 0, jobs: 0 })
  })

  test("replaces a choice with unsure then skip and browses optional lenses", async ({ page }) => {
    await page.goto("http://127.0.0.1:4173/interviews/study-fixture")
    await page.getByLabel("Listen before interpreting").check()
    await page.getByRole("button", { name: "Save choices" }).click()
    await expect(page.getByRole("status")).toContainText("Answer saved")
    await page.getByRole("button", { name: "Not sure yet" }).click()
    await expect
      .poll(() => fixture.storage.interviews.answers("interview-fixture")[0]?.answer.kind)
      .toBe("unsure")
    await page.reload()
    await page.getByRole("button", { name: "Skip this question" }).click()
    await expect
      .poll(() => fixture.storage.interviews.answers("interview-fixture")[0]?.answer.kind)
      .toBe("skipped")
    await page.reload()
    await page.getByText("Attention and listening", { exact: true }).click()
    await page.getByRole("link", { name: "Explore another perspective" }).click()
    await expect(page.getByLabel("Reflect on silence")).toBeVisible()
  })
})
