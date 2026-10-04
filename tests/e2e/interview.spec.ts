import { mkdir } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { interviewFixture } from "@reading-studio/server/interview-fixture"

test.describe("interview", () => {
  let fixture: Awaited<ReturnType<typeof interviewFixture>>
  test.beforeEach(async ({ page }) => {
    fixture = await interviewFixture()
    await mkdir(".omo/evidence/reading-studio/task-16", { recursive: true })
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.goto(`${fixture.origin}/interviews/study-fixture`)
  })
  test.afterEach(async () => fixture.close())

  for (const width of [375, 768, 1280]) {
    test(`saves keyboard choices and custom context across reload, back and language at ${width}px`, async ({
      page,
    }) => {
      // Given
      await page.setViewportSize({ width, height: 900 })
      await page.getByLabel("Listen before interpreting").focus()
      // When
      await page.keyboard.press("ArrowDown")
      await page.keyboard.press("Tab")
      await expect(page.getByRole("button", { name: "Save choices" })).toBeFocused()
      await page.keyboard.press("Enter")
      // Then
      await expect(page.getByRole("status")).toContainText("Answer saved")
      await page.reload()
      await expect(page.getByLabel("Ask a more open question")).toBeChecked()
      await page.getByRole("link", { name: "Next", exact: true }).click()
      await page.getByLabel("At work", { exact: true }).focus()
      await page.keyboard.press("Space")
      await page.keyboard.press("Tab")
      await page.keyboard.press("Space")
      await page.getByRole("button", { name: "Save choices" }).click()
      await page.reload()
      await expect(page.getByLabel("At work", { exact: true })).toBeChecked()
      await expect(page.getByLabel("At home", { exact: true })).toBeChecked()
      await page
        .getByLabel("Your own response")
        .fill("A difficult conversation at work.\n相手の話を丁寧に聞きたい。")
      await page.getByRole("button", { name: "Save custom response" }).click()
      await page.reload()
      await expect(page.getByLabel("At work", { exact: true })).not.toBeChecked()
      await page.getByRole("link", { name: "日本語", exact: true }).click()
      await expect(page.locator("html")).toHaveAttribute("lang", "ja")
      await expect(page.getByLabel("自分の言葉で回答")).toHaveValue(
        "A difficult conversation at work.\n相手の話を丁寧に聞きたい。",
      )
      await page.getByRole("link", { name: "戻る", exact: true }).click()
      await expect(page.getByLabel("より開かれた問いを立てる")).toBeChecked()
      await page.getByLabel("より開かれた問いを立てる").focus()
      expect(
        await page
          .getByLabel("より開かれた問いを立てる")
          .evaluate((element) => getComputedStyle(element).outlineWidth),
      ).toBe("3px")
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-16/interview-${width}.png`,
        fullPage: true,
      })
      if (width === 1280)
        await page.screenshot({
          path: ".omo/evidence/reading-studio/task-16/interview.png",
          fullPage: true,
        })
      await page.getByRole("link", { name: "保存した回答を確認" }).click()
      await expect(
        page.getByText("A difficult conversation at work.", { exact: false }),
      ).toBeVisible()
      await expect(page.getByRole("status")).toContainText("必須")
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-16/review-${width}.png`,
        fullPage: true,
      })
      await page.getByRole("link", { name: "編集: どんな場面で役立てたいですか？" }).click()
      await expect(page.getByLabel("自分の言葉で回答")).toHaveValue(/difficult conversation/)
    })
  }

  test("handles empty, over-limit, mixed and obsolete submissions explicitly", async ({ page }) => {
    // Given
    const url = `${fixture.origin}/interviews/study-fixture?step=context`
    await page.goto(url)
    // When / Then
    await page.getByRole("button", { name: "Save choices" }).click()
    await expect(page.getByRole("alert")).toBeFocused()
    for (const name of ["At work", "At home", "In my community"])
      await page.getByLabel(name, { exact: true }).check()
    await page.getByRole("button", { name: "Save choices" }).click()
    await expect(page.getByRole("alert")).toBeVisible()
    for (const invalid of [
      { kind: "unsure", optionIds: "work" },
      { kind: "skipped", optionIds: "work" },
      { kind: "choice", optionIds: "obsolete" },
      { kind: "choice", optionIds: "work", questionRevisionId: "context-old" },
    ]) {
      const response = await page.request.post(url, {
        headers: { origin: fixture.origin },
        form: {
          interviewId: "interview-fixture",
          questionId: "context",
          questionRevisionId: "context-v1",
          ...invalid,
        },
      })
      expect([409, 422]).toContain(response.status())
    }
    expect(fixture.storage.interviews.answers("interview-fixture")).toHaveLength(0)
    await page.screenshot({
      path: ".omo/evidence/reading-studio/task-16/error.png",
      fullPage: true,
    })
  })

  test("replaces choices with unsure or skip and browses optional grouped lenses", async ({
    page,
  }) => {
    // Given
    await page.getByLabel("Listen before interpreting").check()
    await page.getByRole("button", { name: "Save choices" }).click()
    // When
    await page.getByRole("button", { name: "Not sure yet", exact: true }).click()
    // Then
    await page.reload()
    await expect(page.getByLabel("Listen before interpreting")).not.toBeChecked()
    expect(fixture.storage.interviews.answers("interview-fixture")[0]?.answer.kind).toBe("unsure")
    await page.getByRole("button", { name: "Skip this question", exact: true }).click()
    await page.reload()
    expect(fixture.storage.interviews.answers("interview-fixture")[0]?.answer.kind).toBe("skipped")
    await page.getByText("Attention and listening", { exact: true }).focus()
    await page.keyboard.press("Enter")
    await page.getByRole("link", { name: "Explore another perspective" }).click()
    await expect(page.getByLabel("Reflect on silence")).toBeVisible()
    await page.screenshot({
      path: ".omo/evidence/reading-studio/task-16/browse.png",
      fullPage: true,
    })
  })

  test("required approvals cannot skip and never authorize downstream work", async ({ page }) => {
    // Given
    const url = `${fixture.origin}/interviews/study-fixture?step=decision`
    await page.goto(url)
    // When / Then
    await expect(page.getByRole("button", { name: "Skip this question" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Not sure yet" })).toHaveCount(0)
    await page.getByRole("button", { name: "Save choices" }).click()
    await expect(page.getByRole("alert")).toBeVisible()
    for (const kind of ["skipped", "unsure"]) {
      const response = await page.request.post(url, {
        headers: { origin: fixture.origin },
        form: {
          interviewId: "interview-fixture",
          questionId: "decision",
          questionRevisionId: "decision-v1",
          kind,
        },
      })
      expect(response.status()).toBe(409)
    }
    await page.getByLabel("Defer this decision").check()
    await page.getByRole("button", { name: "Save choices" }).click()
    await page.reload()
    await expect(page.getByLabel("Defer this decision")).toBeChecked()
    expect(fixture.storage.counts()).toMatchObject({ approvals: 0, jobs: 0, grants: 0 })
    await page.screenshot({
      path: ".omo/evidence/reading-studio/task-16/required.png",
      fullPage: true,
    })
  })
})
