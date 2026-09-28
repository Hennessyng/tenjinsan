import { mkdir, writeFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import {
  publicationTeachingStateIds,
  readerFixture,
  sceneLesson,
} from "@reading-studio/reader/testing"

let fixture: Awaited<ReturnType<typeof readerFixture>>
test.beforeAll(async () => {
  fixture = await readerFixture()
})
test.afterAll(async () => fixture.close())

test("keeps every explanation available without JavaScript", async ({ browser }) => {
  // Given
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  // When
  await page.goto(`${fixture.origin}/scenes`)
  // Then
  await expect(page.locator("figure svg")).toHaveCount(5)
  await expect(page.locator("[data-scene-controls]:visible")).toHaveCount(0)
  expect(
    await page
      .locator("[data-state]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-state"))),
  ).toEqual([...publicationTeachingStateIds(sceneLesson)])
  for (const state of await page.locator("[data-state]").all()) await expect(state).toBeVisible()
  await context.close()
})

test("restores all shapes and both languages when printed from a selected state", async ({
  page,
}) => {
  // Given
  await page.goto(`${fixture.origin}/scenes`)
  await page.locator('input[value="en"]').check()
  await page.locator("[data-seek]").first().fill("1200")
  // When
  await page.emulateMedia({ media: "print" })
  // Then
  await expect(page.locator("[data-scene-controls]:visible")).toHaveCount(0)
  for (const state of await page.locator('[data-state] [lang="ja"]').all())
    await expect(state).toBeVisible()
  expect(
    await page
      .locator("[data-scene-mark]")
      .evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).opacity === "1")),
  ).toBe(true)
  expect(
    await page
      .locator("[data-print-states]")
      .evaluateAll((nodes) =>
        nodes.flatMap((node) => JSON.parse(node.getAttribute("data-print-states") ?? "[]")),
      ),
  ).toEqual([...publicationTeachingStateIds(sceneLesson)])
})

test("finishes at the final state and releases animations when a scene is removed", async ({
  page,
}) => {
  // Given
  await page.goto(`${fixture.origin}/scenes`)
  const figure = page.locator("[data-svg-scene]").first()
  await figure.locator("[data-seek]").fill("3500")
  // When
  await figure.locator("[data-play]").click()
  // Then
  await expect(figure.locator("[data-seek]")).toHaveValue("3600")
  await expect(figure).toHaveAttribute("data-current-state", "layers:layer:revise")
  await expect(figure).toHaveAttribute("data-playback", "paused")
  const released = await figure.evaluate(async (node) => {
    const animations = node.getAnimations({ subtree: true })
    node.remove()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    return animations.every((animation) => animation.playState === "idle")
  })
  expect(released).toBe(true)
})

test("keeps every scene readable at 200 percent layout zoom", async ({ page }) => {
  // Given
  const evidence = ".omo/evidence/reading-studio/task-22"
  await mkdir(evidence, { recursive: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`${fixture.origin}/scenes`)
  // When
  await page.locator("html").evaluate((node) => {
    node.style.zoom = "2"
  })
  // Then
  const measurements = []
  for (const [index, figure] of (await page.locator("[data-svg-scene]").all()).entries()) {
    await figure.locator("[data-select-state]").last().click()
    const bounds = await figure.evaluate((node) => ({
      zoom: getComputedStyle(document.documentElement).zoom,
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
      textOverflow: Array.from(node.querySelectorAll<HTMLElement>("button,li,p,label")).some(
        (element) => element.scrollWidth > element.clientWidth + 1,
      ),
    }))
    expect(bounds).toEqual({ zoom: "2", pageOverflow: false, textOverflow: false })
    measurements.push({ index, ...bounds })
    await figure.screenshot({ path: `${evidence}/zoom-200-scene-${index}.png` })
  }
  await writeFile(`${evidence}/zoom-200.json`, JSON.stringify(measurements, null, 2))
})
