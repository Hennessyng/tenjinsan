import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { publicationFixture } from "@reading-studio/server/publication-fixture"

async function settleCamera(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const camera = document.querySelector<HTMLElement>(".camera")
    if (!camera) throw new TypeError("Missing camera")
    let previous = "",
      stable = 0
    for (let frame = 0; frame < 360; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const current = camera.style.transform
      stable = current === previous ? stable + 1 : 0
      if (stable >= 3) return
      previous = current
    }
    throw new TypeError("Camera failed to settle")
  })
}

for (const width of [375, 768, 1280, 1512]) {
  test(`Japanese publication usable layer stays bounded and unoccluded at ${width}×862`, async ({
    browser,
  }) => {
    const fixture = await publicationFixture({ studioAssets: true })
    const context = await browser.newContext({ viewport: { width, height: 862 } })
    const evidence = join(
      process.cwd(),
      ".sisyphus/runs/TEN-19/evidence/review-fixes/publication-layout",
      `${width}-${crypto.randomUUID()}`,
    )
    await mkdir(evidence, { recursive: true })
    try {
      const page = await context.newPage()
      await page.goto(`${fixture.origin}/?room=display&lang=ja`)
      await expect(page.locator("#desk.is-open")).toBeVisible()
      await expect(page.locator(".stage")).toHaveAttribute("inert", "")
      await settleCamera(page)
      const inspector = await page.evaluate(() => {
        const rect = (selector: string) => {
          const element = document.querySelector(selector)
          if (!element) throw new TypeError(`Missing ${selector}`)
          const box = element.getBoundingClientRect()
          return {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            right: box.right,
            bottom: box.bottom,
          }
        }
        let ancestor = document.getElementById("desk")?.parentElement
        let transformedUsableAncestor = false
        while (ancestor) {
          if (getComputedStyle(ancestor).transform !== "none") transformedUsableAncestor = true
          ancestor = ancestor.parentElement
        }
        const stations = [...document.querySelectorAll<HTMLElement>(".station[data-room]")].map(
          (station) => {
            const node = station.querySelector(".pin")
            if (!node) throw new TypeError("Missing station pin")
            const box = node.getBoundingClientRect()
            return {
              room: station.dataset["room"],
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
            }
          },
        )
        return {
          desk: rect("#desk"),
          stage: rect(".stage"),
          world: rect(".world"),
          route: rect("#route"),
          transformedUsableAncestor,
          stations,
        }
      })
      await writeFile(join(evidence, "inspector-bounds.json"), JSON.stringify(inspector, null, 2))
      await page.screenshot({ path: join(evidence, "inspector.png"), fullPage: true })
      expect(inspector.desk.x).toBeGreaterThanOrEqual(0)
      expect(inspector.desk.right).toBeLessThanOrEqual(width + 1)
      expect(inspector.desk.bottom).toBeLessThanOrEqual(863)
      expect(inspector.transformedUsableAncestor).toBe(false)
      if (width >= 960) expect(inspector.route.right).toBeLessThanOrEqual(84)
      await page.goto(`${fixture.origin}/publications/${fixture.lesson.studyId}?lang=ja`)
      await expect(page.locator("#export-ui")).toBeVisible()
      await settleCamera(page)
      const layer = await page.evaluate(() => {
        const desk = document.getElementById("desk")
        const pane = document.querySelector(".desk-main")
        const main = document.querySelector("#desk .sheet main")
        if (!desk || !pane || !main) throw new TypeError("Missing publication layers")
        const d = desk.getBoundingClientRect(),
          p = pane.getBoundingClientRect(),
          m = main.getBoundingClientRect()
        return {
          desk: { x: d.x, right: d.right },
          pane: { x: p.x, right: p.right, height: p.height },
          main: { x: m.x, right: m.right },
          horizontalOverflow: pane.scrollWidth - pane.clientWidth,
        }
      })
      expect(layer.main.x).toBeGreaterThanOrEqual(layer.pane.x)
      expect(layer.main.right).toBeLessThanOrEqual(layer.pane.right + 1)
      expect(layer.horizontalOverflow).toBeLessThanOrEqual(1)
      for (const selector of [
        "#export-ui",
        '.publication-review button:has-text("公開用に承認")',
        '.publication-review button:has-text("修正する")',
        '.publication-review button:has-text("非公開のままにする")',
      ]) {
        const control = page.locator(selector)
        await control.scrollIntoViewIfNeeded()
        const hit = await control.evaluate((element) => {
          const box = element.getBoundingClientRect()
          const points = [
            [box.x + 2, box.y + 2],
            [box.right - 2, box.y + 2],
            [box.x + box.width / 2, box.y + box.height / 2],
            [box.x + 2, box.bottom - 2],
            [box.right - 2, box.bottom - 2],
          ]
          const ownsHit = points.every(([x, y]) => {
            if (x === undefined || y === undefined) throw new TypeError("Missing hit coordinate")
            const hit = document.elementFromPoint(x, y)
            return hit === element || element.contains(hit)
          })
          return { x: box.x, right: box.right, y: box.y, bottom: box.bottom, ownsHit }
        })
        expect(hit.x).toBeGreaterThanOrEqual(0)
        expect(hit.right).toBeLessThanOrEqual(width + 1)
        expect(hit.y).toBeGreaterThanOrEqual(0)
        expect(hit.bottom).toBeLessThanOrEqual(863)
        expect(hit.ownsHit).toBe(true)
      }
      await page.screenshot({ path: join(evidence, "publication-actions.png"), fullPage: true })
      await writeFile(
        join(evidence, "bounds.json"),
        JSON.stringify({ width, inspector, layer }, null, 2),
      )
      console.log(`TEN-19 publication layout: ${evidence}`)
    } finally {
      await context.close()
      await fixture.close()
    }
  })
}
