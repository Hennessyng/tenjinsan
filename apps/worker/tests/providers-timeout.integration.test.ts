import { rmSync } from "node:fs"
import { ProviderAdapter, ProviderRunner } from "@reading-studio/providers"
import { expect, it } from "vitest"
import { z } from "zod"
import { seedActiveJob as seedQueuedJob } from "./fixtures.ts"
import { providerWire } from "./providers-wire.ts"

for (const provider of ["openrouter", "anthropic"] as const) {
  it(`${provider} pauses an accepted request on actual SDK timeout with no retry`, async () => {
    // Given
    const fixture = seedQueuedJob({
      provider,
      model: provider === "openrouter" ? "gpt-4.1-mini" : "claude-sonnet-4-6",
    })
    const wire = await providerWire(["stall"])
    const job = fixture.storage.execution.claimNextJob({
      token: "lease",
      now: "2026-01-01T00:00:00Z",
      expiresAt: "2026-01-01T00:10:00Z",
    })
    if (job?.state !== "running") throw new TypeError("Expected claimed job")
    const runner = new ProviderRunner({
      storage: fixture.storage,
      installationId: "installation-1",
      ownerId: "owner-1",
      clock: () => new Date("2026-01-01T00:00:01Z"),
      adapters: {
        [provider]: new ProviderAdapter({
          provider,
          apiKey: "fixture",
          baseURL: wire.baseURL,
          timeoutMs: 100,
        }),
      },
    })
    try {
      // When
      const result = await runner.execute(job, {
        schema: z.strictObject({ answer: z.string() }),
        instruction: "fixture",
      })
      // Then
      expect(result).toMatchObject({ state: "paused", reason: "outcome_unknown" })
      expect(wire.requests).toHaveLength(1)
      expect(fixture.storage.execution.listAttempts(job.runId)).toMatchObject([
        { state: "outcome_unknown", usage: { kind: "unknown" }, resolution: "awaiting-owner" },
      ])
    } finally {
      await wire.close()
      fixture.storage.close()
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })
}
