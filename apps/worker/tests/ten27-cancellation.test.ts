import { afterEach, expect, it, vi } from "vitest"
import { managedProviderFixture, providerStage } from "./managed-provider-fixture.ts"

const fixtures: Awaited<ReturnType<typeof managedProviderFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it.each(["initial", "repair"] as const)(
  "honors cancellation during %s request sizing without another dispatch",
  async (phase) => {
    // Given
    const fixture = await managedProviderFixture({ maxCalls: 2, maxSchemaRepairs: 1 })
    fixtures.push(fixture)
    const job = fixture.claim()
    const measure = fixture.adapter.measure.bind(fixture.adapter)
    const dispatch = vi.spyOn(fixture.adapter, "dispatch")
    vi.spyOn(fixture.adapter, "measure").mockImplementation(async (request) => {
      const bytes = await measure(request)
      if (phase === "initial" || request.schemaRepair)
        fixture.storage.execution.requestCancellation({ jobId: job.id })
      return bytes
    })
    await fixture.respond("not-json")
    // When
    const result = await fixture.runner.execute(job, providerStage)
    // Then
    expect(result.state).toBe("cancelled")
    expect(dispatch).toHaveBeenCalledTimes(phase === "initial" ? 0 : 1)
    expect(await fixture.requests()).toHaveLength(phase === "initial" ? 0 : 1)
    expect(fixture.storage.execution.listAttempts(job.runId)).toHaveLength(
      phase === "initial" ? 0 : 1,
    )
    expect(fixture.storage.execution.getRun(job.runId)?.reservedCalls).toBe(
      phase === "initial" ? 0 : 1,
    )
    expect(fixture.network).not.toHaveBeenCalled()
    expect(fixture.login).not.toHaveBeenCalled()
  },
)
