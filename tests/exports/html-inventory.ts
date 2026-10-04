import { expect, type Page } from "@playwright/test"

// Independent content oracle: do not import the fixture or production state enumerators.
const first = { en: "Notice the spoken words.", ja: "語られた言葉に注目します。" }
const second = { en: "Separate inference from observation.", ja: "推測と観察を区別します。" }
const ask = { en: "A question allows correction.", ja: "質問は訂正の余地を残します。" }
const guess = { en: "A guess is not evidence.", ja: "推測は根拠ではありません。" }

export const staticInventory = [
  ["layers:layer:first", first],
  ["layers:layer:second", second],
  ["compare:variant:first", first],
  ["compare:variant:second", second],
  ["time:event:first", first],
  ["time:event:second", second],
  ["process:step:first", first],
  ["process:step:second", second],
  ["perspective:viewpoint:first", first],
  ["perspective:viewpoint:second", second],
  ["spatial:layer:first", first],
  ["spatial:layer:second", second],
  ["spatial:viewpoint:first", first],
  ["spatial:viewpoint:second", second],
  ["attention:practice:reflect:ask", ask],
  ["attention:practice:reflect:guess", guess],
  ["layers:practice:reflect:ask", ask],
  ["layers:practice:reflect:guess", guess],
  ["compare:practice:reflect:ask", ask],
  ["compare:practice:reflect:guess", guess],
  ["time:practice:reflect:ask", ask],
  ["time:practice:reflect:guess", guess],
  ["process:practice:reflect:ask", ask],
  ["process:practice:reflect:guess", guess],
  ["perspective:practice:reflect:ask", ask],
  ["perspective:practice:reflect:guess", guess],
  ["spatial:practice:reflect:ask", ask],
  ["spatial:practice:reflect:guess", guess],
] as const

export async function assertStaticInventory(page: Page) {
  expect(
    await page
      .locator("main [data-state]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-state")).sort()),
  ).toEqual(staticInventory.map(([id]) => id).sort())
  for (const [id, explanation] of staticInventory) {
    const state = page.locator(`main [data-state="${id}"]`)
    for (const language of ["en", "ja"] as const) {
      const text = state.locator(".pair").last().locator(`p[lang="${language}"]`)
      expect(await text.count(), `${id}/${language}: missing explanation`).toBe(1)
      expect(await text.textContent(), `${id}/${language}: explanation`).toBe(explanation[language])
      expect(await text.isVisible(), `${id}/${language}: hidden explanation`).toBe(true)
    }
  }
}
