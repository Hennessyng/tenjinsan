import { spawnSync } from "node:child_process"
import { access, realpath, writeFile } from "node:fs/promises"
import { join, resolve, sep } from "node:path"
import { expect, it } from "vitest"
import { occupyPort, releasePort } from "./local-fixture.ts"
import { browserLogin, oldPassword, recoveryFixture } from "./ten-17-owner-recovery-fixture.ts"

it("isolates configuration and each copied revision's workspace aliases", async () => {
  const fixture = await recoveryFixture()
  try {
    await expect(access(join(fixture.root, ".env"))).rejects.toMatchObject({ code: "ENOENT" })
    expect(fixture.environment).not.toHaveProperty("VITEST")
    expect(fixture.environment).not.toHaveProperty("OWNER_PASSWORD")
    expect(fixture.environment).not.toHaveProperty("OPENAI_API_KEY")
    expect(
      resolve(fixture.root, fixture.environment["DATABASE_PATH"] ?? "").startsWith(
        `${fixture.fixture.directory}${sep}`,
      ),
    ).toBe(true)
    expect(await realpath(join(fixture.root, "node_modules/@reading-studio/server"))).toBe(
      await realpath(join(fixture.root, "apps/server")),
    )
    const invoked = spawnSync("bun", ["run", "owner", "--", "not-a-secret-option"], {
      cwd: fixture.root,
      env: fixture.environment,
      encoding: "utf8",
      timeout: 10_000,
    })
    expect(invoked.status).toBe(2)
    expect(invoked.stderr).toContain("OwnerCliUsageError")
  } finally {
    await fixture.close()
  }
})

it("refuses a busy default port without stopping its occupant or substituting an origin", async () => {
  const server = await occupyPort(8787)
  try {
    await expect(recoveryFixture({ defaultOrigin: true })).rejects.toMatchObject({
      code: "EADDRINUSE",
    })
    expect(server.listening).toBe(true)
  } finally {
    await releasePort(server)
  }
})

it("keeps named startup failures before readiness/children and preserves working credentials", async () => {
  const fixture = await recoveryFixture()
  try {
    const launch = (environment: NodeJS.ProcessEnv) =>
      spawnSync("bun", ["run", "start:local"], {
        cwd: fixture.root,
        env: environment,
        encoding: "utf8",
        timeout: 15_000,
      })
    const missing = launch(fixture.environment)
    expect(missing.status).toBe(2)
    expect(missing.stderr).toContain("OwnerNotProvisionedError")
    expect(fixture.tty()).toBe(0)
    const file = join(fixture.fixture.directory, "not a directory")
    await writeFile(file, "fixture only")
    for (const [environment, name] of [
      [{ ...fixture.environment, PRIVATE_DATA_ROOT: file }, "LocalDataPathError"],
      [{ ...fixture.environment, AUTH_BASE_URL: "http://attacker.test" }, "LocalConfigError"],
    ] as const) {
      const result = launch(environment)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain(name)
      expect(result.stdout).not.toContain("local-child-started")
      expect(result.stdout).not.toContain("local-ready")
    }
    await fixture.start()
    const context = await fixture.context()
    expect(await browserLogin(context, fixture.origin, oldPassword)).toBe(303)
    expect((await context.request.get(`${fixture.origin}/api/library-context`)).status()).toBe(200)
  } finally {
    await fixture.close()
  }
}, 90_000)
