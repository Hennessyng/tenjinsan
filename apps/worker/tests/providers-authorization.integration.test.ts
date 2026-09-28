import { rmSync } from "node:fs"
import { Job, TransmissionGrant } from "@reading-studio/contracts"
import { ProviderAdapter, ProviderRunner } from "@reading-studio/providers"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { seedQueuedJob } from "./fixtures.ts"
import { protocolOutput, providerWire } from "./providers-wire.ts"

const fixtures: ReturnType<typeof seedQueuedJob>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.storage.close()
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})
for (const scenario of [
  "provider-change",
  "superseded-setup",
  "historical-grant",
  "cancel-before-send",
  "budget-exhausted",
  "budget-policy",
] as const) {
  it(`blocks wire dispatch for ${scenario}`, async () => {
    // Given
    const fixture = seedQueuedJob({
      model: "gpt-4.1-mini",
      maxCalls: scenario === "budget-policy" ? 65 : 1,
      maxSchemaRepairs: 1,
    })
    fixtures.push(fixture)
    const { storage } = fixture
    const claimed = storage.execution.claimNextJob({
      token: "lease",
      now: "2026-01-01T00:00:00Z",
      expiresAt: "2026-01-01T00:10:00Z",
    })
    if (claimed?.state !== "running") throw new TypeError("Expected claim")
    const setup = storage.sources.getSetup(claimed.setupRevisionId)
    if (!setup) throw new TypeError("Expected setup")
    let job = claimed
    switch (scenario) {
      case "provider-change": {
        const altered = Job.parse({ ...claimed, provider: "anthropic", model: "claude-sonnet-4-6" })
        if (altered.state !== "running") throw new TypeError("Expected running job")
        job = altered
        break
      }
      case "superseded-setup":
        storage.sources.appendSetup({
          record: { ...setup, id: "setup-new" },
          parentRevisionId: setup.id,
        })
        break
      case "historical-grant": {
        const grant = TransmissionGrant.parse({
          ...claimed.grant,
          id: "historical-grant",
          kind: "historical",
        })
        storage.sources.appendGrant(grant)
        const altered = Job.parse({ ...claimed, grant: { ...claimed.grant, id: grant.id } })
        if (altered.state !== "running") throw new TypeError("Expected running job")
        job = altered
        break
      }
      case "cancel-before-send":
        storage.execution.requestCancellation({ jobId: job.id })
        break
      case "budget-exhausted": {
        storage.execution.reserveAttempt({
          jobId: job.id,
          token: job.lease.token,
          fence: job.lease.fence,
          now: "2026-01-01T00:00:00Z",
          attemptId: "spent",
          preparedAt: "2026-01-01T00:00:00Z",
        })
        storage.execution.markAttemptDispatching({
          jobId: job.id,
          token: job.lease.token,
          fence: job.lease.fence,
          now: "2026-01-01T00:00:00Z",
          attemptId: "spent",
          dispatchedAt: "2026-01-01T00:00:00Z",
        })
        storage.execution.recordAttemptReceipt({
          jobId: job.id,
          token: job.lease.token,
          fence: job.lease.fence,
          now: "2026-01-01T00:00:00Z",
          attemptId: "spent",
          receivedAt: "2026-01-01T00:00:00Z",
          responseBody: new TextEncoder().encode(
            JSON.stringify({
              kind: "output",
              text: "{}",
              usage: { kind: "known", inputTokens: 1, outputTokens: 1 },
            }),
          ),
          usage: { kind: "known", inputTokens: 1, outputTokens: 1 },
        })
        break
      }
      case "budget-policy":
        break
      default:
        throw new TypeError(`Unhandled scenario ${scenario satisfies never}`)
    }
    const wire = await providerWire([protocolOutput("openai")])
    const runner = new ProviderRunner({
      storage,
      installationId: "installation-1",
      ownerId: "owner-1",
      clock: () => new Date("2026-01-01T00:00:01Z"),
      adapters: {
        openai: new ProviderAdapter({
          provider: "openai",
          apiKey: "fixture",
          baseURL: wire.baseURL,
        }),
        anthropic: new ProviderAdapter({
          provider: "anthropic",
          apiKey: "fixture",
          baseURL: wire.baseURL,
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
      expect(result.state).not.toBe("completed")
      expect(wire.requests).toHaveLength(0)
      if (scenario === "budget-exhausted")
        expect(result).toMatchObject({ state: "paused", reason: "budget-exhausted" })
    } finally {
      await wire.close()
    }
  })
}
