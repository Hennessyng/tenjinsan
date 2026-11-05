import { type ChildProcess, fork } from "node:child_process"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { LocalSubscriptionAdapter, ProviderError } from "@reading-studio/providers"
import { afterEach, expect, it, vi } from "vitest"
import { bookFixtureTurns } from "./book-map-route-fixture.ts"
import {
  BatchedRuntimeAdapter,
  batchAtVerification,
  batchRuntimeFixture,
} from "./whole-book-batch-runtime-fixture.ts"
import { wholeBookWorker } from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof batchRuntimeFixture>>[] = []
const children: ChildProcess[] = []
afterEach(async () => {
  for (const child of children.splice(0))
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, "exit")
      child.kill()
      await exit
    }
  for (const item of fixtures.splice(0)) await item.fixture.close()
})
async function given() {
  const item = await batchRuntimeFixture()
  fixtures.push(item)
  return item
}
const now = "2026-10-23T00:00:00.000Z"
function claim(item: Awaited<ReturnType<typeof given>>) {
  const job = item.fixture.storage.execution.claimNextJob({
    token: randomUUID(),
    now,
    expiresAt: "2026-10-23T01:00:00.000Z",
  })
  if (job?.state !== "running") throw new TypeError("Missing edge lease")
  return { jobId: job.id, token: job.lease.token, fence: job.lease.fence, now }
}
async function race(
  item: Awaited<ReturnType<typeof given>>,
  operation: "prepare" | "reserve",
  lease?: ReturnType<typeof claim>,
) {
  const workers = Array.from({ length: 3 }, () =>
    fork(new URL("./whole-book-batch-edge.process.ts", import.meta.url), [], {
      execArgv: ["--experimental-transform-types"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    }),
  )
  children.push(...workers)
  await Promise.all(
    workers.map(async (worker, index) => {
      const ready = once(worker, "message")
      worker.send({
        options: {
          databasePath: item.fixture.databasePath,
          privateDataRoot: item.fixture.privateDataRoot,
        },
        operation,
        setupId: item.setup.id,
        grantId: item.grant.id,
        capacity: item.execution.capacity,
        lease,
        attemptId: `race-${index}`,
        session: item.fixture.storage.subscriptionLogin.status("installation-1"),
      })
      expect((await ready)[0]).toBe("ready")
    }),
  )
  return Promise.all(
    workers.map(async (worker) => {
      const response = once(worker, "message"),
        exit = once(worker, "exit")
      worker.send("go")
      const [value] = await response
      await exit
      return value
    }),
  )
}

it("materializes one complete immutable matrix across simultaneous independent pipeline admissions", async () => {
  // Given: complete generation, before manifest admission.
  const item = await given(),
    run = wholeBookWorker(item.fixture, new BatchedRuntimeAdapter(), item.execution.capacity)
  let analysis = run.pipeline.prepare(item.setup.id, item.grant.id)
  while (analysis.wholeBook?.phase !== "synthesizing") {
    await run.worker.runNext()
    analysis = run.pipeline.prepare(item.setup.id, item.grant.id)
  }
  await run.worker.runNext()
  // When
  const outcomes = await race(item, "prepare")
  // Then
  const persisted = run.pipeline.prepare(item.setup.id, item.grant.id),
    state = persisted.wholeBook?.batched
  expect(outcomes, JSON.stringify(outcomes)).toEqual(
    Array.from({ length: 3 }, () => ({ phase: "verifying", hash: state?.manifestHash })),
  )
  expect(state?.manifest?.targets.length).toBe(11)
  const jobs = item.fixture.storage.execution.listSetupJobs(item.setup.id)
  expect(jobs).toHaveLength(14)
  expect(new Set(jobs.map((job) => job.id)).size).toBe(14)
  expect(jobs.length).toBeLessThanOrEqual(item.reserve.maxAnalysisJobs)
  expect(item.fixture.storage.sources.getSetup(item.setup.id)?.batchedVerificationReserve).toEqual(
    item.reserve,
  )
})

it("serializes concurrent reservations at the immutable two-attempt job ceiling", async () => {
  // Given
  const item = await given()
  await batchAtVerification(item)
  const lease = claim(item),
    execution = item.fixture.storage.execution
  expect(execution.reserveAttempt({ ...lease, attemptId: "first", preparedAt: now }).kind).toBe(
    "prepared",
  )
  // When
  const results = await race(item, "reserve", lease)
  // Then: one winner, one durable budget pause; a later racer may see that pause.
  expect(results.filter((value) => value === "prepared")).toHaveLength(1)
  expect(results.filter((value) => value === "budget-exhausted")).toHaveLength(1)
  const job = execution.getJob(lease.jobId)
  if (!job) throw new TypeError("Missing reserved job")
  expect(execution.listAttempts(job.runId)).toHaveLength(2)
  expect(execution.getRun(job.runId)?.reservedCalls).toBe(2)
  expect(job.state).toBe("paused")
})

it.each(["retry-approved", "stop-approved"] as const)(
  "keeps unknown spend charged through explicit %s without automatic retry",
  async (resolution) => {
    // Given
    const item = await given(),
      run = await batchAtVerification(item)
    const native = LocalSubscriptionAdapter.prototype.dispatch
    vi.spyOn(LocalSubscriptionAdapter.prototype, "dispatch").mockImplementation(async function (
      this: LocalSubscriptionAdapter,
      request,
    ) {
      await native.call(this, request)
      throw new ProviderError("outcome-unknown")
    })
    await run.worker.runNext()
    const paused = item.fixture.storage.execution
      .listSetupJobs(item.setup.id)
      .find((job) => job.state === "paused")
    if (!paused) throw new TypeError("Missing uncertain job")
    const attempt = item.fixture.storage.execution.listAttempts(paused.runId)[0]
    if (!attempt) throw new TypeError("Missing uncertain attempt")
    const before = bookFixtureTurns(item.fixture).length
    run.pipeline.prepare(item.setup.id, item.grant.id)
    run.pipeline.prepare(item.setup.id, item.grant.id)
    expect(bookFixtureTurns(item.fixture)).toHaveLength(before)
    expect(item.fixture.storage.execution.listAttempts(paused.runId)).toHaveLength(1)
    // When
    item.fixture.storage.execution.resolveUnknownAttempt({ attemptId: attempt.id, resolution })
    item.fixture.storage.execution.resolveUnknownAttempt({ attemptId: attempt.id, resolution })
    // Then
    expect(item.fixture.storage.execution.getRun(paused.runId)?.reservedCalls).toBe(1)
    expect(item.fixture.storage.execution.listAttempts(paused.runId)).toMatchObject([
      { state: "outcome_unknown", resolution },
    ])
    expect(item.fixture.storage.execution.getJob(paused.id)?.state).toBe(
      resolution === "retry-approved" ? "queued" : "cancelled",
    )
    expect(bookFixtureTurns(item.fixture)).toHaveLength(before)
    expect(
      item.fixture.storage.sources.getSetup(item.setup.id)?.batchedVerificationReserve,
    ).toEqual(item.reserve)
    if (resolution === "retry-approved") {
      await run.worker.runNext()
      const attempts = item.fixture.storage.execution.listAttempts(paused.runId)
      const second = attempts[1]
      if (!second) throw new TypeError("Missing explicitly retried unknown attempt")
      expect(attempts).toHaveLength(2)
      expect(second.state).toBe("outcome_unknown")
      expect(bookFixtureTurns(item.fixture)).toHaveLength(before + 1)
      item.fixture.storage.execution.resolveUnknownAttempt({ attemptId: second.id, resolution })
      await run.worker.runNext()
      expect(item.fixture.storage.execution.listAttempts(paused.runId)).toHaveLength(2)
      expect(item.fixture.storage.execution.getRun(paused.runId)?.reservedCalls).toBe(2)
      expect(bookFixtureTurns(item.fixture)).toHaveLength(before + 1)
    }
  },
)
