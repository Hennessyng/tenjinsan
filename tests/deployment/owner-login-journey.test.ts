import { execFileSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium } from "@playwright/test"
import { expect, it } from "vitest"
import { z } from "zod"
import {
  LocalLauncher,
  makeLocalFixture,
  removeLocalFixture,
  workspaceRoot,
} from "./local-fixture.ts"

const loginEventSchema = z.object({
  event: z.string(),
  category: z.string(),
  trace_id: z.uuid(),
  status: z.number().nullable(),
  upstream_status: z.number().optional(),
})

it("correlates rejected and successful browser login after the interactive owner CLI", async () => {
  // Given an empty isolated database provisioned through the real controlling TTY.
  const fixture = await makeLocalFixture(false)
  let launcher: LocalLauncher | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    expect(
      execFileSync("expect", ["tests/deployment/owner-tty-fixture.exp", "bun", "run", "owner"], {
        cwd: workspaceRoot,
        env: { ...fixture.environment, VITEST: undefined },
        encoding: "utf8",
        timeout: 120_000,
      }),
    ).toBe("")
    launcher = new LocalLauncher(fixture.environment)
    const ready = await launcher.ready()
    browser = await chromium.launch()
    const page = await browser.newPage()
    await page.goto(`${ready.apiUrl}/login`)
    await page.getByLabel("Email").fill("owner@example.test")
    await page.getByLabel("Password").fill("wrong synthetic password")

    // When the browser submits an incorrect password, then correct CLI credentials.
    const rejection = page.waitForResponse(
      (response) =>
        response.url() === `${ready.apiUrl}/login` && response.request().method() === "POST",
    )
    await page.getByRole("button", { name: "Log in" }).click()
    const rejected = await rejection
    const rejectedTrace = z.uuid().parse(rejected.headers()["x-trace-id"])
    expect(rejected.status()).toBe(401)
    expect(await page.locator("[data-trace-id]").textContent()).toBe(rejectedTrace)
    await launcher.waitForOutput(rejectedTrace)
    const captured = await fetch(`${ready.diagnosticEventsUrl}?trace_id=${rejectedTrace}`)
    expect(await captured.json()).toMatchObject({
      events: [
        expect.objectContaining({
          event: "auth.login.rejected",
          category: "invalid-credentials",
          trace_id: rejectedTrace,
        }),
      ],
    })
    const cliCapture = execFileSync(
      process.execPath,
      ["--experimental-transform-types", "scripts/local-logs.ts", "--trace-id", rejectedTrace],
      { cwd: workspaceRoot, env: fixture.environment, encoding: "utf8" },
    )
    expect(JSON.parse(cliCapture)).toMatchObject({
      trace_id: rejectedTrace,
      events: [expect.objectContaining({ category: "invalid-credentials" })],
    })
    const evidence = resolve(workspaceRoot, ".omo/evidence/reading-studio/owner-login-journey")
    await mkdir(evidence, { recursive: true })
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.locator("[data-trace-id]").scrollIntoViewIfNeeded()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({ path: resolve(evidence, `rejected-${width}.png`), fullPage: true })
    }
    await page.getByLabel("Email").fill("owner@example.test")
    await page.getByLabel("Password").fill("correct horse battery staple")
    const success = page.waitForResponse(
      (response) =>
        response.url() === `${ready.apiUrl}/login` && response.request().method() === "POST",
    )
    await page.getByRole("button", { name: "Log in" }).click()
    const accepted = await success
    const acceptedTrace = z.uuid().parse(accepted.headers()["x-trace-id"])
    await page.waitForURL((url) => url.pathname === "/")
    await page.locator("main#library").waitFor({ state: "visible" })
    await launcher.waitForOutput(acceptedTrace)

    // Then both outcomes join to safe server events and the session grants API access.
    expect(accepted.status()).toBe(303)
    expect(acceptedTrace).not.toBe(rejectedTrace)
    expect((await page.request.get(`${ready.apiUrl}/api/library-context`)).status()).toBe(200)
    const events = launcher.output
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => loginEventSchema.parse(JSON.parse(line)))
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "auth.login.rejected",
        category: "invalid-credentials",
        trace_id: rejectedTrace,
        status: 401,
        upstream_status: 401,
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "auth.login.success",
        category: "success",
        trace_id: acceptedTrace,
        status: 303,
      }),
    )
    expect(launcher.output).not.toContain("owner@example.test")
    expect(launcher.output).not.toContain("correct horse battery staple")
    expect(launcher.output).not.toContain("wrong synthetic password")
    await writeFile(
      resolve(evidence, "receipt.json"),
      JSON.stringify(
        {
          journey: "owner-cli/server/browser",
          rejectedTrace,
          acceptedTrace,
          rejection: 401,
          login: 303,
          authenticatedApi: 200,
        },
        null,
        2,
      ),
    )
    await launcher.stop(ready.launcherPid)
  } finally {
    await browser?.close()
    launcher?.forceStop()
    if (launcher !== undefined) await launcher.waitForExit()
    await removeLocalFixture(fixture)
  }
}, 180_000)
