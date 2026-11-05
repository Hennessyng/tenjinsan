import { type ChildProcess, fork } from "node:child_process"
import { once } from "node:events"
import { LOCAL_CHATGPT_INFERENCE_POLICY, StudySetupRevision } from "@reading-studio/contracts"
import { BookMapPipeline, proposeNormalBatchedDraft } from "@reading-studio/generation"
import { sharedBudgetFixture } from "@reading-studio/storage/test-support"
import { afterEach, expect, it } from "vitest"
import {
  bookFixtureAuthority,
  bookFixtureCapacity,
  closeBookRoute,
} from "./book-map-route-fixture.ts"

const resources: Awaited<ReturnType<typeof given>>[] = []
const children: ChildProcess[] = []
afterEach(async () => {
  for (const child of children.splice(0))
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, "exit")
      child.kill()
      await exit
    }
  for (const item of resources.splice(0)) {
    await closeBookRoute(item.fixture.storage)
    item.fixture.close()
  }
})
async function given() {
  const item = sharedBudgetFixture(),
    { fixture } = item
  fixture.storage.liveStudyBudget.adopt(item.adoption)
  const previous = fixture.storage.sources.getSetup("setup-live")
  const normalization =
    previous && fixture.storage.sources.getNormalization(previous.analysis.normalizationRevisionId)
  if (!previous || !normalization || !previous.analysis.destination)
    throw new TypeError("Missing shared original")
  const authority = bookFixtureAuthority({ storage: fixture.storage, directory: fixture.directory })
  const capacity = { ...bookFixtureCapacity, id: "shared-v4-fixture" }
  const draft = StudySetupRevision.parse({
    ...previous,
    id: "setup-next",
    studyId: "study-next",
    analysis: {
      ...previous.analysis,
      model: capacity.model,
      destination: capacity.destination,
      scope: { ...previous.analysis.scope, kind: "whole-document" },
      analysisPromptVersion: "whole-book-2",
      analysisSchemaVersion: "whole-book-2",
      processing: {
        inferencePolicyVersion: LOCAL_CHATGPT_INFERENCE_POLICY,
        preprocessingVersion: "batched-capacity-4",
        synthesisVersion: "batched-original-check-4",
        capacityId: capacity.id,
      },
    },
  })
  const proposed = await proposeNormalBatchedDraft({
    setup: draft,
    normalization,
    capacity,
    cap: 64,
    used: 0,
  })
  if (proposed.kind !== "ready") throw new TypeError(`Missing shared reserve: ${proposed.reason}`)
  const target = item.prepareNext(proposed.setup)
  fixture.storage.liveStudyBudget.approve({ ownerId: "owner-1", target })
  await closeBookRoute(fixture.storage)
  fixture.reopen(target)
  return { ...item, target, setup: proposed.setup, reserve: proposed.reserve, capacity, authority }
}

it("refuses new pipeline work after consent when current shared allowance is below the signed ceiling", async () => {
  // Given
  const item = await given()
  resources.push(item)
  const [lease] = item.queueNext(1, 2, true)
  if (!lease) throw new TypeError("Missing shared claim")
  const grant = item.fixture.storage.sources.getGrant("grant-next")
  if (!grant) throw new TypeError("Missing prior consent")
  const authority = bookFixtureAuthority(
    { storage: item.fixture.storage, directory: item.fixture.directory },
    item.capacity,
  )
  const before = item.fixture.storage.liveStudyBudget.status(item.adoption.id)
  // When: another charged reservation reduces the currently remaining allowance.
  expect(item.fixture.reserve(lease).kind).toBe("prepared")
  const pipeline = new BookMapPipeline(authority)
  expect(() => pipeline.prepare(item.setup.id, grant.id)).toThrow("attempt-budget-limit")
  // Then
  expect(item.fixture.storage.liveStudyBudget.status(item.adoption.id)).toMatchObject({
    used: before.used + 1,
    remaining: before.remaining - 1,
  })
  expect(item.fixture.storage.execution.listSetupJobs(item.setup.id)).toHaveLength(1)
  expect(item.fixture.storage.sources.getSetup(item.setup.id)?.batchedVerificationReserve).toEqual(
    item.reserve,
  )
})

it("saturates the current shared allowance atomically across independent v4 reservations", async () => {
  // Given
  const item = await given()
  resources.push(item)
  const leases = item.queueNext(9, 2, true)
  expect(leases.length).toBeLessThanOrEqual(item.reserve.maxAnalysisJobs)
  for (const lease of leases.slice(0, 8))
    for (let index = 0; index < 2; index++)
      expect(item.fixture.reserve(lease).kind).toBe("prepared")
  const lease = leases[8]
  if (!lease) throw new TypeError("Missing final shared lease")
  bookFixtureAuthority(
    { storage: item.fixture.storage, directory: item.fixture.directory },
    item.capacity,
  )
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
        options: item.fixture.options,
        operation: "reserve",
        setupId: item.setup.id,
        grantId: "grant-next",
        capacity: item.capacity,
        target: item.target,
        lease,
        attemptId: `v4-shared-${index}`,
        session: item.fixture.storage.subscriptionLogin.status("installation-1"),
      })
      expect((await ready)[0]).toBe("ready")
    }),
  )
  // When
  const outcomes = await Promise.all(
    workers.map(async (worker) => {
      const response = once(worker, "message"),
        exit = once(worker, "exit")
      worker.send("reserve")
      const [value] = await response
      await exit
      return value
    }),
  )
  // Then
  expect(outcomes.filter((value) => value === "prepared")).toHaveLength(1)
  expect(item.fixture.storage.liveStudyBudget.status(item.adoption.id)).toMatchObject({
    used: 20,
    remaining: 0,
  })
  const jobs = item.fixture.storage.execution.listSetupJobs(item.setup.id)
  expect(
    jobs.flatMap((job) => item.fixture.storage.execution.listAttempts(job.runId)),
  ).toHaveLength(17)
  expect(item.fixture.storage.sources.getSetup(item.setup.id)?.batchedVerificationReserve).toEqual(
    item.reserve,
  )
}, 30000)
