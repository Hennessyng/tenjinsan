import { expect, test } from "@playwright/test"

test("studio shell is bilingual, semantic, and keyboard reachable", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByRole("heading", { level: 1, name: /reading studio/i })).toBeVisible()
  await expect(page.locator("[lang='ja']", { hasText: "読書スタジオ" }).first()).toBeVisible()

  await page.keyboard.press("Tab")
  await expect(page.getByRole("link", { name: /skip to the studio/i })).toBeFocused()
})

test("focus treatment and narrow reflow remain accessible", async ({ page }) => {
  await page.setViewportSize({ width: 195, height: 844 })
  await page.goto("/")

  const link = page.getByRole("link", { name: /about this foundation/i })
  await link.focus()
  expect(await link.evaluate((element) => getComputedStyle(element).outlineColor)).toBe(
    "rgb(138, 61, 39)",
  )
  expect(await page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(
    true,
  )
})

test("room navigation preserves query context through browser history and repeated use", async ({
  page,
}) => {
  const context = "?chapter=2&lang=ja"
  await page.goto(`/${context}`)

  const importRoom = () =>
    page
      .getByRole("navigation", { name: "Workspace rooms" })
      .getByRole("link", { name: /Import a book/ })
      .first()

  await expect(importRoom()).toHaveAttribute("href", `/imports${context}`)
  await importRoom().click()
  await expect(page).toHaveURL(`/imports${context}`)

  await page.reload()
  await expect(page).toHaveURL(`/imports${context}`)
  await page.goBack()
  await expect(page).toHaveURL(`/${context}`)

  await importRoom().click()
  await importRoom().click()
  await expect(page).toHaveURL(`/imports${context}`)
})
