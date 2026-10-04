import { rmSync } from "node:fs"
import { openMaintenanceDatabase, withMaintenance } from "@reading-studio/storage"
import { expect, it } from "vitest"
import { WorkerRuntime } from "../src/runtime.ts"
import { HASH_A, seedActiveJob as seedQueuedJob } from "./fixtures.ts"

it("keeps a stopped unknown call admitted until the provider actually returns", async () => {
  const fixture = seedQueuedJob({ maxCalls: 1 })
  const sqlite = openMaintenanceDatabase(fixture.databasePath)
  let accepted: () => void = () => {
    throw new TypeError("Provider not started")
  }
  const started = new Promise<void>((resolve) => {
    accepted = resolve
  })
  let fail: (error: Error) => void = () => {
    throw new TypeError("Provider not held")
  }
  const held = new Promise<never>((_, reject) => {
    fail = reject
  })
  let claim:
    | { readonly id: string; readonly lease: { readonly token: string; readonly fence: number } }
    | undefined
  const runtime = new WorkerRuntime({
    storage: fixture.storage,
    leaseDurationMs: 120_000,
    clock: () => new Date(),
    tokenFactory: () => "worker-a",
    attemptIdFactory: () => "attempt-1",
    resolveStage: () => ({
      kind: "external",
      provider: {
        dispatch: async ({ job }) => {
          claim = job
          accepted()
          return held
        },
      },
      validate: () => HASH_A,
    }),
  })
  try {
    const running = runtime.runNext()
    await started
    if (!claim) throw new TypeError("Provider claim missing")
    fixture.storage.execution.requestCancellation({ jobId: claim.id })
    fixture.storage.execution.cancelClaimedJob({
      jobId: claim.id,
      token: claim.lease.token,
      fence: claim.lease.fence,
      now: new Date().toISOString(),
    })
    expect(fixture.storage.execution.listAttempts("run-1")[0]).toMatchObject({
      state: "outcome_unknown",
      resolution: "stop-approved",
    })
    expect(() => withMaintenance(sqlite, () => "unsafe", 100)).toThrow(/drain timed out/)
    fail(new TypeError("Provider returned without a receipt"))
    await expect(running).rejects.toThrow("Provider returned without a receipt")
    expect(withMaintenance(sqlite, () => "safe", 100)).toBe("safe")
  } finally {
    sqlite.close()
    fixture.storage.close()
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})
