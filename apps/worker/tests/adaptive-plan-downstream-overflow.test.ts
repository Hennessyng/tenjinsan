import { StudySetupRevision } from "@reading-studio/contracts"
import { bookMapRequest, storedBookPlan, wholeBookFeasibility } from "@reading-studio/generation"
import { openStorage } from "@reading-studio/storage"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import {
  fixtureCapacity,
  WholeBookAdapter,
  wholeBookFixture,
  wholeBookWorker,
} from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof wholeBookFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it("resumes exact approved ranges without replay and refuses downstream overflow", async () => {
  // Given
  const fixture = await wholeBookFixture("A synthetic argument and its qualification. ".repeat(650))
  fixtures.push(fixture)
  const original = fixture.storage.sources.getSetup("setup-whole")
  const grant = fixture.storage.sources.getGrant("grant-whole")
  const normalization = fixture.storage.sources.getNormalization("normalization-1")
  if (!original || !grant || !normalization) throw new TypeError("Missing synthetic fixture")
  const capacity = { ...fixtureCapacity, id: "synthetic-adaptive-resume", maxRequestBytes: 12_000 }
  let setup = StudySetupRevision.parse({
    ...original,
    id: "setup-adaptive",
    analysis: {
      ...original.analysis,
      processing: { ...original.analysis.processing, capacityId: capacity.id, plan: undefined },
    },
  })
  const planned = await wholeBookFeasibility({ setup, normalization, capacity, cap: 64, used: 0 })
  if (planned.kind !== "ready") throw new TypeError("Expected synthetic adaptive plan")
  setup = StudySetupRevision.parse({
    ...setup,
    analysis: {
      ...setup.analysis,
      processing: { ...setup.analysis.processing, plan: storedBookPlan(planned.windows) },
    },
  })
  fixture.storage.sources.appendSetup({ record: setup, parentRevisionId: original.id })
  fixture.storage.sources.appendGrant({ ...grant, id: "grant-adaptive", setupRevisionId: setup.id })
  const adapter = new WholeBookAdapter()
  const first = wholeBookWorker(fixture, adapter, capacity)
  const initial = first.pipeline.prepare(setup.id, "grant-adaptive")
  const firstJob = fixture.storage.execution.getJob(initial.wholeBook?.parts[0]?.id)
  const firstWindow = planned.windows[0]
  if (!firstJob || !firstWindow) throw new TypeError("Missing synthetic adaptive request")
  const stage = first.pipeline.stage(firstJob)
  expect(stage.wireSchema ?? z.toJSONSchema(stage.schema, { reused: "ref" })).toEqual(
    bookMapRequest(setup, normalization, firstWindow).schema,
  )
  await first.worker.runNext()
  fixture.storage.close()
  fixture.storage = openStorage(fixture)
  // When
  const resumed = wholeBookWorker(fixture, adapter, capacity)
  let analysis = resumed.pipeline.prepare(setup.id, "grant-adaptive")
  for (let step = 0; step < 64 && (await resumed.worker.runNext()).kind !== "idle"; step++)
    analysis = resumed.pipeline.prepare(setup.id, "grant-adaptive")
  // Then
  expect(analysis.status).toBe("partial")
  expect(analysis.wholeBook?.phase).toBe("blocked")
  expect(fixture.storage.workflow.findSuccessfulAnalysis(analysis.cacheKey)).toBeNull()
  expect(analysis.wholeBook?.parts.map((part) => part.ranges)).toEqual(
    setup.analysis.processing?.plan?.map((part) => part.ranges),
  )
  expect(adapter.requests).toHaveLength(planned.windows.length)
  const refused = fixture.storage.execution
    .listSetupJobs(setup.id)
    .find((job) => job.state === "failed")
  expect(refused).toMatchObject({
    state: "failed",
    error: { code: "capacity-limit", retryable: false },
  })
  if (!refused) throw new TypeError("Missing synthetic capacity refusal")
  expect(fixture.storage.execution.listAttempts(refused.runId)).toEqual([])
  expect(fixture.storage.interviews.latest("study-1")).toBeNull()
})
