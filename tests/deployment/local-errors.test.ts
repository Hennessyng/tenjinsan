import { writeFile } from "node:fs/promises"
import type { Server } from "node:net"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  type LocalFixture,
  LocalLauncher,
  makeLocalFixture,
  occupyPort,
  releasePort,
  removeLocalFixture,
} from "./local-fixture.ts"

const fixtures: LocalFixture[] = []
const launchers: LocalLauncher[] = []
const occupiedPorts: Server[] = []

afterEach(async () => {
  for (const launcher of launchers.splice(0)) launcher.forceStop()
  await Promise.all(occupiedPorts.splice(0).map(releasePort))
  await Promise.all(fixtures.splice(0).map(removeLocalFixture))
})

async function runToFailure(environment: NodeJS.ProcessEnv): Promise<string> {
  const launcher = new LocalLauncher(environment)
  launchers.push(launcher)
  await launcher.waitForExit()
  expect(launcher.child.exitCode).not.toBe(0)
  expect(launcher.output).not.toContain('"event":"local-child-started"')
  return launcher.output
}

describe("local launcher preflight failures", () => {
  it("reports invalid configuration before starting children", async () => {
    const fixture = await makeLocalFixture(true)
    fixtures.push(fixture)
    const environment = { ...fixture.environment }
    Reflect.deleteProperty(environment, "AUTH_SECRET")

    const output = await runToFailure(environment)

    expect(output).toContain("ServerConfigError")
    expect(output).toContain("AUTH_SECRET")
  })

  it("guides owner setup before starting children", async () => {
    const fixture = await makeLocalFixture(false)
    fixtures.push(fixture)

    const output = await runToFailure(fixture.environment)

    expect(output).toContain("OwnerNotProvisionedError")
    expect(output).toContain("bun run owner")
  })

  it("reports an occupied API port before starting children", async () => {
    const fixture = await makeLocalFixture(true)
    fixtures.push(fixture)
    const occupiedPort = await occupyPort(fixture.apiPort)
    occupiedPorts.push(occupiedPort)

    const output = await runToFailure(fixture.environment)

    expect(output).toContain("LocalPortUnavailableError")
    expect(output).toContain(`API port ${fixture.apiPort}`)
  })

  it("reports an unwritable private data root before starting children", async () => {
    const fixture = await makeLocalFixture(true)
    fixtures.push(fixture)
    const blockingFile = join(fixture.directory, "not a directory")
    await writeFile(blockingFile, "private")

    const output = await runToFailure({
      ...fixture.environment,
      PRIVATE_DATA_ROOT: join(blockingFile, "library"),
    })

    expect(output).toContain("LocalDataPathError")
    expect(output).toContain("PRIVATE_DATA_ROOT")
  })
})
