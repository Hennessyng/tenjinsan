import { resolve } from "node:path"
import { chromium } from "@playwright/test"
import { z } from "zod"

class BrowserQaError extends Error {
  override readonly name = "BrowserQaError"
}

const inputSchema = z.object({
  AUTH_QA_BASE_URL: z.url(),
  AUTH_QA_EMAIL: z.email(),
  AUTH_QA_PASSWORD: z.string().min(1),
})

const input = inputSchema.parse(process.env)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const attackerOrigin = "http://attacker.invalid"
  await page.route(`${attackerOrigin}/**`, async (route) => {
    const isLogout = route.request().url().endsWith("/logout")
    const form = isLogout
      ? `<form action="${input.AUTH_QA_BASE_URL}/logout" method="post"><button type="submit">Cross-origin logout</button></form>`
      : `<form action="${input.AUTH_QA_BASE_URL}/login" method="post"><input name="email" value="${input.AUTH_QA_EMAIL}"><input name="password" value="${input.AUTH_QA_PASSWORD}"><button type="submit">Cross-origin login</button></form>`
    await route.fulfill({ body: form, contentType: "text/html", status: 200 })
  })
  await page.goto(`${input.AUTH_QA_BASE_URL}/login`)
  await page.getByLabel("Email").fill(input.AUTH_QA_EMAIL)
  await page.getByLabel("Password").fill(input.AUTH_QA_PASSWORD)
  await page.getByRole("button", { name: "Log in" }).click()
  await page.locator('[data-authenticated="true"]').waitFor()
  await page.screenshot({
    fullPage: true,
    path: resolve(".omo/evidence/reading-studio/task-5/login.png"),
  })
  const sessionBeforeAttack = (await page.context().cookies(input.AUTH_QA_BASE_URL)).find(
    (cookie) => cookie.name.includes("session_token"),
  )
  if (sessionBeforeAttack === undefined) {
    throw new BrowserQaError("Same-origin login did not create a session cookie")
  }
  await page.goto(`${attackerOrigin}/logout`)
  const hostileLogout = page.waitForResponse(
    (response) =>
      response.url() === `${input.AUTH_QA_BASE_URL}/logout` &&
      response.request().method() === "POST",
  )
  await page.getByRole("button", { name: "Cross-origin logout" }).click()
  if ((await hostileLogout).status() !== 403) {
    throw new BrowserQaError("Cross-origin logout was not rejected")
  }
  const sessionAfterAttack = (await page.context().cookies(input.AUTH_QA_BASE_URL)).find((cookie) =>
    cookie.name.includes("session_token"),
  )
  if (sessionAfterAttack?.value !== sessionBeforeAttack.value) {
    throw new BrowserQaError("Cross-origin logout mutated the session cookie")
  }
  await page.goto(input.AUTH_QA_BASE_URL)
  await page.locator('[data-authenticated="true"]').waitFor()
  await page.getByRole("button", { name: "Log out" }).click()
  await page.getByRole("heading", { name: "Owner login" }).waitFor()
  const cookies = await page.context().cookies()
  if (cookies.some((cookie) => cookie.name.includes("session_token") && cookie.value !== "")) {
    throw new BrowserQaError("Logout retained an active session cookie")
  }
  await page.goto(`${attackerOrigin}/login`)
  const hostileLogin = page.waitForResponse(
    (response) =>
      response.url() === `${input.AUTH_QA_BASE_URL}/login` &&
      response.request().method() === "POST",
  )
  await page.getByRole("button", { name: "Cross-origin login" }).click()
  if ((await hostileLogin).status() !== 403) {
    throw new BrowserQaError("Cross-origin login was not rejected")
  }
  if (
    (await page.context().cookies(input.AUTH_QA_BASE_URL)).some((cookie) =>
      cookie.name.includes("session_token"),
    )
  ) {
    throw new BrowserQaError("Cross-origin login created a session cookie")
  }
  for (const viewport of [
    { name: "375", width: 375, height: 812 },
    { name: "768", width: 768, height: 900 },
    { name: "1280", width: 1280, height: 720 },
  ] as const) {
    await page.setViewportSize(viewport)
    await page.goto(`${input.AUTH_QA_BASE_URL}/login`)
    await page.keyboard.press("Tab")
    await page.screenshot({
      fullPage: true,
      path: resolve(`.omo/evidence/reading-studio/task-5/login-${viewport.name}.png`),
    })
  }
} finally {
  await browser.close()
}
