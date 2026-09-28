import { afterEach, describe, expect, it } from "vitest"
import {
  isProcessRunning,
  type LocalFixture,
  LocalLauncher,
  makeLocalFixture,
  removeLocalFixture,
} from "./local-fixture.ts"

const fixtures: LocalFixture[] = []
const launchers: LocalLauncher[] = []

afterEach(async () => {
  for (const launcher of launchers.splice(0)) launcher.forceStop()
  await Promise.all(fixtures.splice(0).map(removeLocalFixture))
})

describe("documented local launcher", () => {
  it("starts UI, API, and worker from private paths and cleans every child on SIGTERM", async () => {
    const fixture = await makeLocalFixture(true)
    fixtures.push(fixture)
    const launcher = new LocalLauncher(fixture.environment)
    launchers.push(launcher)

    const ready = await launcher.ready()
    const health = await fetch(`${ready.apiUrl}/health`)
    const studio = await fetch(ready.studioUrl)
    const loginPage = await fetch(`${ready.apiUrl}/login`)

    expect(await health.json()).toEqual({ status: "ok" })
    expect(studio.status).toBe(200)
    expect(loginPage.status).toBe(200)
    expect(await loginPage.text()).toContain('form action="/login"')

    const login = await fetch(`${ready.apiUrl}/login`, {
      body: new URLSearchParams({
        email: "owner@example.test",
        password: "correct horse battery staple",
      }),
      headers: { origin: ready.apiUrl },
      method: "POST",
      redirect: "manual",
    })
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ")
    const ownerPage = await fetch(ready.apiUrl, {
      headers: { cookie },
      redirect: "manual",
    })

    expect(login.status).toBe(303)
    expect(ownerPage.status).toBe(200)
    expect(await ownerPage.text()).toContain('<div id="root"></div>')

    await launcher.stop(ready.launcherPid)

    expect(isProcessRunning(ready.children.api)).toBe(false)
    expect(isProcessRunning(ready.children.studio)).toBe(false)
    expect(isProcessRunning(ready.children.worker)).toBe(false)
  }, 30_000)

  it("cleans started children when signaled before readiness", async () => {
    const fixture = await makeLocalFixture(true)
    fixtures.push(fixture)
    const launcher = new LocalLauncher(fixture.environment)
    launchers.push(launcher)

    await launcher.waitForOutput('"event":"local-starting"')
    await launcher.waitForOutput('"event":"local-child-started"')
    process.kill(launcher.startingPid(), "SIGTERM")
    await launcher.waitForOutput('"event":"local-stopped"')
    await launcher.waitForExit()

    const startedPids = launcher.startedPids()
    expect(startedPids.length).toBeGreaterThan(0)
    expect(startedPids.every((pid) => !isProcessRunning(pid))).toBe(true)
  }, 30_000)
})
