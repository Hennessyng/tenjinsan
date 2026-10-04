import { mkdir } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { briefFixture } from "./brief-fixture.ts"

test.describe("brief approval", () => {
  let fixture: Awaited<ReturnType<typeof briefFixture>>
  test.beforeEach(async ({ page }, testInfo) => {
    fixture = await briefFixture()
    await mkdir(".omo/evidence/reading-studio/task-17", { recursive: true })
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.goto(`${fixture.origin}/interviews/study-fixture?step=~review`)
    await page.getByRole("link", { name: "Edit: Where could this matter to you?" }).click()
    await page.getByLabel("Your own response").fill("A conversation at work")
    await page.getByRole("button", { name: "Save custom response" }).click()
    await page.getByRole("link", { name: "Reading brief / 読書方針を確認" }).click()
    const width = /at (375|768|1280)px/.exec(testInfo.title)?.[1]
    if (width) {
      await page.setViewportSize({ width: Number(width), height: 900 })
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-17/initial-${width}.png`,
        fullPage: true,
      })
    }
    await page.getByLabel("Original question (English)").fill("How can I listen with care?")
    await page
      .getByLabel("最初の問い（日本語）", { exact: true })
      .fill("どうすれば丁寧に聴けますか？")
    await page.getByLabel("Refined question (English)").fill("How can I ask before interpreting?")
    await page
      .getByLabel("練り直した問い（日本語）", { exact: true })
      .fill("解釈する前にどう尋ねますか？")
    await page.getByLabel("Supporting question 1 (English)").fill("What gets in the way?")
    await page.getByLabel("補助の問い 1（日本語）").fill("何が妨げになりますか？")
    await page.getByLabel("Purpose / 読書の目的").fill("Practice careful listening")
    await page
      .getByLabel("Personal context / 個人的な背景")
      .fill("A difficult conversation at work. 職場での対話。")
    await page.getByLabel("Topic exclusions").fill("Diagnosis\nAdvice without consent")
    await page.getByRole("button", { name: "Review brief / 内容を確認" }).click()
  })
  test.afterEach(async () => fixture.close())

  for (const width of [375, 768, 1280]) {
    test(`reviews, defers, approves and revises a precise brief at ${width}px`, async ({
      page,
    }) => {
      // Given
      await page.setViewportSize({ width, height: 900 })
      await expect(page.getByRole("status")).toContainText("Awaiting approval")
      await expect(page.getByRole("heading", { name: "Original vs refined" })).toBeVisible()
      await expect(page.getByText("chapter-two.xhtml", { exact: false })).toBeVisible()
      await expect(
        page.getByText("A difficult conversation at work.", { exact: false }),
      ).toBeVisible()
      await expect(page.locator("dd").filter({ hasText: "Avoid spoilers" })).toBeVisible()
      expect(fixture.storage.counts()).toMatchObject({ approvals: 0, jobs: 0 })
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-17/brief-${width}.png`,
        fullPage: true,
      })
      // When
      await page.getByRole("button", { name: "Defer / 保留する" }).click()
      // Then
      await page.reload()
      await expect(page.getByRole("status")).toContainText("Decision deferred")
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-17/deferred-${width}.png`,
        fullPage: true,
      })
      expect(fixture.storage.counts()).toMatchObject({ approvals: 0, jobs: 0 })
      await page.getByRole("button", { name: "Approve brief" }).focus()
      expect(
        await page
          .getByRole("button", { name: "Approve brief" })
          .evaluate((node) => getComputedStyle(node).outlineWidth),
      ).toBe("3px")
      await page.keyboard.press("Enter")
      await expect(page.getByRole("status")).toContainText("Brief approved")
      await page.reload()
      await expect(page.getByRole("status")).toContainText("Brief approved")
      const first = fixture.storage.briefs.current("study-fixture")
      if (!first) throw new TypeError("Missing approved brief")
      expect(first.draft.answers[0]?.answer).toMatchObject({
        kind: "custom",
        text: "A conversation at work",
      })
      expect(fixture.storage.briefs.approved(first.draft.id)?.guidingQuestion.en).toBe(
        "How can I listen with care?",
      )
      expect(fixture.storage.counts()).toMatchObject({ approvals: 1, jobs: 0 })
      const source = fixture.definition.steps[0]?.question.lens?.sources[0]
      if (!source) throw new TypeError("Missing fixture source")
      fixture.storage.workflow.appendOutline({
        parentRevisionId: null,
        record: {
          id: "outline-browser",
          studyId: first.draft.studyId,
          setupRevisionId: first.draft.setupRevisionId,
          analysisRevisionId: first.draft.analysisRevisionId,
          briefRevisionId: first.draft.id,
          sections: [
            {
              id: "listen",
              title: { en: "Listening", ja: "傾聴" },
              learningGoals: [{ en: "Notice assumptions", ja: "思い込みに気づく" }],
              theme: { en: "Attention", ja: "注意" },
              visualIntents: [],
              sources: [source],
            },
          ],
          approval: { revisionId: "outline-browser", approvedAt: "2026-09-23T01:00:00Z" },
        },
      })
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-17/approved-${width}.png`,
        fullPage: true,
      })
      if (width === 1280)
        await page.screenshot({
          path: ".omo/evidence/reading-studio/task-17/brief.png",
          fullPage: true,
        })
      await page.getByRole("button", { name: "Revise / 修正する" }).click()
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-17/editor-${width}.png`,
        fullPage: true,
      })
      await page.getByLabel("Guiding question / 主となる問い").selectOption("refined")
      await page.getByRole("button", { name: "Review brief / 内容を確認" }).click()
      await expect(page.getByRole("status")).toContainText("Awaiting approval")
      await expect(page.getByText("outline: outline-browser — outdated")).toBeVisible()
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-17/revised-${width}.png`,
        fullPage: true,
      })
      expect(fixture.storage.briefs.approved(first.draft.id)).toBeNull()
      const stale = await page.request.post(`${fixture.origin}/briefs/study-fixture`, {
        headers: { origin: fixture.origin },
        form: { action: "approve", revisionId: first.draft.id },
      })
      expect(stale.status()).toBe(409)
      await page.getByRole("button", { name: "Approve brief" }).click()
      const second = fixture.storage.briefs.current("study-fixture")
      if (!second) throw new TypeError("Missing revised brief")
      expect(fixture.storage.briefs.approved(second.draft.id)?.guidingQuestion.en).toBe(
        "How can I ask before interpreting?",
      )
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    })
  }

  test("rejects stale visible forms, foreign studies and forged approval fields", async ({
    page,
    browser,
  }) => {
    // Given
    const first = fixture.storage.briefs.current("study-fixture")
    if (!first) throw new TypeError("Missing draft")
    fixture.storage.briefs.save({
      studyId: "study-fixture",
      expectedRevisionId: first.draft.id,
      content: { ...first.draft.content, depth: "deep" },
    })
    // When
    await page.getByRole("button", { name: "Approve brief" }).click()
    // Then
    await expect(page.getByRole("alert")).toBeFocused()
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-17/stale-${width}.png`,
        fullPage: true,
      })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    }
    await page.screenshot({
      path: ".omo/evidence/reading-studio/task-17/stale.png",
      fullPage: true,
    })
    expect(fixture.storage.counts()).toMatchObject({ approvals: 0, jobs: 0 })
    const forged = await page.request.post(`${fixture.origin}/briefs/study-fixture`, {
      headers: { origin: fixture.origin },
      form: { action: "approve", revisionId: first.draft.id, context: "forged" },
    })
    expect(forged.status()).toBe(422)
    const missing = await page.request.get(`${fixture.origin}/briefs/other-study`)
    expect(missing.status()).toBe(404)
    const foreign = await page.request.post(`${fixture.origin}/briefs/study-fixture`, {
      headers: { origin: "https://foreign.invalid" },
      form: { action: "approve", revisionId: first.draft.id },
    })
    expect(foreign.status()).toBe(403)
    const anonymous = await browser.newContext()
    expect((await anonymous.request.get(`${fixture.origin}/briefs/study-fixture`)).status()).toBe(
      401,
    )
    await anonymous.close()
  })

  test("requires complete alternatives and escapes private text when revising", async ({
    page,
  }) => {
    // Given
    await page.getByRole("button", { name: "Revise / 修正する" }).click()
    await page.getByRole("textbox", { name: "練り直した問い（日本語）", exact: true }).fill("")
    // When
    await page.getByRole("button", { name: "Review brief / 内容を確認" }).click()
    // Then
    await expect(page.getByRole("alert")).toBeFocused()
    expect(fixture.storage.counts()).toMatchObject({ approvals: 0, jobs: 0 })
    await page
      .getByLabel("Personal context / 個人的な背景")
      .fill('<img src="https://attacker.invalid" onerror="alert(1)">')
    await page.getByRole("button", { name: "Review brief / 内容を確認" }).click()
    await expect(
      page.getByText('<img src="https://attacker.invalid" onerror="alert(1)">', { exact: true }),
    ).toBeVisible()
    await expect(page.locator("img, script")).toHaveCount(0)
  })

  test("marks the brief outdated when a saved interview answer changes", async ({ page }) => {
    // Given
    await page.getByRole("button", { name: "Approve brief" }).click()
    await page.getByRole("link", { name: "Review saved answers" }).click()
    await page.getByRole("link", { name: "Edit: Where could this matter to you?" }).click()
    await page.getByLabel("Your own response").fill("Different personal context")
    // When
    await page.getByRole("button", { name: "Save custom response" }).click()
    await page.getByRole("link", { name: "Reading brief / 読書方針を確認" }).click()
    // Then
    await expect(page.getByRole("status")).toContainText("Outdated")
    await expect(page.getByRole("button", { name: "Approve brief" })).toHaveCount(0)
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-17/outdated-${width}.png`,
        fullPage: true,
      })
    }
  })
})
