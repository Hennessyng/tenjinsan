import { rmSync } from "node:fs"
import { ProviderAdapter, ProviderRunner } from "@reading-studio/providers"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { seedActiveJob as seedQueuedJob } from "./fixtures.ts"
import { protocolOutput, providerWire } from "./providers-wire.ts"

const fixtures: ReturnType<typeof seedQueuedJob>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.storage.close()
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})
function fixture(provider: "openrouter" | "anthropic" = "openrouter") {
  const result = seedQueuedJob({
    provider,
    model: provider === "openrouter" ? "gpt-4.1-mini" : "claude-sonnet-4-6",
    maxSchemaRepairs: 1,
    maxTransientRetries: 1,
    maxCalls: 3,
  })
  fixtures.push(result)
  const job = result.storage.execution.claimNextJob({
    token: "provider-test",
    now: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:10:00.000Z",
  })
  if (job?.state !== "running") throw new TypeError("Expected running fixture")
  return { ...result, job }
}
it("refuses an installation mismatch before reserving or sending", async () => {
  // Given
  const { storage, job } = fixture()
  const runner = new ProviderRunner({
    storage,
    installationId: "another-installation",
    ownerId: "owner-1",
    clock: () => new Date("2026-01-01T00:00:01Z"),
    adapters: {},
  })
  // When
  const result = await runner.execute(job, {
    schema: z.strictObject({ answer: z.string() }),
    instruction: "fixture",
  })
  // Then
  expect(result).toMatchObject({ state: "failed", error: { code: "unauthorized" } })
  expect(storage.execution.listAttempts(job.runId)).toEqual([])
})

for (const provider of ["openrouter", "anthropic"] as const) {
  it(`${provider} repairs malformed output through exactly two persisted dispatched attempts`, async () => {
    // Given
    const { storage, job } = fixture(provider)
    const wire = await providerWire([
      protocolOutput(provider, "not-json"),
      protocolOutput(provider),
    ])
    const runner = new ProviderRunner({
      storage,
      installationId: "installation-1",
      ownerId: "owner-1",
      clock: () => new Date("2026-01-01T00:00:01Z"),
      adapters: {
        [provider]: new ProviderAdapter({ provider, apiKey: "fixture", baseURL: wire.baseURL }),
      },
    })
    try {
      // When
      const result = await runner.execute(job, {
        schema: z.strictObject({ answer: z.string() }),
        instruction: "fixture",
      })
      // Then
      expect(result.state).toBe("completed")
      expect(result.usage).toEqual({ kind: "known", inputTokens: 16, outputTokens: 8 })
      expect(wire.requests).toHaveLength(2)
      expect(storage.execution.listAttempts(job.runId).map((attempt) => attempt.state)).toEqual([
        "response-received",
        "response-received",
      ])
      expect(storage.execution.getRun(job.runId)?.reservedCalls).toBe(2)
    } finally {
      await wire.close()
    }
  })
  it(`${provider} stops repeated malformed output at the persisted repair budget`, async () => {
    // Given
    const { storage, job } = fixture(provider)
    const wire = await providerWire([protocolOutput(provider, "{}")])
    const runner = new ProviderRunner({
      storage,
      installationId: "installation-1",
      ownerId: "owner-1",
      clock: () => new Date("2026-01-01T00:00:01Z"),
      adapters: {
        [provider]: new ProviderAdapter({ provider, apiKey: "fixture", baseURL: wire.baseURL }),
      },
    })
    try {
      // When
      const result = await runner.execute(job, {
        schema: z.strictObject({ answer: z.string() }),
        instruction: "fixture",
      })
      // Then
      expect(result).toMatchObject({
        state: "failed",
        error: { code: "malformed-output", retryable: false },
      })
      expect(wire.requests).toHaveLength(2)
      expect(storage.execution.listAttempts(job.runId)).toHaveLength(2)
    } finally {
      await wire.close()
    }
  })
  it(`${provider} pauses a disconnected accepted request without hidden retry`, async () => {
    // Given
    const { storage, job } = fixture(provider)
    const wire = await providerWire(["disconnect"])
    const runner = new ProviderRunner({
      storage,
      installationId: "installation-1",
      ownerId: "owner-1",
      clock: () => new Date("2026-01-01T00:00:01Z"),
      adapters: {
        [provider]: new ProviderAdapter({ provider, apiKey: "fixture", baseURL: wire.baseURL }),
      },
    })
    try {
      // When
      const result = await runner.execute(job, {
        schema: z.strictObject({ answer: z.string() }),
        instruction: "fixture",
      })
      // Then
      expect(result).toMatchObject({
        state: "paused",
        reason: "outcome_unknown",
        usage: { kind: "unknown" },
      })
      expect(wire.requests).toHaveLength(1)
      expect(storage.execution.listAttempts(job.runId)).toMatchObject([
        { state: "outcome_unknown", resolution: "awaiting-owner" },
      ])
    } finally {
      await wire.close()
    }
  })
  it(`${provider} pauses after a 429 without replaying or switching providers`, async () => {
    // Given
    const { storage, job } = fixture(provider)
    const wire = await providerWire([
      { status: 429, body: { error: { type: "rate_limit_error", message: "fixture" } } },
    ])
    const runner = new ProviderRunner({
      storage,
      installationId: "installation-1",
      ownerId: "owner-1",
      clock: () => new Date("2026-01-01T00:00:01Z"),
      adapters: {
        [provider]: new ProviderAdapter({ provider, apiKey: "fixture", baseURL: wire.baseURL }),
      },
    })
    try {
      const failed = await runner.execute(job, {
        schema: z.strictObject({ answer: z.string() }),
        instruction: "fixture",
      })
      expect(failed).toMatchObject({
        state: "paused",
        reason: "owner",
      })
      expect(storage.execution.providerPause(job.id)).toMatchObject({
        code: "rate-limited",
        trace_id: expect.any(String),
      })
      expect(wire.requests).toHaveLength(1)
      // When
      expect(() => storage.execution.retryProviderJob(job.id)).toThrow()
      const retry = storage.execution.claimNextJob({
        token: "retry",
        now: "2026-01-01T00:00:01Z",
        expiresAt: "2026-01-01T00:10:00Z",
      })
      expect(retry).toBeNull()
      // Then
      expect(wire.requests).toHaveLength(1)
      expect(storage.execution.listAttempts(job.runId)).toHaveLength(1)
      expect(() => storage.execution.retryProviderJob(job.id)).toThrow()
    } finally {
      await wire.close()
    }
  })
  it(`${provider} retains usage but prevents completion when cancelled after acceptance`, async () => {
    // Given
    const { storage, job } = fixture(provider)
    const wire = await providerWire([protocolOutput(provider)], () =>
      storage.execution.requestCancellation({ jobId: job.id }),
    )
    const runner = new ProviderRunner({
      storage,
      installationId: "installation-1",
      ownerId: "owner-1",
      clock: () => new Date("2026-01-01T00:00:01Z"),
      adapters: {
        [provider]: new ProviderAdapter({ provider, apiKey: "fixture", baseURL: wire.baseURL }),
      },
    })
    try {
      // When
      const result = await runner.execute(job, {
        schema: z.strictObject({ answer: z.string() }),
        instruction: "fixture",
      })
      // Then
      expect(result).toMatchObject({
        state: "cancelled",
        usage: { kind: "known", inputTokens: 8, outputTokens: 4 },
      })
      expect(wire.requests).toHaveLength(1)
      expect(storage.execution.listAttempts(job.runId)).toMatchObject([
        { state: "response-received" },
      ])
    } finally {
      await wire.close()
    }
  })
}
it("persists a missing credential error without a dispatched attempt", async () => {
  // Given
  const { storage, job } = fixture()
  const runner = new ProviderRunner({
    storage,
    installationId: "installation-1",
    ownerId: "owner-1",
    clock: () => new Date("2026-01-01T00:00:01Z"),
    adapters: {},
  })
  // When
  const result = await runner.execute(job, {
    schema: z.strictObject({ answer: z.string() }),
    instruction: "fixture",
  })
  // Then
  expect(result).toMatchObject({ state: "paused", reason: "owner" })
  expect(storage.execution.providerPause(job.id)).toMatchObject({
    code: "missing-credentials",
    trace_id: expect.any(String),
  })
  expect(storage.execution.listAttempts(job.runId)).toEqual([])
})
