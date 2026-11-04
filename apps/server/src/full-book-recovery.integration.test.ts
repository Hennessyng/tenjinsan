import { expect, it, vi } from "vitest"
import { z } from "zod"
import { serverRecoveryFixture } from "./testing/full-book-recovery-fixture.ts"

it("shows the appended ceiling, uses the normal owned lifecycle once and cannot resume after the receipt", async () => {
  // Given two charged unknowns, an immutable original consent and no body-installed recovery authority.
  const f = await serverRecoveryFixture()
  const execute = vi.spyOn(f.runtime, "execute")
  try {
    const denied = await f.post(`runs/${f.grant.id}/resume`, { recovery: f.amendment })
    expect(denied.status).toBe(400)
    expect(execute).not.toHaveBeenCalled()
    f.storage.fullBookRecovery.approve(f.amendment)
    f.setMode("unknown")
    // When normal Resume consumes the one-shot, then its state honestly reports both ceilings and the stop barrier.
    const result = await f.post(`runs/${f.grant.id}/resume`, {})
    expect(result.status).toBe(200)
    const state = z
      .object({
        sourceCeiling: z.number(),
        originalSourceCeiling: z.number(),
        usedAttempts: z.number(),
        canResume: z.boolean(),
        canExport: z.boolean(),
        recovery: z.object({ state: z.string(), stopAfterResult: z.boolean() }),
      })
      .parse(await result.json())
    expect(state).toMatchObject({
      sourceCeiling: f.budget.sourceCeiling + 1,
      originalSourceCeiling: f.budget.sourceCeiling,
      usedAttempts: 3,
      canResume: false,
      canExport: false,
      recovery: { state: "consumed", stopAfterResult: true },
    })
    expect(execute).toHaveBeenCalledTimes(1)
    expect((await f.post(`runs/${f.grant.id}/resume`, {})).status).toBe(409)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(f.storage.fullBookExecution.attempts(f.budget.id)).toHaveLength(3)
  } finally {
    execute.mockRestore()
    f.cleanup()
  }
})
