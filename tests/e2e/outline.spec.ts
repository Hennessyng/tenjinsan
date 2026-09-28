import { mkdir } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { briefFixture } from "./brief-fixture.ts"

test.describe("themed outline", () => {
  let fixture: Awaited<ReturnType<typeof briefFixture>>
  test.beforeEach(async ({ page }) => {
    fixture = await briefFixture()
    const draft = fixture.storage.briefs.save({
      studyId: "study-fixture",
      expectedRevisionId: null,
      content: {
        originalQuestion: { en: "How can I listen with care?", ja: "どうすれば丁寧に聴けますか？" },
        refinedQuestion: null,
        questionChoice: "original",
        supportingQuestions: [{ en: "What gets in the way?", ja: "何が妨げになりますか？" }],
        purpose: "Practice careful listening",
        context: "A conversation at work",
        depth: "focused",
        language: "paired",
        spoilerPolicy: "avoid",
        exclusions: ["Diagnosis"],
      },
    })
    fixture.storage.briefs.decide({
      studyId: draft.studyId,
      revisionId: draft.id,
      action: "approve",
    })
    await mkdir(".omo/evidence/reading-studio/task-18", { recursive: true })
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.goto(`${fixture.origin}/briefs/study-fixture`)
    await page.getByRole("link", { name: "Study outline" }).click()
  })
  test.afterEach(async () => fixture.close())

  for (const width of [375, 768, 1280]) {
    test(`approves a visual sequence and invalidates it on selected revision at ${width}px`, async ({
      page,
    }) => {
      // Given
      await page.setViewportSize({ width, height: 900 })
      await page.getByRole("button", { name: "Generate fixture outline" }).click()
      await expect(page.getByRole("button", { name: "Generate sections" })).toBeDisabled()
      await expect(page.getByRole("status")).toHaveText("Awaiting outline approval")
      await expect(page.getByText("Diagnosis", { exact: true })).toBeVisible()
      await expect(page.getByText("chapter-two.xhtml: second", { exact: true })).toBeVisible()
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-18/pending-${width}.png`,
        fullPage: true,
      })
      // When
      await page.getByRole("button", { name: "Approve outline" }).focus()
      await page.keyboard.press("Enter")
      // Then
      await expect(page.getByRole("status")).toHaveText("Outline approved")
      await page.reload()
      await expect(page.getByRole("status")).toHaveText("Outline approved")
      const first = fixture.storage.outlines.current("study-fixture")
      if (!first) throw new TypeError("Missing outline")
      expect(fixture.storage.outlines.approved(first.draft.id)?.id).toBe(first.draft.id)
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-18/approved-${width}.png`,
        fullPage: true,
      })
      if (width === 1280)
        await page.screenshot({
          path: ".omo/evidence/reading-studio/task-18/outline.png",
          fullPage: true,
        })
      await page.getByLabel("Revision choice").selectOption("reverse-order")
      await page.getByRole("button", { name: "Apply selected revision" }).click()
      await expect(page.getByRole("status")).toHaveText("Awaiting outline approval")
      await expect(page.locator("article h3").first()).toHaveText("What gets in the way?")
      expect(fixture.storage.outlines.approved(first.draft.id)).toBeNull()
      expect(fixture.storage.counts()).toMatchObject({ lessons: 0, jobs: 0 })
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-18/revised-${width}.png`,
        fullPage: true,
      })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    })
  }

  test("rejects stale approval and keeps custom input literal", async ({ page }) => {
    // Given
    await page.getByRole("button", { name: "Generate fixture outline" }).click()
    const first = fixture.storage.outlines.current("study-fixture")
    if (!first) throw new TypeError("Missing outline")
    await page.getByLabel("Your own visual intention").fill('<img src=x onerror="alert(1)">')
    await page.getByRole("button", { name: "Apply custom revision" }).click()
    // When
    const stale = await page.request.post(`${fixture.origin}/outlines/study-fixture`, {
      headers: { origin: fixture.origin },
      form: { action: "approve", revisionId: first.draft.id },
    })
    // Then
    expect(stale.status()).toBe(409)
    await expect(page.locator("img, script")).toHaveCount(0)
    expect(fixture.storage.outlines.current("study-fixture")?.draft.feedback).toEqual({
      kind: "custom",
      text: '<img src=x onerror="alert(1)">',
    })
    await page.getByRole("button", { name: "Defer" }).click()
    await expect(page.getByRole("status")).toHaveText("Decision deferred")
    await page.getByRole("button", { name: "Request revision" }).click()
    await expect(page.getByRole("button", { name: "Approve outline" })).toBeDisabled()
  })

  test("blocks generation after brief changes and rejects foreign access", async ({
    page,
    browser,
  }) => {
    // Given
    const brief = fixture.storage.briefs.current("study-fixture")
    if (!brief) throw new TypeError("Missing brief")
    fixture.storage.briefs.decide({
      studyId: "study-fixture",
      revisionId: brief.draft.id,
      action: "revise",
    })
    // When
    await page.getByRole("button", { name: "Generate fixture outline" }).click()
    // Then
    await expect(page.getByRole("alert")).toBeFocused()
    expect(fixture.storage.outlines.current("study-fixture")).toBeNull()
    const foreign = await page.request.post(`${fixture.origin}/outlines/study-fixture`, {
      headers: { origin: "https://foreign.invalid" },
      form: { action: "approve", revisionId: "forged" },
    })
    expect(foreign.status()).toBe(403)
    expect((await page.request.get(`${fixture.origin}/outlines/other-study`)).status()).toBe(404)
    const anonymous = await browser.newContext()
    expect((await anonymous.request.get(`${fixture.origin}/outlines/study-fixture`)).status()).toBe(
      401,
    )
    await anonymous.close()
  })

  test("shows irrelevant and unsupported visual flags and rejects approval", async ({ page }) => {
    // Given
    await page.getByRole("button", { name: "Generate fixture outline" }).click()
    const first = fixture.storage.outlines.current("study-fixture")
    if (!first) throw new TypeError("Missing outline")
    fixture.storage.outlines.save({
      studyId: "study-fixture",
      briefRevisionId: first.draft.briefRevisionId,
      expectedRevisionId: first.draft.id,
      feedback: null,
      content: {
        ...first.draft.content,
        sections: first.draft.content.sections.map((section) => ({
          ...section,
          questionIndex: 99,
          visualKind: "source-grounded",
          visualEvidence: [],
        })),
      },
    })
    // When
    await page.reload()
    // Then
    await expect(page.getByRole("alert").filter({ hasText: "irrelevant-section" })).toHaveCount(2)
    await expect(page.getByRole("alert").filter({ hasText: "unsupported-visual" })).toHaveCount(2)
    await expect(page.getByRole("button", { name: "Approve outline" })).toBeDisabled()
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-18/flagged-${width}.png`,
        fullPage: true,
      })
    }
  })
})
