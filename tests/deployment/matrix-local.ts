import { spawnSync } from "node:child_process"
import { rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { Browser, BrowserContext } from "@playwright/test"
import { z } from "zod"
import {
  LocalLauncher,
  makeLocalFixture,
  removeLocalFixture,
  workspaceRoot,
} from "./local-fixture.ts"
import type { RunningMatrix } from "./matrix-deployments.ts"
import type { MatrixFault } from "./matrix-driver.ts"
import { restoreLocalMatrix } from "./matrix-restore-local.ts"
import { readMatrixSnapshot } from "./matrix-snapshot.ts"
import { rejectStaleCommit } from "./matrix-stale-commit.ts"
import { startProductionWire } from "./production-wire.ts"

export async function startLocalMatrix(browser: Browser): Promise<RunningMatrix> {
  const fixture = await makeLocalFixture(false)
  const provisioned = spawnSync(
    "expect",
    ["tests/deployment/owner-tty-fixture.exp", "bun", "run", "owner"],
    { cwd: workspaceRoot, env: fixture.environment, encoding: "utf8", timeout: 90_000 },
  )
  if (provisioned.status !== 0) {
    await removeLocalFixture(fixture)
    throw new TypeError(`Source owner TTY provision failed (${provisioned.status})`)
  }
  const wire = await startProductionWire()
  const environment: NodeJS.ProcessEnv = {
    ...fixture.environment,
    OPENROUTER_API_KEY: "wire-only-test-credential",
    ANTHROPIC_API_KEY: "wire-only-test-credential",
    STUDIO_PROVIDER_BASE_URL: wire.baseURL,
    STUDIO_MATRIX_RENDER_FAILURE: "enabled",
  }
  delete environment["STUDIO_SYNTHETIC_TEST_MODE"]
  let launcher = new LocalLauncher(environment)
  let context: BrowserContext | undefined
  try {
    const ready = await launcher.ready()
    context = await browser.newContext()
    const page = await context.newPage()
    const paths = z
      .object({ DATABASE_PATH: z.string(), PRIVATE_DATA_ROOT: z.string() })
      .parse(environment)
    return {
      deployment: {
        origin: ready.apiUrl,
        page,
        snapshot: async (setupId) =>
          readMatrixSnapshot(paths.DATABASE_PATH, paths.PRIVATE_DATA_ROOT, setupId),
        fault: async (fault: MatrixFault) => wire.setFault(fault),
        renderFailure: async (enabled) => {
          const marker = join(dirname(paths.DATABASE_PATH), "matrix-render-failure")
          if (enabled) await writeFile(marker, "enabled")
          else await rm(marker, { force: true })
        },
        transfer: async (targets) => restoreLocalMatrix(browser, fixture, targets),
        wireCount: async () => wire.metrics.length,
        heldCount: async () => wire.metrics.filter((metric) => metric.fault === "hold").length,
        releaseHeld: async () => {
          wire.releaseHeld()
        },
        rememberLease: async () => undefined,
        rejectStaleCommit: async (jobId, lease) =>
          rejectStaleCommit(
            { databasePath: paths.DATABASE_PATH, privateDataRoot: paths.PRIVATE_DATA_ROOT },
            jobId,
            lease,
          ),
        restartWorker: async (setupId, jobId) => {
          process.kill(ready.children.worker, "SIGKILL")
          await launcher.waitForExit()
          wire.releaseHeld()
          const { DatabaseSync } = await import("node:sqlite")
          const sqlite = new DatabaseSync(paths.DATABASE_PATH)
          try {
            const job = readMatrixSnapshot(
              paths.DATABASE_PATH,
              paths.PRIVATE_DATA_ROOT,
              setupId,
            ).setup?.jobs.find((item) => item.id === jobId && item.state === "running")
            if (!job) throw new TypeError("Missing running job to expire")
            sqlite
              .prepare("UPDATE jobs SET lease_expires_at = ? WHERE id = ? AND state = 'running'")
              .run("2000-01-01T00:00:00.000Z", job.id)
          } finally {
            sqlite.close()
          }
          launcher = new LocalLauncher(environment)
          await launcher.ready()
        },
      },
      stop: async () => {
        await context?.close()
        if (launcher.child.exitCode === null && launcher.child.signalCode === null)
          launcher.forceStop()
        await launcher.waitForExit()
        await wire.close()
        await removeLocalFixture(fixture)
      },
    }
  } catch (error) {
    if (launcher.child.exitCode === null && launcher.child.signalCode === null) launcher.forceStop()
    await context?.close()
    await wire.close()
    await removeLocalFixture(fixture)
    throw error
  }
}
