import { mkdir, writeFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import {
  layerInventory,
  perspectiveLegendInventory,
  readerFixture,
  spatialInventory,
} from "@reading-studio/reader/testing"

const evidence = ".omo/evidence/reading-studio/task-23"
let fixture: Awaited<ReturnType<typeof readerFixture>>
test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true })
  fixture = await readerFixture()
})
test.afterAll(async () => fixture.close())

for (const width of [375, 768, 1280]) {
  test(`renders every independent viewpoint and layer by keyboard at ${width}`, async ({
    page,
  }) => {
    // Given
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []
    const requests: string[] = []
    page.on("pageerror", (error) => {
      errors.push(error.message)
    })
    page.on("request", (request) => {
      requests.push(request.url())
    })
    await page.goto(`${fixture.origin}/spatial`)
    expect(
      await page
        .locator('[data-tone="1"] polygon')
        .first()
        .evaluate((node) => getComputedStyle(node).fill),
    ).toBe("rgb(216, 136, 105)")
    const measurements = []
    // When
    for (const [index, figure] of (await page.locator("[data-three-scene]").all()).entries()) {
      const scene = index === 0 ? "perspective" : "spatial"
      let previous: Buffer | undefined
      for (const view of spatialInventory) {
        const button = figure.locator(`[data-view="${scene}:viewpoint:${view.id}"]`)
        await button.focus()
        await page.keyboard.press("Enter")
        // Then
        await expect(figure).toHaveAttribute("data-renderer", "ready")
        await expect(button).toHaveAttribute("aria-pressed", "true")
        await expect(figure.locator("[data-spatial-status]")).toContainText(view.label.en)
        await expect(figure.locator("[data-spatial-status]")).toContainText(view.label.ja)
        const image = await figure.locator("canvas").screenshot()
        if (previous) expect(image.equals(previous)).toBe(false)
        previous = image
        const geometry = await figure.locator(".spatial-live").evaluate((node) => {
          const markers = Array.from(node.querySelectorAll<HTMLElement>("[data-marker]")).map(
            (marker) => marker.getBoundingClientRect(),
          )
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            overlappingMarkers: markers.some((left, i) =>
              markers.some(
                (right, j) =>
                  i !== j &&
                  left.left < right.right &&
                  left.right > right.left &&
                  left.top < right.bottom &&
                  left.bottom > right.top,
              ),
            ),
          }
        })
        expect(geometry.overflow).toBe(false)
        expect(geometry.overlappingMarkers).toBe(false)
        measurements.push({ scene, view: view.id, ...geometry })
        await figure.screenshot({ path: `${evidence}/${scene}-${view.id}-${width}.png` })
      }
      if (scene === "spatial")
        for (const layer of layerInventory) {
          const button = figure.locator(`[data-layer="spatial:layer:${layer.id}"]`)
          await button.focus()
          await page.keyboard.press("Space")
          await expect(button).toHaveAttribute("aria-pressed", "true")
          await expect(figure.locator("[data-spatial-status]")).toContainText(layer.label.en)
          await expect(figure.locator("[data-spatial-status]")).toContainText(layer.label.ja)
          await figure.screenshot({ path: `${evidence}/layer-${layer.id}-${width}.png` })
        }
    }
    expect(errors).toEqual([])
    expect(requests.every((url) => url.startsWith(fixture.origin))).toBe(true)
    await writeFile(`${evidence}/geometry-${width}.json`, JSON.stringify(measurements, null, 2))
  })
}

for (const mode of ["reduce", "webgl-disabled", "javascript-disabled"] as const) {
  test(`retains independent labels and static viewpoints in ${mode}`, async ({ browser }) => {
    // Given
    const context = await browser.newContext({
      javaScriptEnabled: mode !== "javascript-disabled",
      reducedMotion: mode === "reduce" ? "reduce" : "no-preference",
    })
    if (mode === "webgl-disabled")
      await context.addInitScript(() => {
        HTMLCanvasElement.prototype.getContext = () => null
      })
    const page = await context.newPage()
    await page.goto(`${fixture.origin}/spatial`)
    // When
    const perspectiveLegend = page.locator(
      '[data-three-scene="perspective-3d"] > figcaption .scene-legend',
    )
    await expect(perspectiveLegend.locator("[data-object-label]")).toHaveCount(
      perspectiveLegendInventory.length,
    )
    for (const item of perspectiveLegendInventory) {
      for (const language of ["en", "ja"] as const) {
        const label = perspectiveLegend.locator(
          `[data-object-label="${item.index}"] [lang="${language}"]`,
        )
        await expect(label).toBeVisible()
        await expect(label).toHaveText(item.label[language])
      }
    }
    for (const scene of ["perspective", "spatial"]) {
      for (const view of spatialInventory) {
        const alternative = page.locator(`[data-static-view="${scene}:viewpoint:${view.id}"]`)
        // Then
        await expect(alternative).toBeVisible()
        await expect(alternative.locator("polygon").first()).toBeVisible()
        for (const language of ["en", "ja"] as const) {
          const label = alternative.locator(`figcaption h4 [lang="${language}"]`)
          const explanation = alternative.locator(`figcaption > .pair > [lang="${language}"]`)
          await expect(label).toBeVisible()
          await expect(label).toHaveText(view.label[language])
          await expect(explanation).toBeVisible()
          await expect(explanation).toHaveText(view.explanation[language])
        }
        if (mode !== "javascript-disabled") {
          const button = page.locator(`[data-view="${scene}:viewpoint:${view.id}"]`)
          await button.focus()
          await page.keyboard.press("Space")
          await expect(button).toHaveAttribute("aria-pressed", "true")
        }
      }
    }
    for (const [index, layer] of layerInventory.entries()) {
      for (const language of ["en", "ja"] as const) {
        const label = page.locator(
          `[data-three-scene="spatial-layers-3d"] > figcaption [data-object-label="${index}"] [lang="${language}"]`,
        )
        await expect(label).toBeVisible()
        await expect(label).toHaveText(layer.label[language])
      }
      await expect(page.locator(`[data-state="spatial:layer:${layer.id}"]`)).toContainText(
        layer.label.ja,
      )
    }
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0)
    await page.screenshot({ path: `${evidence}/${mode}.png`, fullPage: true })
    await context.close()
  })
}

test("prints all deliberate viewpoints regardless of selected camera", async ({ page }) => {
  // Given
  await page.goto(`${fixture.origin}/spatial`)
  await page.locator('[data-view="spatial:viewpoint:oblique"]').click()
  // When
  await page.emulateMedia({ media: "print" })
  // Then
  for (const scene of ["perspective", "spatial"])
    for (const view of spatialInventory) {
      await expect(page.locator(`[data-static-view="${scene}:viewpoint:${view.id}"]`)).toBeVisible()
    }
  for (const canvas of await page.locator("canvas").all()) await expect(canvas).toBeHidden()
  for (const control of await page.locator("[data-spatial-controls]").all())
    await expect(control).toBeHidden()
  await page.screenshot({ path: `${evidence}/print.png`, fullPage: true })
})

test("suspends off-screen, hidden and printing renders and disposes real GPU resources", async ({
  page,
}) => {
  // Given
  await page.addInitScript(() => {
    for (const method of ["deleteBuffer", "deleteProgram", "deleteTexture"] as const) {
      const original = WebGL2RenderingContext.prototype[method]
      Object.defineProperty(WebGL2RenderingContext.prototype, method, {
        value: function (this: WebGL2RenderingContext, value: never) {
          document.documentElement.dataset[method] = String(
            Number(document.documentElement.dataset[method] ?? 0) + 1,
          )
          return original.call(this, value)
        },
      })
    }
  })
  await page.goto(`${fixture.origin}/spatial`)
  const figure = page.locator("[data-three-scene]").first()
  await figure.locator("[data-view]").first().click()
  await expect(figure).toHaveAttribute("data-renderer", "ready")
  // When
  await page.locator("footer").scrollIntoViewIfNeeded()
  // Then
  await expect(figure).toHaveAttribute("data-renderer", "suspended")
  const frames = await figure.getAttribute("data-render-count")
  await figure
    .locator("[data-view]")
    .last()
    .evaluate((button: HTMLButtonElement) => button.click())
  await expect(figure).toHaveAttribute("data-render-count", frames ?? "")
  await figure.locator("[data-view]").first().click()
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await expect(figure).toHaveAttribute("data-renderer", "suspended")
  const hiddenFrames = await figure.getAttribute("data-render-count")
  await figure.locator("[data-view]").last().click()
  await expect(figure).toHaveAttribute("data-render-count", hiddenFrames ?? "")
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await page.emulateMedia({ media: "print" })
  await expect(figure).toHaveAttribute("data-renderer", "suspended")
  await page.emulateMedia({ media: "screen" })
  const cleanup = await figure.evaluate(async (node) => {
    const canvas = node.querySelector("canvas")
    const gl = canvas?.getContext("webgl2")
    node.remove()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    return {
      state: node.getAttribute("data-renderer"),
      lost: gl?.isContextLost(),
      buffers: Number(document.documentElement.dataset["deleteBuffer"]),
      programs: Number(document.documentElement.dataset["deleteProgram"]),
      textures: Number(document.documentElement.dataset["deleteTexture"] ?? 0),
    }
  })
  expect(cleanup.state).toBe("disposed")
  expect(cleanup.lost).toBe(true)
  expect(cleanup.buffers).toBeGreaterThan(0)
  expect(cleanup.programs).toBeGreaterThan(0)
  await writeFile(`${evidence}/cleanup.json`, JSON.stringify(cleanup, null, 2))
})
