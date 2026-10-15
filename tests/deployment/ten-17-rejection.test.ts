import { once } from "node:events"
import { mkdir } from "node:fs/promises"
import { createServer } from "node:http"
import { join, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { expect, it } from "vitest"
import { z } from "zod"
import { workspaceRoot } from "./local-fixture.ts"
import {
  browserLogin,
  oldPassword,
  ownerEmail,
  recoveryFixture,
} from "./ten-17-owner-recovery-fixture.ts"

const evidence = process.env["TEN17_EVIDENCE_DIR"] ?? resolve(workspaceRoot, ".omo/evidence/ten-17")

it.each(["origin", "body", "rate"] as const)(
  "shows real browser %s rejection and preserved security boundaries",
  async (kind) => {
    const fixture = await recoveryFixture()
    const attacker = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      response.end(
        `<form action="${fixture.origin}/login" method="post"><input name="email" value="owner@example.test"><input name="password" value="synthetic-wrong"><button>Submit</button></form>`,
      )
    })
    try {
      expect(fixture.tty()).toBe(0)
      const ready = await fixture.start()
      const context = await fixture.context()
      const page = await context.newPage()
      if (kind === "rate") {
        for (let i = 0; i < 5; i += 1)
          expect(await browserLogin(context, fixture.origin, "synthetic-wrong")).toBe(401)
      }
      if (kind === "origin") {
        attacker.listen(0, "127.0.0.1")
        await once(attacker, "listening")
        const address = attacker.address()
        if (address === null || typeof address === "string")
          throw new TypeError("Fixture attacker listener missing")
        await page.goto(`http://127.0.0.1:${address.port}`)
      } else {
        await page.goto(`${fixture.origin}/login`)
        await page.getByLabel("Email").fill(ownerEmail)
        await page
          .getByLabel("Password")
          .fill(kind === "body" ? "x".repeat(17000) : "synthetic-wrong")
      }
      const [response] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url() === `${fixture.origin}/login` && response.request().method() === "POST",
        ),
        page.getByRole("button").click(),
      ])
      expect(response.status()).toBe(kind === "origin" ? 403 : kind === "body" ? 413 : 429)
      const trace = z.uuid().parse(response.headers()["x-trace-id"])
      expect(response.headers()["x-request-id"]).toBe(trace)
      expect(await page.locator("[data-trace-id]").textContent()).toBe(trace)
      expect(await page.getByRole("alert").isVisible()).toBe(true)
      expect((await context.request.get(`${fixture.origin}/api/library-context`)).status()).toBe(
        401,
      )
      expect((await context.cookies()).some((cookie) => cookie.name.includes("session"))).toBe(
        false,
      )
      await mkdir(evidence, { recursive: true })
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
        await page.keyboard.press("Tab")
        expect(
          await page
            .getByRole("link", { name: "Return to login" })
            .evaluate((link) => link === document.activeElement),
        ).toBe(true)
        await page.screenshot({ path: join(evidence, `${kind}-${width}.png`), fullPage: true })
        await page.keyboard.press("Shift+Tab")
      }
      if (kind === "rate") {
        await delay(61_000)
        expect(await browserLogin(context, fixture.origin, oldPassword)).toBe(303)
        expect((await context.request.get(`${fixture.origin}/api/library-context`)).status()).toBe(
          200,
        )
        expect((await fixture.launchers.at(-1)?.ready())?.launcherPid).toBe(ready.launcherPid)
      }
    } finally {
      if (attacker.listening) await new Promise<void>((resolve) => attacker.close(() => resolve()))
      await fixture.close()
    }
  },
  150_000,
)
