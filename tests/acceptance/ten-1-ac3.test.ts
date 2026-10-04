import { rmSync } from "node:fs"
import { expect, it, vi } from "vitest"
import { z } from "zod"
import { projectOwnerJobs } from "../../apps/server/src/job-projection.ts"
import { seedQueuedJob } from "../../apps/worker/tests/fixtures.ts"
import { ProviderRunner } from "../../packages/providers/src/runner.ts"

it.each(["rejected", "rate-limited", "unavailable", "oversized"] as const)(
  "pauses %s with a safe trace and never automatically replays",
  async (failure) => {
    const fixture = seedQueuedJob({ provider: "anthropic", model: "claude-sonnet-4-6" })
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined)
    let calls = 0
    try {
      const claim = fixture.storage.execution.claimNextJob({
        token: "acceptance",
        now: "2026-01-01T00:00:00Z",
        expiresAt: "2026-01-01T00:10:00Z",
      })
      if (claim?.state !== "running") throw new TypeError("Expected running fixture")
      const runner = new ProviderRunner({
        storage: fixture.storage,
        ownerId: "owner-1",
        installationId: "installation-1",
        clock: () => new Date("2026-01-01T00:00:01Z"),
        adapters: {
          anthropic: {
            dispatch: async () => {
              calls++
              return failure === "oversized"
                ? {
                    kind: "output",
                    text: '{"answer":"ok"}',
                    usage: { kind: "known", inputTokens: 10, outputTokens: 6001 },
                  }
                : { kind: "error", code: failure, usage: { kind: "unknown" } }
            },
          },
        },
      })
      const result = await runner.execute(claim, {
        instruction: "Synthetic fixture",
        schema: z.object({ answer: z.string() }),
      })
      expect(result.state).toBe("paused")
      const view = projectOwnerJobs(fixture.storage, "owner-1").jobs[0]
      expect(view).toMatchObject({
        state: "paused",
        canRetry: false,
        trace_id: expect.any(String),
        explanation: expect.any(String),
      })
      expect(JSON.stringify(log.mock.calls)).toContain(view?.trace_id)
      expect(
        fixture.storage.execution.claimNextJob({
          token: "again",
          now: "2026-01-01T00:20:00Z",
          expiresAt: "2026-01-01T00:30:00Z",
        }),
      ).toBeNull()
      expect(calls).toBe(1)
    } finally {
      log.mockRestore()
      fixture.storage.close()
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  },
)
