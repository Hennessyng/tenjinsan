import { spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Digest } from "@reading-studio/contracts"
import { openStorage } from "@reading-studio/storage"
import { WorkerRuntime } from "../src/runtime.ts"
import { seedQueuedJob } from "../tests/fixtures.ts"

const CHECKPOINT = Digest.parse("a".repeat(64))
const RESULT = Digest.parse("b".repeat(64))

class ManualQaError extends Error {
  override readonly name = "ManualQaError"
}

function runtimeForCrash(databasePath: string, privateDataRoot: string): WorkerRuntime {
  const storage = openStorage({ databasePath, privateDataRoot })
  return new WorkerRuntime({
    storage,
    leaseDurationMs: 1000,
    clock: () => new Date("2026-09-21T00:00:00.000Z"),
    tokenFactory: () => "manual-worker-a",
    attemptIdFactory: (reservation) => `manual-attempt-${reservation}`,
    resolveStage: () => ({
      kind: "local",
      execute: ({ saveCheckpoint }) => {
        saveCheckpoint(CHECKPOINT)
        process.exit(17)
      },
    }),
  })
}

async function crashChild(databasePath: string, privateDataRoot: string): Promise<void> {
  await runtimeForCrash(databasePath, privateDataRoot).runNext()
}

async function parent(): Promise<void> {
  const fixture = seedQueuedJob()
  fixture.storage.close()
  try {
    const child = spawnSync(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        "--experimental-transform-types",
        fileURLToPath(import.meta.url),
        "crash-child",
        fixture.databasePath,
        fixture.privateDataRoot,
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    )
    if (child.status !== 17) throw new ManualQaError(`crash child exited ${String(child.status)}`)

    const afterCrashStorage = openStorage({
      databasePath: fixture.databasePath,
      privateDataRoot: fixture.privateDataRoot,
    })
    const afterCrashJob = afterCrashStorage.execution.getJob(fixture.job.id)
    const afterCrashAttempts = afterCrashStorage.execution
      .listAttempts("run-1")
      .map((attempt) => attempt.state)
    afterCrashStorage.close()

    const recoveryStorage = openStorage({
      databasePath: fixture.databasePath,
      privateDataRoot: fixture.privateDataRoot,
    })
    const recovery = new WorkerRuntime({
      storage: recoveryStorage,
      leaseDurationMs: 1000,
      clock: () => new Date("2026-09-21T00:00:02.000Z"),
      tokenFactory: () => "manual-worker-b",
      attemptIdFactory: (reservation) => `manual-attempt-${reservation}`,
      resolveStage: (job) => ({
        kind: "local",
        execute: () => (job.checkpoint === CHECKPOINT ? RESULT : CHECKPOINT),
      }),
    })
    await recovery.runNext()
    const afterRestartJob = recoveryStorage.execution.getJob(fixture.job.id)
    const afterRestartAttempts = recoveryStorage.execution
      .listAttempts("run-1")
      .map((attempt) => attempt.state)
    recoveryStorage.close()

    process.stdout.write(
      `${JSON.stringify({
        afterCrash: {
          jobState: afterCrashJob?.state,
          checkpoint: afterCrashJob?.checkpoint === null ? "absent" : "present",
          attemptStates: afterCrashAttempts,
        },
        afterRestart: {
          jobState: afterRestartJob?.state,
          checkpoint: afterRestartJob?.checkpoint === null ? "absent" : "present",
          attemptStates: afterRestartAttempts,
        },
      })}\n`,
    )
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true })
  }
}

const mode = process.argv[2]
if (mode === "crash-child") {
  const databasePath = process.argv[3]
  const privateDataRoot = process.argv[4]
  if (databasePath === undefined || privateDataRoot === undefined) {
    throw new ManualQaError("child paths are required")
  }
  await crashChild(databasePath, privateDataRoot)
} else {
  await parent()
}
