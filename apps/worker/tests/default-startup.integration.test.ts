import { spawn } from "node:child_process"
import { once } from "node:events"
import { rmSync } from "node:fs"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { analysisCacheKey, contentDigest } from "@reading-studio/contracts"
import { BookMapPipeline } from "@reading-studio/generation"
import { afterEach, expect, it } from "vitest"
import { bookMapFixture } from "./book-map-fixture.ts"

const fixtures: ReturnType<typeof bookMapFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.storage.close()
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

it("ordinary worker launch claims a consented persisted analysis job", async () => {
  const fixture = bookMapFixture()
  fixtures.push(fixture)
  new BookMapPipeline({
    storage: fixture.storage,
    ownerId: "owner-1",
    installationId: "installation-1",
  }).prepare("setup-1", "grant-1")
  const setup = fixture.storage.sources.getSetup("setup-1")
  if (!setup) throw new TypeError("Fixture setup missing")
  const key = analysisCacheKey(setup.analysis)
  const jobId = `${contentDigest(JSON.stringify([setup.id, "grant-1", key]))}-0`
  const worker = spawn(
    process.execPath,
    ["--experimental-transform-types", fileURLToPath(new URL("../src/index.ts", import.meta.url))],
    {
      env: {
        ...process.env,
        STUDIO_SYNTHETIC_TEST_MODE: "disabled",
        DATABASE_PATH: fixture.databasePath,
        PRIVATE_DATA_ROOT: fixture.privateDataRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  let stderr = ""
  worker.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  try {
    await Promise.race([
      once(worker.stdout, "data"),
      delay(5000).then(() => {
        throw new Error("worker did not start")
      }),
    ])
    const deadline = Date.now() + 4000
    while (
      fixture.storage.execution.getJob(jobId)?.state === "queued" &&
      Date.now() < deadline &&
      worker.exitCode === null
    ) {
      await delay(50)
    }
    expect(fixture.storage.execution.getJob(jobId)?.state, stderr).not.toBe("queued")
  } finally {
    worker.kill("SIGTERM")
    await once(worker, "exit")
  }
})
