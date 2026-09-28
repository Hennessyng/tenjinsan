import { expect, test } from "@playwright/test"
import { evidenceFixture } from "@reading-studio/server/evidence-fixture"

test("reader serves the current projection only to its owner", async ({ browser }) => {
  // Given
  const fixture = await evidenceFixture()
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  try {
    expect((await page.request.get(`${fixture.origin}${fixture.path}/read`)).status()).toBe(401)
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.goto(`${fixture.origin}${fixture.path}`)
    // When
    await page.getByRole("link", { name: "Read bilingual lesson" }).click()
    // Then
    await expect(page.locator("[data-state]").first()).toBeVisible()
    const response = await page.request.get(page.url())
    expect(response.headers()["cache-control"]).toBe("private, no-store")
    expect(response.headers()["content-security-policy"]).toContain("default-src 'none'")
    expect(
      (
        await page.request.get(`${fixture.origin}/evidence/other/${fixture.lesson.id}/read`)
      ).status(),
    ).toBe(404)
    expect(
      (
        await page.request.post(page.url(), {
          headers: { origin: fixture.origin },
          form: { action: "keep-private" },
        })
      ).status(),
    ).toBe(415)
    expect(fixture.storage.counts()).toMatchObject({ publications: 0, jobs: 0 })
  } finally {
    await context.close()
    await fixture.close()
  }
})

test("allows only the trusted scene runtime on the authenticated reading route", async ({
  page,
}) => {
  // Given
  const fixture = await evidenceFixture()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  try {
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    // When
    const response = await page.goto(`${fixture.origin}${fixture.path}/read`)
    // Then
    expect(response?.headers()["content-security-policy"]).toMatch(
      /script-src 'sha256-[A-Za-z0-9+/]+=*'/,
    )
    expect(response?.headers()["content-security-policy"]).not.toContain(
      "script-src 'unsafe-inline'",
    )
    const figure = page.locator("[data-svg-scene]").first()
    await expect(figure.locator("[data-scene-controls]")).toBeVisible()
    await figure.locator("[data-play]").click()
    await expect(figure).toHaveAttribute("data-playback", "playing")
    await figure.locator("[data-pause]").click()
    const blocked = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          document.addEventListener(
            "securitypolicyviolation",
            (event) => resolve(event.violatedDirective === "script-src-elem"),
            { once: true },
          )
          const script = document.createElement("script")
          script.textContent = "document.body.dataset.untrusted = 'executed'"
          document.body.append(script)
        }),
    )
    expect(blocked).toBe(true)
    await expect(page.locator("body")).not.toHaveAttribute("data-untrusted", "executed")
    const review = await page.request.get(`${fixture.origin}${fixture.path}`)
    expect(review.headers()["content-security-policy"]).not.toContain("script-src")
    expect(errors).toEqual([])
  } finally {
    await fixture.close()
  }
})
