import { writeFileSync } from "node:fs"
import { expect, type Locator } from "@playwright/test"

export async function expectClearOfStudyBar(target: Locator, evidencePath?: string) {
  await target.evaluate((element) =>
    element.scrollIntoView({ block: "end", inline: "nearest", behavior: "instant" }),
  )
  const bounds = await target.evaluate(async (element) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    const bar = document.querySelector(".desk-foot"),
      pane = element.closest(".desk-main")
    if (!bar || !pane) throw new TypeError("Expected the existing desk scroll region and study bar")
    const rect = element.getBoundingClientRect(),
      barRect = bar.getBoundingClientRect(),
      paneRect = pane.getBoundingClientRect()
    return {
      text: element.textContent,
      bottom: rect.bottom,
      top: rect.top,
      barTop: barRect.top,
      paneTop: paneRect.top,
      paneBottom: paneRect.bottom,
      scrollTop: pane.scrollTop,
      scrollHeight: pane.scrollHeight,
    }
  })
  expect(bounds.bottom, JSON.stringify(bounds)).toBeLessThanOrEqual(bounds.barTop - 16)
  expect(bounds.bottom, JSON.stringify(bounds)).toBeLessThanOrEqual(bounds.paneBottom - 16)
  expect(bounds.bottom, JSON.stringify(bounds)).toBeGreaterThan(bounds.paneTop)
  if (evidencePath) writeFileSync(evidencePath, JSON.stringify(bounds, null, 2))
  return bounds
}
