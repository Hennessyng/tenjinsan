import { rmSync } from "node:fs"
import { LeaseFenceError, openStorage } from "@reading-studio/storage"
import { afterEach, expect, it } from "vitest"
import { HASH_A, HASH_B, HASH_C, lease, seedActiveJob as seedQueuedJob } from "./fixtures.ts"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

it("fences an expired worker from committing an artifact after a newer lease is claimed", () => {
  const fixture = seedQueuedJob({ stage: "artifact" })
  directories.push(fixture.directory)
  const first = fixture.storage.execution.claimNextJob({
    token: "worker-a",
    now: "2026-09-21T00:00:00.000Z",
    expiresAt: "2026-09-21T00:00:01.000Z",
  })
  const second = fixture.storage.execution.claimNextJob({
    token: "worker-b",
    now: "2026-09-21T00:00:02.000Z",
    expiresAt: "2026-09-21T00:00:03.000Z",
  })
  expect(first?.state).toBe("running")
  expect(second?.state).toBe("running")
  if (first?.state !== "running" || second?.state !== "running") throw new TypeError("claim failed")
  expect(second.lease.fence).toBe(first.lease.fence + 1)

  expect(() =>
    fixture.storage.execution.commitArtifact({
      ...lease(first.id, first.lease.token, first.lease.fence, "2026-09-21T00:00:02.000Z"),
      artifact: fixture.artifact,
    }),
  ).toThrow(LeaseFenceError)
  expect(fixture.storage.execution.getArtifact(fixture.artifact.id)).toBeNull()

  fixture.storage.execution.commitArtifact({
    ...lease(second.id, second.lease.token, second.lease.fence, "2026-09-21T00:00:02.500Z"),
    artifact: fixture.artifact,
  })
  expect(fixture.storage.execution.getArtifact(fixture.artifact.id)?.contentHash).toBe(HASH_C)
  expect(fixture.storage.execution.getJob(second.id)?.state).toBe("completed")
  fixture.storage.close()
})

it("persists a checkpoint across close and reclaims the expired local stage", () => {
  const fixture = seedQueuedJob()
  directories.push(fixture.directory)
  const claimed = fixture.storage.execution.claimNextJob({
    token: "worker-a",
    now: "2026-09-21T00:00:00.000Z",
    expiresAt: "2026-09-21T00:00:01.000Z",
  })
  if (claimed?.state !== "running") throw new TypeError("claim failed")
  fixture.storage.execution.saveCheckpoint({
    ...lease(claimed.id, claimed.lease.token, claimed.lease.fence, "2026-09-21T00:00:00.500Z"),
    checkpoint: HASH_A,
  })
  fixture.storage.close()

  const reopened = openStorage({
    databasePath: fixture.databasePath,
    privateDataRoot: fixture.privateDataRoot,
  })
  const resumed = reopened.execution.claimNextJob({
    token: "worker-b",
    now: "2026-09-21T00:00:02.000Z",
    expiresAt: "2026-09-21T00:00:03.000Z",
  })
  expect(resumed?.checkpoint).toBe(HASH_A)
  if (resumed?.state !== "running") throw new TypeError("resume failed")
  reopened.execution.completeJob({
    ...lease(resumed.id, resumed.lease.token, resumed.lease.fence, "2026-09-21T00:00:02.500Z"),
    resultHash: HASH_B,
  })
  expect(reopened.execution.getJob(resumed.id)).toMatchObject({
    state: "completed",
    checkpoint: HASH_A,
    resultHash: HASH_B,
  })
  reopened.close()
})

it("persists heartbeats and refuses another claim until the extended lease expires", () => {
  const fixture = seedQueuedJob()
  directories.push(fixture.directory)
  const claimed = fixture.storage.execution.claimNextJob({
    token: "worker-a",
    now: "2026-09-21T00:00:00.000Z",
    expiresAt: "2026-09-21T00:00:01.000Z",
  })
  if (claimed?.state !== "running") throw new TypeError("claim failed")
  const heartbeat = fixture.storage.execution.heartbeatJob({
    ...lease(claimed.id, claimed.lease.token, claimed.lease.fence, "2026-09-21T00:00:00.500Z"),
    expiresAt: "2026-09-21T00:00:03.000Z",
  })
  expect(heartbeat).toMatchObject({
    state: "running",
    lease: {
      heartbeatAt: "2026-09-21T00:00:00.500Z",
      expiresAt: "2026-09-21T00:00:03.000Z",
    },
  })
  expect(
    fixture.storage.execution.claimNextJob({
      token: "worker-b",
      now: "2026-09-21T00:00:02.000Z",
      expiresAt: "2026-09-21T00:00:04.000Z",
    }),
  ).toBeNull()
  expect(
    fixture.storage.execution.claimNextJob({
      token: "worker-b",
      now: "2026-09-21T00:00:04.000Z",
      expiresAt: "2026-09-21T00:00:05.000Z",
    }),
  ).toMatchObject({ state: "running", lease: { token: "worker-b", fence: 2 } })
  fixture.storage.close()
})

it("cooperatively cancels a claimed job without allowing its result to commit", () => {
  const fixture = seedQueuedJob()
  directories.push(fixture.directory)
  const claimed = fixture.storage.execution.claimNextJob({
    token: "worker-a",
    now: "2026-09-21T00:00:00.000Z",
    expiresAt: "2026-09-21T00:00:10.000Z",
  })
  if (claimed?.state !== "running") throw new TypeError("claim failed")
  fixture.storage.execution.requestCancellation({ jobId: claimed.id })
  fixture.storage.execution.cancelClaimedJob(
    lease(claimed.id, claimed.lease.token, claimed.lease.fence, "2026-09-21T00:00:01.000Z"),
  )
  expect(fixture.storage.execution.getJob(claimed.id)?.state).toBe("cancelled")
  expect(() =>
    fixture.storage.execution.completeJob({
      ...lease(claimed.id, claimed.lease.token, claimed.lease.fence, "2026-09-21T00:00:02.000Z"),
      resultHash: HASH_B,
    }),
  ).toThrow(LeaseFenceError)
  expect(fixture.storage.execution.getRun("run-1")?.state).toBe("cancelled")
  fixture.storage.close()
})

it("reserves the durable run budget atomically and pauses when it is exhausted", () => {
  const fixture = seedQueuedJob({ maxCalls: 1 })
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
  expect(
    fixture.storage.execution.reserveAttempt({
      ...heldLease,
      attemptId: "attempt-budget-1",
      preparedAt: heldLease.now,
    }).kind,
  ).toBe("prepared")
  fixture.storage.execution.markAttemptDispatching({
    ...heldLease,
    attemptId: "attempt-budget-1",
    dispatchedAt: "2026-09-21T00:00:02.000Z",
  })
  fixture.storage.execution.recordAttemptReceipt({
    ...heldLease,
    attemptId: "attempt-budget-1",
    receivedAt: "2026-09-21T00:00:03.000Z",
    responseBody: new TextEncoder().encode("fixture-response"),
    usage: { kind: "known", inputTokens: 3, outputTokens: 5 },
  })
  expect(
    fixture.storage.execution.reserveAttempt({
      ...heldLease,
      attemptId: "attempt-budget-2",
      preparedAt: "2026-09-21T00:00:04.000Z",
    }).kind,
  ).toBe("budget-exhausted")
  expect(fixture.storage.execution.getRun("run-1")).toMatchObject({
    reservedCalls: 1,
    state: "paused",
  })
  expect(fixture.storage.execution.listAttempts("run-1")).toHaveLength(1)
  expect(fixture.storage.execution.getJob(claimed.id)).toMatchObject({
    state: "paused",
    reason: "budget-exhausted",
  })
  fixture.storage.close()
})

it("records an interrupted dispatched attempt as stopped when cancellation wins recovery", () => {
  const fixture = seedQueuedJob()
  directories.push(fixture.directory)
  const claimed = fixture.storage.execution.claimNextJob({
    token: "worker-a",
    now: "2026-09-21T00:00:00.000Z",
    expiresAt: "2026-09-21T00:00:01.000Z",
  })
  if (claimed?.state !== "running") throw new TypeError("claim failed")
  const heldLease = lease(
    claimed.id,
    claimed.lease.token,
    claimed.lease.fence,
    "2026-09-21T00:00:00.500Z",
  )
  fixture.storage.execution.reserveAttempt({
    ...heldLease,
    attemptId: "attempt-cancelled-dispatch",
    preparedAt: heldLease.now,
  })
  fixture.storage.execution.markAttemptDispatching({
    ...heldLease,
    attemptId: "attempt-cancelled-dispatch",
    dispatchedAt: heldLease.now,
  })
  fixture.storage.execution.requestCancellation({ jobId: claimed.id })

  expect(
    fixture.storage.execution.claimNextJob({
      token: "worker-b",
      now: "2026-09-21T00:00:02.000Z",
      expiresAt: "2026-09-21T00:00:03.000Z",
    }),
  ).toBeNull()
  expect(fixture.storage.execution.getJob(claimed.id)?.state).toBe("cancelled")
  expect(fixture.storage.execution.getRun(claimed.runId)?.state).toBe("cancelled")
  expect(fixture.storage.execution.getAttempt("attempt-cancelled-dispatch")).toMatchObject({
    state: "outcome_unknown",
    resolution: "stop-approved",
    usage: { kind: "unknown" },
  })
  fixture.storage.close()
})
