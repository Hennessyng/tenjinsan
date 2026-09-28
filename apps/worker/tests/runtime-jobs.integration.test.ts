import { rmSync } from "node:fs"
import {
  MaintenancePausedError,
  openMaintenanceDatabase,
  openStorage,
  withMaintenance,
} from "@reading-studio/storage"
import { afterEach, expect, it } from "vitest"
import {
  type ExternalProvider,
  type ProviderDispatch,
  type ProviderResponse,
  WorkerRuntime,
} from "../src/runtime.ts"
import { HASH_A, HASH_B, lease, seedQueuedJob } from "./fixtures.ts"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

class ProviderAcceptedCrash extends Error {
  override readonly name = "ProviderAcceptedCrash"
}

class ValidationCrash extends Error {
  override readonly name = "ValidationCrash"
}

class LocalStageCrash extends Error {
  override readonly name = "LocalStageCrash"
}

class RecordingProvider implements ExternalProvider {
  readonly calls: ProviderDispatch[] = []

  constructor(private readonly result: "response" | "accepted-crash") {}

  async dispatch(input: ProviderDispatch) {
    this.calls.push(input)
    if (this.result === "accepted-crash") throw new ProviderAcceptedCrash()
    return {
      responseBody: new TextEncoder().encode("fixture-response"),
      usage: { kind: "known" as const, inputTokens: 7, outputTokens: 11 },
    }
  }
}

function externalRuntime(input: {
  readonly storage: ReturnType<typeof openStorage>
  readonly now: string
  readonly token: string
  readonly provider: ExternalProvider
  readonly validate: (responseBody: Uint8Array) => Digest
}): WorkerRuntime {
  return new WorkerRuntime({
    storage: input.storage,
    leaseDurationMs: 1000,
    clock: () => new Date(input.now),
    tokenFactory: () => input.token,
    attemptIdFactory: (reservation) => `attempt-${reservation}`,
    resolveStage: () => ({
      kind: "external",
      provider: input.provider,
      validate: input.validate,
    }),
  })
}

it("pauses a dispatch with no receipt and sends nothing until an explicit counted retry", async () => {
  const fixture = seedQueuedJob({ maxCalls: 2 })
  directories.push(fixture.directory)
  const accepted = new RecordingProvider("accepted-crash")
  const first = externalRuntime({
    storage: fixture.storage,
    now: "2026-09-21T00:00:00.000Z",
    token: "worker-a",
    provider: accepted,
    validate: () => HASH_A,
  })
  await expect(first.runNext()).rejects.toBeInstanceOf(ProviderAcceptedCrash)
  expect(accepted.calls).toHaveLength(1)
  expect(accepted.calls[0]?.maxRetries).toBe(0)
  expect(fixture.storage.execution.listAttempts("run-1")[0]?.state).toBe("dispatching")
  fixture.storage.close()

  const reopened = openStorage({
    databasePath: fixture.databasePath,
    privateDataRoot: fixture.privateDataRoot,
  })
  const recoveryProvider = new RecordingProvider("response")
  const recovery = externalRuntime({
    storage: reopened,
    now: "2026-09-21T00:00:02.000Z",
    token: "worker-b",
    provider: recoveryProvider,
    validate: () => HASH_A,
  })
  expect(await recovery.runNext()).toMatchObject({ kind: "idle" })
  expect(recoveryProvider.calls).toHaveLength(0)
  expect(reopened.execution.getRun("run-1")).toMatchObject({
    reservedCalls: 1,
    state: "paused",
  })
  expect(reopened.execution.listAttempts("run-1")[0]).toMatchObject({
    state: "outcome_unknown",
    resolution: "awaiting-owner",
    usage: { kind: "unknown" },
  })

  reopened.execution.resolveUnknownAttempt({
    attemptId: "attempt-1",
    resolution: "retry-approved",
  })
  const retryProvider = new RecordingProvider("response")
  const retry = externalRuntime({
    storage: reopened,
    now: "2026-09-21T00:00:03.000Z",
    token: "worker-c",
    provider: retryProvider,
    validate: () => HASH_B,
  })
  expect(await retry.runNext()).toMatchObject({ kind: "completed" })
  expect(retryProvider.calls).toHaveLength(1)
  const attempts = reopened.execution.listAttempts("run-1")
  expect(attempts).toHaveLength(2)
  expect(attempts.map((attempt) => attempt.state)).toEqual(["outcome_unknown", "response-received"])
  expect(attempts[0]).toMatchObject({ resolution: "retry-approved" })
  expect(reopened.execution.getRun("run-1")?.reservedCalls).toBe(2)
  expect(reopened.execution.getJob(fixture.job.id)).toMatchObject({
    state: "completed",
    resultHash: HASH_B,
  })
  reopened.close()
})

it("resumes a prepared attempt after restart without spending another budget slot", async () => {
  const fixture = seedQueuedJob({ maxCalls: 2 })
  directories.push(fixture.directory)
  const claimed = fixture.storage.execution.claimNextJob({
    token: "worker-a",
    now: "2026-09-21T00:00:00.000Z",
    expiresAt: "2026-09-21T00:00:01.000Z",
  })
  if (claimed?.state !== "running") throw new TypeError("claim failed")
  fixture.storage.execution.reserveAttempt({
    ...lease(claimed.id, claimed.lease.token, claimed.lease.fence, "2026-09-21T00:00:00.500Z"),
    attemptId: "attempt-1",
    preparedAt: "2026-09-21T00:00:00.500Z",
  })
  fixture.storage.close()

  const reopened = openStorage({
    databasePath: fixture.databasePath,
    privateDataRoot: fixture.privateDataRoot,
  })
  const provider = new RecordingProvider("response")
  const runtime = externalRuntime({
    storage: reopened,
    now: "2026-09-21T00:00:02.000Z",
    token: "worker-b",
    provider,
    validate: () => HASH_A,
  })
  expect(await runtime.runNext()).toMatchObject({ kind: "completed" })
  expect(provider.calls).toHaveLength(1)
  expect(reopened.execution.getRun("run-1")?.reservedCalls).toBe(1)
  expect(reopened.execution.listAttempts("run-1")).toHaveLength(1)
  reopened.close()
})

it("does not claim or dispatch a paid attempt while another process drains the library", async () => {
  const fixture = seedQueuedJob({ maxCalls: 2 })
  directories.push(fixture.directory)
  const sqlite = openMaintenanceDatabase(fixture.databasePath)
  sqlite
    .prepare("UPDATE maintenance_gate SET phase = 'draining', token = 'operator' WHERE id = 1")
    .run()
  const provider = new RecordingProvider("response")
  const runtime = externalRuntime({
    storage: fixture.storage,
    now: "2026-09-21T00:00:00.000Z",
    token: "worker-a",
    provider,
    validate: () => HASH_A,
  })
  expect(await runtime.runNext()).toMatchObject({ kind: "idle" })
  expect(provider.calls).toHaveLength(0)
  expect(fixture.storage.execution.getJob(fixture.job.id)?.state).toBe("queued")
  sqlite.prepare("UPDATE maintenance_gate SET phase = 'idle', token = NULL WHERE id = 1").run()
  const claimed = fixture.storage.execution.claimNextJob({
    token: "worker-b",
    now: "2026-09-21T00:00:00.000Z",
    expiresAt: "2026-09-21T00:00:01.000Z",
  })
  if (claimed?.state !== "running") throw new TypeError("claim failed")
  fixture.storage.execution.reserveAttempt({
    ...lease(claimed.id, claimed.lease.token, claimed.lease.fence, "2026-09-21T00:00:00.500Z"),
    attemptId: "attempt-1",
    preparedAt: "2026-09-21T00:00:00.500Z",
  })
  sqlite
    .prepare("UPDATE maintenance_gate SET phase = 'draining', token = 'operator' WHERE id = 1")
    .run()
  expect(() =>
    fixture.storage.execution.markAttemptDispatching({
      ...lease(claimed.id, claimed.lease.token, claimed.lease.fence, "2026-09-21T00:00:00.500Z"),
      attemptId: "attempt-1",
      dispatchedAt: "2026-09-21T00:00:00.500Z",
    }),
  ).toThrow(MaintenancePausedError)
  fixture.storage.execution.releaseForMaintenance(
    lease(claimed.id, claimed.lease.token, claimed.lease.fence, "2026-09-21T00:00:00.500Z"),
  )
  expect(fixture.storage.execution.listAttempts("run-1")[0]?.state).toBe("prepared")
  sqlite.close()
  fixture.storage.close()
})

it("waits for an accepted provider call to persist its receipt before freezing writes", async () => {
  const fixture = seedQueuedJob({ maxCalls: 2 })
  directories.push(fixture.directory)
  let accepted: () => void = () => {
    throw new TypeError("Provider did not start")
  }
  const started = new Promise<void>((resolve) => {
    accepted = resolve
  })
  let release: (value: ProviderResponse) => void = () => {
    throw new TypeError("Provider was not held")
  }
  const receipt = new Promise<ProviderResponse>((resolve) => {
    release = resolve
  })
  const provider: ExternalProvider = {
    dispatch: async () => {
      accepted()
      return receipt
    },
  }
  const runtime = new WorkerRuntime({
    storage: fixture.storage,
    leaseDurationMs: 120_000,
    clock: () => new Date(),
    tokenFactory: () => "worker-a",
    attemptIdFactory: () => "attempt-1",
    resolveStage: () => ({ kind: "external", provider, validate: () => HASH_A }),
  })
  const run = runtime.runNext()
  await started
  const sqlite = openMaintenanceDatabase(fixture.databasePath)
  expect(() => withMaintenance(sqlite, () => "unsafe", 100)).toThrow(/timed out/)
  release({
    responseBody: new TextEncoder().encode("fixture-response"),
    usage: { kind: "known", inputTokens: 1, outputTokens: 1 },
  })
  expect(await run).toMatchObject({ kind: "completed" })
  expect(fixture.storage.execution.listAttempts("run-1")[0]?.state).toBe("response-received")
  expect(withMaintenance(sqlite, () => "drained", 100)).toBe("drained")
  sqlite.close()
  fixture.storage.close()
})

it("resumes local validation from a durable response receipt without redelivery", async () => {
  const fixture = seedQueuedJob({ maxCalls: 1 })
  directories.push(fixture.directory)
  const provider = new RecordingProvider("response")
  const first = externalRuntime({
    storage: fixture.storage,
    now: "2026-09-21T00:00:00.000Z",
    token: "worker-a",
    provider,
    validate: () => {
      throw new ValidationCrash()
    },
  })
  await expect(first.runNext()).rejects.toBeInstanceOf(ValidationCrash)
  expect(provider.calls).toHaveLength(1)
  expect(fixture.storage.execution.listAttempts("run-1")[0]?.state).toBe("response-received")
  fixture.storage.close()

  const reopened = openStorage({
    databasePath: fixture.databasePath,
    privateDataRoot: fixture.privateDataRoot,
  })
  const noRedelivery = new RecordingProvider("response")
  const recovery = externalRuntime({
    storage: reopened,
    now: "2026-09-21T00:00:02.000Z",
    token: "worker-b",
    provider: noRedelivery,
    validate: (responseBody) => (responseBody.byteLength > 0 ? HASH_A : HASH_B),
  })
  expect(await recovery.runNext()).toMatchObject({ kind: "completed" })
  expect(noRedelivery.calls).toHaveLength(0)
  expect(reopened.execution.getJob(fixture.job.id)?.state).toBe("completed")
  reopened.close()
})

it("observes cancellation after local work and refuses to commit the result", async () => {
  const fixture = seedQueuedJob()
  directories.push(fixture.directory)
  const runtime = new WorkerRuntime({
    storage: fixture.storage,
    leaseDurationMs: 1000,
    clock: () => new Date("2026-09-21T00:00:00.000Z"),
    tokenFactory: () => "worker-a",
    attemptIdFactory: (reservation) => `attempt-${reservation}`,
    resolveStage: (job) => ({
      kind: "local",
      execute: () => {
        fixture.storage.execution.requestCancellation({ jobId: job.id })
        return HASH_A
      },
    }),
  })
  expect(await runtime.runNext()).toMatchObject({ kind: "cancelled" })
  expect(fixture.storage.execution.getJob(fixture.job.id)?.state).toBe("cancelled")
  fixture.storage.close()
})

it("restarts a crashed local stage from its durable checkpoint", async () => {
  const fixture = seedQueuedJob()
  directories.push(fixture.directory)
  const first = new WorkerRuntime({
    storage: fixture.storage,
    leaseDurationMs: 1000,
    clock: () => new Date("2026-09-21T00:00:00.000Z"),
    tokenFactory: () => "worker-a",
    attemptIdFactory: (reservation) => `attempt-${reservation}`,
    resolveStage: () => ({
      kind: "local",
      execute: ({ saveCheckpoint }) => {
        saveCheckpoint(HASH_A)
        throw new LocalStageCrash()
      },
    }),
  })
  await expect(first.runNext()).rejects.toBeInstanceOf(LocalStageCrash)
  fixture.storage.close()

  const reopened = openStorage({
    databasePath: fixture.databasePath,
    privateDataRoot: fixture.privateDataRoot,
  })
  const recovery = new WorkerRuntime({
    storage: reopened,
    leaseDurationMs: 1000,
    clock: () => new Date("2026-09-21T00:00:02.000Z"),
    tokenFactory: () => "worker-b",
    attemptIdFactory: (reservation) => `attempt-${reservation}`,
    resolveStage: (job) => ({
      kind: "local",
      execute: () => (job.checkpoint === HASH_A ? HASH_B : HASH_A),
    }),
  })
  expect(await recovery.runNext()).toMatchObject({
    kind: "completed",
    job: { checkpoint: HASH_A, resultHash: HASH_B },
  })
  reopened.close()
})

import type { Digest } from "@reading-studio/contracts"
