import { rmSync } from "node:fs"
import { NormalizationRevision } from "@reading-studio/contracts"
import {
  authorizeSource,
  inputCoverage,
  ProviderAdapter,
  ProviderRunner,
  sourceInput,
} from "@reading-studio/providers"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { seedActiveJob } from "./fixtures.ts"
import { protocolOutput, providerWire } from "./providers-wire.ts"

const fixtures: ReturnType<typeof seedActiveJob>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.storage.close()
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})
function fixture(text = "Early", partial = false) {
  const document = NormalizationRevision.parse({
    ...completeGraphFixtures().normalization,
    coverage: partial ? "partial" : "complete",
    omissions: partial ? [{ path: "pdf/page-2", reason: "no-selectable-text" }] : [],
    resources: [
      {
        path: "pdf/page-1",
        role: "main-chapter",
        status: "included",
        blocks: [{ id: "early", text, locator: { kind: "pdf", page: 1 } }],
      },
      {
        path: "pdf/page-3",
        role: "supplementary",
        status: "included",
        blocks: [{ id: "final", text: "Final", locator: { kind: "pdf", page: 3 } }],
      },
    ],
  })
  const result = seedActiveJob({ provider: "anthropic", model: "claude-sonnet-4-6", document })
  fixtures.push(result)
  const job = result.storage.execution.claimNextJob({
    token: "source-accounting",
    now: "2026-01-01T00:00:00Z",
    expiresAt: "2026-01-01T01:00:00Z",
  })
  if (job?.state !== "running") throw new TypeError("Missing claimed job")
  return { ...result, job }
}

it("sends every reviewed range with page locations and records transmission separately from processing", async () => {
  // Given
  const { storage, job } = fixture("Early middle", true)
  const wire = await providerWire([protocolOutput("anthropic")])
  const runner = new ProviderRunner({
    storage,
    installationId: "installation-1",
    ownerId: "owner-1",
    clock: () => new Date("2026-01-01T00:00:01Z"),
    adapters: {
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
    expect(result.state).toBe("completed")
    const request = z
      .object({
        messages: z.array(
          z.object({ content: z.array(z.object({ type: z.string(), text: z.string() })) }),
        ),
      })
      .parse(wire.requests[0])
    const text = request.messages[0]?.content[0]?.text ?? ""
    expect(JSON.parse(text.slice(text.lastIndexOf("\n") + 1))).toMatchObject([
      {
        text: "Early middle",
        resourcePath: "pdf/page-1",
        start: 0,
        end: 12,
        locator: { kind: "pdf", page: 1 },
      },
      {
        text: "Final",
        resourcePath: "pdf/page-3",
        start: 0,
        end: 5,
        locator: { kind: "pdf", page: 3 },
      },
    ])
    const attempt = storage.execution.listAttempts(job.runId)[0]
    if (!attempt) throw new TypeError("Missing attempt")
    const receipt = storage.execution.getAttemptReceipt(attempt.id)
    expect(receipt && JSON.parse(new TextDecoder().decode(receipt))).toMatchObject({
      inputCoverage: {
        extraction: "partial",
        transmission: "reviewed-scope",
        processing: "not-established",
        omissions: [{ path: "pdf/page-2", reason: "no-selectable-text" }],
        ranges: [
          { blockId: "early", start: 0, end: 12 },
          { blockId: "final", start: 0, end: 5 },
        ],
      },
    })
  } finally {
    await wire.close()
  }
})

it("refuses an oversized reviewed scope before sending anything rather than slicing it", async () => {
  // Given
  const { storage, job } = fixture("x".repeat(40_000))
  const wire = await providerWire([protocolOutput("anthropic")])
  const runner = new ProviderRunner({
    storage,
    installationId: "installation-1",
    ownerId: "owner-1",
    clock: () => new Date("2026-01-01T00:00:01Z"),
    adapters: {
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
    expect(result).toMatchObject({ state: "failed", error: { code: "input-limit" } })
    expect(wire.requests).toEqual([])
    expect(storage.execution.listAttempts(job.runId)).toEqual([])
  } finally {
    await wire.close()
  }
})

it("accounts for every untransmitted range when a stage requests a narrow source window", () => {
  // Given
  const { storage, job } = fixture("Early middle")
  const { blocks, normalization } = authorizeSource(
    { storage, installationId: "installation-1", ownerId: "owner-1" },
    job,
  )
  const sent = sourceInput(blocks, { blockId: "early", start: 2, end: 5 })
  // When
  const coverage = inputCoverage({ normalization, approved: blocks, sent, prompt: "synthetic" })
  // Then
  expect(coverage).toMatchObject({
    transmission: "window-only",
    untransmittedRanges: [
      { resourcePath: "pdf/page-1", blockId: "early", start: 0, end: 2 },
      { resourcePath: "pdf/page-1", blockId: "early", start: 5, end: 12 },
      { resourcePath: "pdf/page-3", blockId: "final", start: 0, end: 5 },
    ],
  })
})
