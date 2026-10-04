import { rmSync } from "node:fs"
import { ExecutionTransitionError, LeaseFenceError, openStorage } from "@reading-studio/storage"
import { afterEach, expect, it } from "vitest"
import { type ExternalProvider, type ProviderDispatch, WorkerRuntime } from "../src/runtime.ts"
import { HASH_A, lease, seedActiveJob as seedQueuedJob } from "./fixtures.ts"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

class AcceptedWithoutReceipt extends Error {
  override readonly name = "AcceptedWithoutReceipt"
}

class VerifierProvider implements ExternalProvider {
  readonly calls: ProviderDispatch[] = []

  constructor(private readonly result: "accepted-crash" | "response") {}

  async dispatch(input: ProviderDispatch) {
    this.calls.push(input)
    if (this.result === "accepted-crash") throw new AcceptedWithoutReceipt()
    return {
      responseBody: new TextEncoder().encode("fixture-response"),
      usage: { kind: "known" as const, inputTokens: 1, outputTokens: 1 },
    }
  }
}

function runtime(input: {
  readonly storage: ReturnType<typeof openStorage>
  readonly now: string
  readonly token: string
  readonly provider: ExternalProvider
}): WorkerRuntime {
  return new WorkerRuntime({
    storage: input.storage,
    leaseDurationMs: 1000,
    clock: () => new Date(input.now),
    tokenFactory: () => input.token,
    attemptIdFactory: (reservation) => `verifier-attempt-${reservation}`,
    resolveStage: () => ({ kind: "external", provider: input.provider, validate: () => HASH_A }),
  })
}

it("rejects the lower artifact write boundary after cancellation", () => {
  const fixture = seedQueuedJob({ stage: "artifact" })
  directories.push(fixture.directory)
  const claimed = fixture.storage.execution.claimNextJob({
    token: "worker-a",
    now: "2026-09-21T00:00:00.000Z",
    expiresAt: "2026-09-21T00:00:10.000Z",
  })
  if (claimed?.state !== "running") throw new TypeError("claim failed")
  const heldLease = lease(
    claimed.id,
    claimed.lease.token,
    claimed.lease.fence,
    "2026-09-21T00:00:01.000Z",
  )
  fixture.storage.execution.requestCancellation({ jobId: claimed.id })
  fixture.storage.execution.cancelClaimedJob(heldLease)

  expect(() =>
    fixture.storage.execution.appendArtifact({ ...heldLease, artifact: fixture.artifact }),
  ).toThrow(LeaseFenceError)
  expect(fixture.storage.execution.getArtifact(fixture.artifact.id)).toBeNull()
  expect(fixture.storage.execution.getJob(claimed.id)?.state).toBe("cancelled")
  fixture.storage.close()
})

it("keeps cancellation terminal when retry approval targets an unknown attempt", async () => {
  const fixture = seedQueuedJob({ maxCalls: 2 })
  directories.push(fixture.directory)
  const accepted = new VerifierProvider("accepted-crash")
  await expect(
    runtime({
      storage: fixture.storage,
      now: "2026-09-21T00:00:00.000Z",
      token: "worker-a",
      provider: accepted,
    }).runNext(),
  ).rejects.toBeInstanceOf(AcceptedWithoutReceipt)
  fixture.storage.close()

  const reopened = openStorage({
    databasePath: fixture.databasePath,
    privateDataRoot: fixture.privateDataRoot,
  })
  const blockedProvider = new VerifierProvider("response")
  expect(
    await runtime({
      storage: reopened,
      now: "2026-09-21T00:00:02.000Z",
      token: "worker-b",
      provider: blockedProvider,
    }).runNext(),
  ).toMatchObject({ kind: "idle" })
  reopened.execution.requestCancellation({ jobId: fixture.job.id })

  expect(() =>
    reopened.execution.resolveUnknownAttempt({
      attemptId: "verifier-attempt-1",
      resolution: "retry-approved",
    }),
  ).toThrow(ExecutionTransitionError)
  expect(
    await runtime({
      storage: reopened,
      now: "2026-09-21T00:00:03.000Z",
      token: "worker-c",
      provider: blockedProvider,
    }).runNext(),
  ).toMatchObject({ kind: "idle" })
  expect(blockedProvider.calls).toHaveLength(0)
  expect(reopened.execution.getJob(fixture.job.id)?.state).toBe("cancelled")
  expect(reopened.execution.getRun("run-1")?.state).toBe("cancelled")
  expect(reopened.execution.getAttempt("verifier-attempt-1")).toMatchObject({
    state: "outcome_unknown",
    resolution: "stop-approved",
  })
  reopened.close()
})
