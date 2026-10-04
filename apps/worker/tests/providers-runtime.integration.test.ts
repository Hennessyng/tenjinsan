import { rmSync } from "node:fs"
import { ProviderAdapter, ProviderRunner } from "@reading-studio/providers"
import { expect, it } from "vitest"
import { z } from "zod"
import { WorkerRuntime } from "../src/runtime.ts"
import { seedActiveJob as seedQueuedJob } from "./fixtures.ts"
import { protocolOutput, providerWire } from "./providers-wire.ts"

it("executes a structured provider stage through the persisted worker claim", async () => {
  // Given
  const fixture = seedQueuedJob({ model: "gpt-4.1-mini" })
  const wire = await providerWire([protocolOutput("openrouter")])
  const clock = () => new Date("2026-01-01T00:00:00Z")
  const runner = new ProviderRunner({
    storage: fixture.storage,
    clock,
    installationId: "installation-1",
    ownerId: "owner-1",
    adapters: {
      openrouter: new ProviderAdapter({
        provider: "openrouter",
        apiKey: "fixture",
        baseURL: wire.baseURL,
      }),
    },
  })
  const worker = new WorkerRuntime({
    storage: fixture.storage,
    clock,
    leaseDurationMs: 60000,
    tokenFactory: () => "lease",
    attemptIdFactory: (reservation) => `attempt-${reservation}`,
    resolveStage: () => ({
      kind: "structured",
      runner,
      request: { schema: z.strictObject({ answer: z.string() }), instruction: "fixture" },
    }),
  })
  try {
    // When
    const result = await worker.runNext()
    // Then
    expect(result).toMatchObject({ kind: "provider", job: { state: "completed" } })
    expect(wire.requests).toHaveLength(1)
    expect(fixture.storage.execution.listAttempts(fixture.job.runId)).toHaveLength(1)
  } finally {
    await wire.close()
    fixture.storage.close()
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})
