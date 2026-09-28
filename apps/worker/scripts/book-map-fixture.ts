import { spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { openStorage } from "@reading-studio/storage"
import { bookMapFixture, FixtureAdapter, fixtureWorker } from "../tests/book-map-fixture.ts"

const databasePath = process.argv[2]
const privateDataRoot = process.argv[3]
if (databasePath && privateDataRoot) {
  const storage = openStorage({ databasePath, privateDataRoot })
  try {
    const adapter = new FixtureAdapter()
    const { pipeline, worker } = fixtureWorker(storage, adapter)
    const outcome = await worker.runNext()
    const map = pipeline.prepare("setup-1", "grant-1")
    process.stdout.write(
      `${JSON.stringify({ kind: outcome.kind, calls: adapter.requests.length, status: map.status, revision: map.id })}\n`,
    )
  } finally {
    storage.close()
  }
} else {
  const fixture = bookMapFixture("Synthetic bounded passage. ".repeat(1000))
  try {
    const { pipeline } = fixtureWorker(fixture.storage, new FixtureAdapter())
    const initial = pipeline.prepare("setup-1", "grant-1")
    fixture.storage.close()
    const jobs: unknown[] = []
    for (let index = 0; index < 5; index++) {
      const child = spawnSync(
        process.execPath,
        [
          "--experimental-transform-types",
          fileURLToPath(import.meta.url),
          fixture.databasePath,
          fixture.privateDataRoot,
        ],
        { encoding: "utf8" },
      )
      if (child.status !== 0) throw new TypeError(`Fixture worker failed: ${child.stderr}`)
      jobs.push(JSON.parse(child.stdout))
    }
    fixture.storage = openStorage(fixture)
    const result = fixtureWorker(fixture.storage, new FixtureAdapter()).pipeline.prepare(
      "setup-1",
      "grant-1",
    )
    if (result.status !== "successful") throw new TypeError("Fixture analysis remains incomplete")
    process.stdout.write(
      `${JSON.stringify({ fixtureOnly: true, initialRevision: initial.id, jobs, bookMap: result }, null, 2)}\n`,
    )
  } finally {
    fixture.storage.close()
    rmSync(fixture.directory, { recursive: true, force: true })
  }
}
