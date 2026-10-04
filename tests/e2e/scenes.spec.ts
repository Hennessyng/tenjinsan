import { mkdir, writeFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { readerFixture } from "@reading-studio/reader/testing"

const evidence = ".omo/evidence/reading-studio/task-22"
let fixture: Awaited<ReturnType<typeof readerFixture>>
test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true })
  fixture = await readerFixture()
})
test.afterAll(async () => fixture.close())

test("seeks exact shared times, pauses, replays and selects concepts by keyboard", async ({
  page,
}) => {
  // Given
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`${fixture.origin}/scenes`)
  const figure = page.locator("[data-svg-scene]").first()
  const seek = figure.locator("[data-seek]")
  await figure.locator("[data-play]").scrollIntoViewIfNeeded()
  // When
  await seek.fill("1200")
  // Then
  await expect(figure).toHaveAttribute("data-current-state", "layers:layer:ask")
  expect(
    await figure.evaluate((node) =>
      node.getAnimations({ subtree: true }).map((animation) => animation.currentTime),
    ),
  ).toEqual([1200, 1200, 1200])
  expect(
    await figure
      .locator("[data-scene-mark]")
      .evaluateAll((nodes) => nodes.map((node) => Number(getComputedStyle(node).opacity))),
  ).toEqual([0.35, 1, 0.35])
  await figure.locator("[data-play]").focus()
  await page.keyboard.press("Enter")
  await expect(figure).toHaveAttribute("data-playback", "playing")
  await expect.poll(() => seek.inputValue()).not.toBe("1200")
  await figure.locator("[data-pause]").click()
  const stopped = await seek.inputValue()
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
  expect(await seek.inputValue()).toBe(stopped)
  expect(
    await figure.evaluate((node) =>
      node.getAnimations({ subtree: true }).every((animation) => animation.playState === "paused"),
    ),
  ).toBe(true)
  await figure.locator("[data-select-state]").last().focus()
  await page.keyboard.press("Space")
  await expect(seek).toHaveValue("2400")
  await expect(figure.locator("[data-select-state]").last()).toHaveAttribute("aria-pressed", "true")
  await seek.focus()
  await page.keyboard.press("End")
  await expect(seek).toHaveValue("3600")
  await figure.locator("[data-replay]").click()
  await expect(figure).toHaveAttribute("data-playback", "playing")
  expect(Number(await seek.inputValue())).toBeLessThan(1200)
  await figure.locator("[data-pause]").click()
  expect(errors).toEqual([])
})

test("pauses off-screen and does not restart on return", async ({ page }) => {
  // Given
  await page.goto(`${fixture.origin}/scenes`)
  const figure = page.locator("[data-svg-scene]").first()
  await figure.locator("[data-play]").click()
  await expect(figure).toHaveAttribute("data-playback", "playing")
  // When
  await page.locator("footer").scrollIntoViewIfNeeded()
  // Then
  await expect(figure).toHaveAttribute("data-playback", "paused")
  const time = await figure.locator("[data-seek]").inputValue()
  await figure.scrollIntoViewIfNeeded()
  await expect(figure).toHaveAttribute("data-playback", "paused")
  await expect(figure.locator("[data-seek]")).toHaveValue(time)
})

for (const mode of ["reduce", "missing-waapi"] as const) {
  test(`keeps all concepts keyboard-accessible in ${mode}`, async ({ page }) => {
    // Given
    if (mode === "reduce") await page.emulateMedia({ reducedMotion: "reduce" })
    else
      await page.addInitScript(() => {
        Object.defineProperty(Element.prototype, "animate", { value: undefined })
      })
    await page.goto(`${fixture.origin}/scenes`)
    // When
    for (const figure of await page.locator("[data-svg-scene]").all()) {
      await figure.locator("[data-select-state]").last().focus()
      await page.keyboard.press("Enter")
      // Then
      await expect(figure.locator("[data-seek]")).toHaveValue("2400")
      await expect(figure.locator("[data-play]")).toBeDisabled()
      await expect(figure.locator("[data-replay]")).toBeDisabled()
      expect(
        await figure.evaluate((node) =>
          node
            .getAnimations({ subtree: true })
            .some((animation) => animation.playState === "running"),
        ),
      ).toBe(false)
      expect(
        await figure
          .locator("[data-scene-mark]")
          .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).opacity)),
      ).toEqual(["1", "1", "1"])
      await expect(figure.locator("figcaption")).toBeVisible()
    }
    for (const state of await page.locator("[data-state]").all()) await expect(state).toBeVisible()
    await page.screenshot({ path: `${evidence}/${mode}.png`, fullPage: true })
  })
}

test("stops immediately when reduced motion is enabled during playback", async ({ page }) => {
  // Given
  await page.goto(`${fixture.origin}/scenes`)
  const figure = page.locator("[data-svg-scene]").first()
  await figure.locator("[data-play]").click()
  // When
  await page.emulateMedia({ reducedMotion: "reduce" })
  // Then
  await expect(figure).toHaveAttribute("data-playback", "paused")
  await expect(figure.locator("[data-play]")).toBeDisabled()
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await expect(figure.locator("[data-play]")).toBeEnabled()
  await expect(figure).toHaveAttribute("data-playback", "paused")
})

for (const width of [375, 768, 1280]) {
  test(`captures every scene at initial, middle and final times at ${width}px`, async ({
    page,
  }) => {
    // Given
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`${fixture.origin}/scenes`)
    const measurements = []
    // When
    for (const [index, figure] of (await page.locator("[data-svg-scene]").all()).entries()) {
      for (const time of [0, 1100, 1200, 3600]) {
        await figure.locator("[data-seek]").fill(String(time))
        // Then
        await expect(figure).toHaveAttribute("data-playback", "paused")
        expect(
          await figure.evaluate((node) =>
            node.getAnimations({ subtree: true }).map((animation) => animation.currentTime),
          ),
        ).toEqual([time, time, time])
        const measurement = await figure.evaluate((node) => ({
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
          textOverflow: Array.from(node.querySelectorAll<HTMLElement>("button,li,p,label")).some(
            (element) => element.scrollWidth > element.clientWidth + 1,
          ),
          state: node.getAttribute("data-current-state"),
        }))
        expect(measurement.pageOverflow).toBe(false)
        expect(measurement.textOverflow).toBe(false)
        measurements.push({ index, time, ...measurement })
        await figure.screenshot({ path: `${evidence}/scene-${index}-${width}-${time}.png` })
      }
    }
    expect(await page.locator("[data-loop-arrow]").count()).toBe(1)
    await page.screenshot({ path: `${evidence}/scene-states-${width}.png`, fullPage: true })
    await writeFile(`${evidence}/geometry-${width}.json`, JSON.stringify(measurements, null, 2))
  })
}
