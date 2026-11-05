import { afterEach, expect, it, vi } from "vitest"
import { runManagedProduction, useManagedBookReplies } from "./managed-startup-fixture.ts"
import { managedWorkflowFixture } from "./managed-workflow-fixture.ts"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it.each(["missing", "foreign-model"] as const)(
  "refuses %s worker capacity without a provider attempt",
  async (fault) => {
    // Given
    const flow = await managedWorkflowFixture({ serverCapacity: true })
    try {
      expect(flow.sent.status).toBe(200)
      useManagedBookReplies(flow)
      // When
      await runManagedProduction(flow, {
        processEntry: true,
        ...(fault === "foreign-model"
          ? { capacity: { ...flow.capacity, model: "foreign-model" } }
          : {}),
      })
      // Then
      expect(flow.storage.execution.listSetupJobs(flow.setupId)[0]).toMatchObject({
        state: "failed",
        error: { code: "capacity-unknown", retryable: false },
      })
      expect(flow.storage.counts().attempts).toBe(0)
      expect(await flow.requests()).toHaveLength(0)
      expect(flow.storage.interviews.latest(flow.studyId)).toBeNull()
      expect(flow.network).not.toHaveBeenCalled()
    } finally {
      await flow.close()
    }
  },
)
