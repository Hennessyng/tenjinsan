import { randomUUID } from "node:crypto"
import type { ProviderReceipt, StructuredRequest } from "@reading-studio/providers"
import { afterEach, expect, it } from "vitest"
import {
  BatchedRuntimeAdapter,
  batchAtVerification,
  batchRuntimeFixture,
} from "./whole-book-batch-runtime-fixture.ts"

const fixtures: Awaited<ReturnType<typeof batchRuntimeFixture>>[] = []
afterEach(async () => {
  for (const item of fixtures.splice(0)) await item.fixture.close()
})
class GenerationRepairAdapter extends BatchedRuntimeAdapter {
  private pending: ProviderReceipt | undefined
  override async dispatch(request: StructuredRequest) {
    if (request.schemaRepair) {
      if (!this.pending) throw new TypeError("Missing authored repair response")
      return this.pending
    }
    const output = await super.dispatch(request)
    this.pending = output
    return { ...output, text: "{}" }
  }
}

it("saturates signed analysis and later-work reserves without borrowing or resetting spent attempts", async () => {
  // Given
  const item = await batchRuntimeFixture(3)
  fixtures.push(item)
  await batchAtVerification(item, new GenerationRepairAdapter())
  const execution = item.fixture.storage.execution,
    now = "2026-10-23T00:00:00.000Z"
  const initialJobs = execution.listSetupJobs(item.setup.id)
  expect(initialJobs).toHaveLength(item.reserve.maxAnalysisJobs)
  expect(initialJobs.flatMap((job) => execution.listAttempts(job.runId))).toHaveLength(6)
  // When
  for (let index = 0; index < 11; index++) {
    const job = execution.claimNextJob({
      token: randomUUID(),
      now,
      expiresAt: "2026-10-23T01:00:00.000Z",
    })
    if (job?.state !== "running") throw new TypeError("Missing verification claim")
    const lease = {
      jobId: job.id,
      token: job.lease.token,
      fence: job.lease.fence,
      now,
      preparedAt: now,
    }
    for (let attempt = 0; attempt < 2; attempt++)
      expect(execution.reserveAttempt({ ...lease, attemptId: randomUUID() }).kind).toBe("prepared")
    expect(execution.reserveAttempt({ ...lease, attemptId: randomUUID() }).kind).toBe(
      "budget-exhausted",
    )
  }
  const template = initialJobs[0]
  if (template?.state !== "completed") throw new TypeError("Missing completed generation template")
  const { resultHash: _resultHash, ...queued } = template
  execution.appendRun({
    id: "signed-later-run",
    inputRevisionId: template.inputRevisionId,
    budget: { maxCalls: 64 },
    reservedCalls: 0,
    state: "running",
  })
  execution.appendJob({
    ...queued,
    id: "signed-later-job",
    runId: "signed-later-run",
    stage: "questions",
    state: "queued",
  })
  const later = execution.claimNextJob({
    token: randomUUID(),
    now,
    expiresAt: "2026-10-23T01:00:00.000Z",
  })
  if (later?.state !== "running") throw new TypeError("Missing later-work claim")
  const lease = {
    jobId: later.id,
    token: later.lease.token,
    fence: later.lease.fence,
    now,
    preparedAt: now,
  }
  for (let attempt = 0; attempt < 12; attempt++)
    expect(execution.reserveAttempt({ ...lease, attemptId: randomUUID() }).kind).toBe("prepared")
  const excess = execution.reserveAttempt({ ...lease, attemptId: randomUUID() })
  // Then
  expect(excess.kind).toBe("budget-exhausted")
  const all = execution.listSetupJobs(item.setup.id)
  const analysis = all
    .filter((job) => job.stage === "analysis")
    .flatMap((job) => execution.listAttempts(job.runId))
  expect(analysis).toHaveLength(item.reserve.maxAnalysisJobs * 2)
  expect(execution.listAttempts(later.runId)).toHaveLength(item.reserve.reservedLaterAttempts)
  expect(all.flatMap((job) => execution.listAttempts(job.runId))).toHaveLength(
    item.reserve.plannedAttempts,
  )
  expect(item.fixture.storage.sources.getSetup(item.setup.id)?.batchedVerificationReserve).toEqual(
    item.reserve,
  )
})
