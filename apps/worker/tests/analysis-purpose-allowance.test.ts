import { type ChildProcess, fork } from "node:child_process"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { validatedBatchedSetupSources } from "@reading-studio/contracts"
import { approveBatchedVerification } from "@reading-studio/generation"
import { openStorage } from "@reading-studio/storage"
import { afterEach, expect, it } from "vitest"
import { analysisPurposeFixture } from "./analysis-purpose-fixture.ts"
import { bookFixtureCapacity } from "./book-map-route-fixture.ts"
import { sharedAnalysisPurposeFixture } from "./shared-analysis-purpose-fixture.ts"

const close: (() => Promise<void>)[] = [],
  children: ChildProcess[] = []
afterEach(async () => {
  for (const child of children.splice(0))
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, "exit")
      child.kill()
      await exit
    }
  for (const action of close.splice(0)) await action()
})
it("refuses W1/B4 at22 without borrowing the old journey's later reserve", async () => {
  const item = await analysisPurposeFixture()
  close.push(item.fixture.close)
  const before = item.fixture.storage.counts()
  const result = approveBatchedVerification(
    { setup: item.setup, normalization: item.normalization, capacity: bookFixtureCapacity },
    validatedBatchedSetupSources(item.setup, item.normalization),
    { maxFindingBatches: 4, cap: 20, used: 0 },
  )
  expect(result).toEqual({ kind: "limited", reason: "attempt-budget-limit" })
  expect(item.fixture.storage.counts()).toEqual(before)
})
it("cannot obtain a fresh20 by changing the purpose authorization or budget ID", async () => {
  const item = await analysisPurposeFixture()
  close.push(item.fixture.close)
  item.runtime().pipeline.prepare(item.setup.id, item.grant.id)
  const now = "2026-10-23T00:00:00.000Z"
  const job = item.fixture.storage.execution.claimNextJob({
    now,
    token: randomUUID(),
    expiresAt: "2026-10-23T01:00:00.000Z",
  })
  if (job?.state !== "running") throw new TypeError("Missing source charge")
  expect(
    item.fixture.storage.execution.reserveAttempt({
      jobId: job.id,
      token: job.lease.token,
      fence: job.lease.fence,
      now,
      preparedAt: now,
      attemptId: "kept-charge",
    }).kind,
  ).toBe("prepared")
  const before = item.fixture.storage.liveStudyBudget.status(item.target.budgetId)
  expect(() =>
    openStorage({
      ...item.options,
      liveStudyTarget: { ...item.target, authorizationId: randomUUID(), budgetId: randomUUID() },
    }),
  ).toThrow()
  expect(item.fixture.storage.liveStudyBudget.status(item.target.budgetId)).toEqual(before)
  expect(before).toMatchObject({ used: 1, remaining: 19, limit: 20 })
  expect(item.fixture.storage.liveStudyGuard.used()).toBe(1)
})
it("retains three prior source attempts and reduces new approved B to2/14 under remaining17", async () => {
  const item = await sharedAnalysisPurposeFixture()
  close.push(item.fixture.close)
  expect(item.fixture.storage.liveStudyBudget.status(item.adoption.id)).toMatchObject({
    used: 3,
    remaining: 17,
    limit: 20,
  })
  expect(item.setup.batchedVerificationReserve).toMatchObject({
    maxFindingBatches: 2,
    maxAnalysisJobs: 7,
    plannedAttempts: 14,
    cap: 17,
    reservedLaterAttempts: 0,
  })
  const { pipeline, worker } = item.runtime()
  let value = pipeline.prepare(item.setup.id, item.grant.id)
  for (let step = 0; step < 10 && value.status !== "successful"; step++) {
    await worker.runNext()
    value = pipeline.prepare(item.setup.id, item.grant.id)
  }
  expect(value.status).toBe("successful")
  expect(item.fixture.storage.liveStudyBudget.status(item.adoption.id)).toMatchObject({
    used: 8,
    remaining: 12,
    limit: 20,
  })
  expect(item.fixture.storage.liveStudyGuard.used()).toBe(5)
})
it("serializes simultaneous reservations without exceeding shared20 or signed/per-run ceilings", async () => {
  const item = await analysisPurposeFixture()
  close.push(item.fixture.close)
  item.runtime().pipeline.prepare(item.setup.id, item.grant.id)
  const now = "2026-10-23T00:00:00.000Z"
  const job = item.fixture.storage.execution.claimNextJob({
    now,
    token: randomUUID(),
    expiresAt: "2026-10-23T01:00:00.000Z",
  })
  if (job?.state !== "running") throw new TypeError("Missing purpose lease")
  const lease = { jobId: job.id, token: job.lease.token, fence: job.lease.fence, now }
  expect(
    item.fixture.storage.execution.reserveAttempt({ ...lease, preparedAt: now, attemptId: "first" })
      .kind,
  ).toBe("prepared")
  const workers = Array.from({ length: 3 }, () =>
    fork(new URL("./whole-book-batch-edge.process.ts", import.meta.url), [], {
      execArgv: ["--experimental-transform-types"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    }),
  )
  children.push(...workers)
  await Promise.all(
    workers.map(async (child, index) => {
      const ready = once(child, "message")
      child.send({
        options: item.options,
        operation: "reserve",
        setupId: item.setup.id,
        grantId: item.grant.id,
        capacity: bookFixtureCapacity,
        target: item.target,
        lease,
        attemptId: `purpose-race-${index}`,
        session: item.fixture.storage.subscriptionLogin.status("installation-1"),
      })
      expect((await ready)[0]).toBe("ready")
    }),
  )
  const outcomes = await Promise.all(
    workers.map(async (child) => {
      const response = once(child, "message"),
        exit = once(child, "exit")
      child.send("go")
      const [value] = await response
      await exit
      return value
    }),
  )
  expect(outcomes.filter((value) => value === "prepared")).toHaveLength(1)
  expect(item.fixture.storage.execution.listAttempts(job.runId)).toHaveLength(2)
  expect(item.fixture.storage.liveStudyGuard.used()).toBe(2)
  expect(item.fixture.storage.liveStudyBudget.status(item.target.budgetId)).toMatchObject({
    used: 2,
    remaining: 18,
    limit: 20,
  })
}, 30000)
