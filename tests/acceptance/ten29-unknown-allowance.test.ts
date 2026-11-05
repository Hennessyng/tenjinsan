import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import {
  managedProviderFixture,
  providerStage,
} from "../../apps/worker/tests/managed-provider-fixture.ts"
import { evidenceDirectory } from "./ten29/evidence.ts"
import { prepareManagedRoute } from "./ten29/portable-fixtures.ts"

const fixtures: Awaited<ReturnType<typeof managedProviderFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it("preserves an actual interrupted native outcome and refuses an approved retry beyond current allowance", async () => {
  // Given
  const flow = await managedProviderFixture({ maxCalls: 1, maxSchemaRepairs: 0 })
  fixtures.push(flow)
  prepareManagedRoute()
  const job = flow.claim()
  await flow.respond({ answer: "partial terminal-looking item", fixtureTransport: "incomplete" })
  // When
  const unknown = await flow.runner.execute(job, providerStage)
  const before = flow.storage.execution.listAttempts(job.runId)
  const attempt = before[0]
  if (!attempt) throw new TypeError("Missing actually dispatched unknown attempt")
  const idle = await flow.worker.runNext()
  flow.storage.execution.resolveUnknownAttempt({
    attemptId: attempt.id,
    resolution: "retry-approved",
  })
  const retry = await flow.worker.runNext()
  const after = flow.storage.execution.listAttempts(job.runId)
  const run = flow.storage.execution.getRun(job.runId)
  const requests = await flow.requests()
  const evidence = await evidenceDirectory("safety-unknown")
  await writeFile(
    join(evidence, "result.json"),
    JSON.stringify(
      {
        unknown,
        before,
        idle,
        retry,
        after,
        run,
        requests,
        persisted: flow.storage.execution.getJob(job.id),
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  )
  // Then
  expect(unknown).toMatchObject({
    state: "paused",
    reason: "outcome_unknown",
    usage: { kind: "unknown" },
  })
  expect(before).toMatchObject([
    { state: "outcome_unknown", resolution: "awaiting-owner", usage: { kind: "unknown" } },
  ])
  expect(flow.storage.execution.getAttemptReceipt(attempt.id)).toBeNull()
  expect(idle.kind).toBe("idle")
  expect(retry).toMatchObject({
    kind: "provider",
    job: { state: "paused", reason: "budget-exhausted", usage: { kind: "unknown" } },
  })
  expect(after).toMatchObject([
    {
      id: attempt.id,
      state: "outcome_unknown",
      resolution: "retry-approved",
      usage: { kind: "unknown" },
    },
  ])
  expect(run).toMatchObject({ reservedCalls: 1, state: "paused", budget: { maxCalls: 1 } })
  expect(requests).toHaveLength(1)
  expect(flow.network).not.toHaveBeenCalled()
  expect(flow.login).not.toHaveBeenCalled()
})
