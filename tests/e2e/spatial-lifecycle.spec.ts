import { expect, test } from "@playwright/test"
import { readerFixture } from "@reading-studio/reader/testing"

let fixture: Awaited<ReturnType<typeof readerFixture>>
test.beforeAll(async () => {
  fixture = await readerFixture()
})
test.afterAll(async () => fixture.close())

test("releases a lost context and keeps complete static views", async ({ page }) => {
  // Given
  await page.goto(`${fixture.origin}/spatial`)
  const figure = page.locator("[data-three-scene]").first()
  await figure.locator("[data-view]").first().click()
  await expect(figure).toHaveAttribute("data-renderer", "ready")
  // When
  await figure.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
    canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext()
  })
  // Then
  await expect(figure).toHaveAttribute("data-renderer", "disposed")
  await expect(figure.locator(".spatial-live")).toBeHidden()
  await expect(figure.locator("[data-static-view]")).toHaveCount(4)
  for (const view of await figure.locator("[data-static-view]").all())
    await expect(view).toBeVisible()
})

test("pagehide releases contexts and persisted pageshow remounts once", async ({ page }) => {
  // Given
  await page.goto(`${fixture.origin}/spatial`)
  const figure = page.locator("[data-three-scene]").first()
  await figure.locator("[data-view]").first().click()
  await expect(figure).toHaveAttribute("data-renderer", "ready")
  // When
  const lost = await figure.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("webgl2")
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }))
    return context?.isContextLost()
  })
  // Then
  expect(lost).toBe(true)
  await expect(figure).toHaveAttribute("data-renderer", "disposed")
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
  )
  await figure.locator("[data-view]").last().click()
  await expect(figure.locator("[data-view]").last()).toHaveAttribute("aria-pressed", "true")
  await expect(figure).toHaveAttribute("data-renderer", "ready")
})

test("does not ship the Three.js bundle on ordinary SVG lessons", async ({ page }) => {
  // Given / When
  await page.goto(`${fixture.origin}/scenes`)
  // Then
  await expect(page.locator("[data-three-runtime]")).toHaveCount(0)
  await expect(page.locator("canvas")).toHaveCount(0)
})

test("reduced motion can change during use without starting an animation", async ({ page }) => {
  // Given
  await page.goto(`${fixture.origin}/spatial`)
  const figure = page.locator("[data-three-scene]").first()
  await figure.locator("[data-view]").first().click()
  // When
  await page.emulateMedia({ reducedMotion: "reduce" })
  await figure.locator("[data-view]").last().click()
  // Then
  await expect(figure).toHaveAttribute("data-current-view", "perspective:viewpoint:oblique")
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0)
  const renders = await figure.getAttribute("data-render-count")
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
  await expect(figure).toHaveAttribute("data-render-count", renders ?? "")
})
