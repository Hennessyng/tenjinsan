import { expect, test } from "@playwright/test"

test("studio shell follows interface language, semantics, and keyboard reachability", async ({
  page,
}) => {
  await page.goto("/?lang=en")

  await expect(page.getByRole("link", { name: "Back to the hall" })).toContainText("TENJINSAN")
  await expect(page.getByRole("button", { name: "日本語", exact: true })).toBeVisible()
  await expect(page.getByRole("main")).toHaveCount(1)
  await expect(
    page.getByRole("navigation", { name: "Reading route" }).getByRole("button"),
  ).toHaveCount(9)

  await page.keyboard.press("Tab")
  await expect(page.getByRole("link", { name: /Skip to the reading route/i })).toBeFocused()
})

test("focus treatment and narrow reflow remain accessible", async ({ page }) => {
  await page.setViewportSize({ width: 195, height: 844 })
  await page.goto("/")

  const link = page.getByRole("link", { name: "Back to the hall" })
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
      .getByRole("navigation", { name: "読書ルート" })
      .getByRole("button", { name: /1\. 取り込んで読む/ })

  await importRoom().click()
  await expect(page).toHaveURL("/imports?lang=ja")
  expect(new URL(page.url()).searchParams.has("chapter")).toBe(false)

  await page.reload()
  await expect(page).toHaveURL("/imports?lang=ja")
  await page.goBack()
  await expect(page).toHaveURL(`/${context}`)

  await importRoom().click()
  await importRoom().click()
  await expect(page).toHaveURL("/imports?lang=ja")
})
