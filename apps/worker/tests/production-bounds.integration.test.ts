import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generationStage, queueGenerationStage } from "@reading-studio/generation/provider-stages"
import { ProviderAdapter, ProviderRunner, selectedEvidence } from "@reading-studio/providers"
import { openStorage } from "@reading-studio/storage"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { WorkerRuntime } from "../src/runtime.ts"
import { lessonFixture } from "./lesson-fixture.ts"
import { protocolOutput, providerWire } from "./providers-wire.ts"

it("rejects eight overlapping 12 KB evidence claims before any paid attempt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "provider-bounds-"))
  const storage = openStorage({
    databasePath: join(directory, "studio.sqlite"),
    privateDataRoot: join(directory, "private"),
  })
  let wire: Awaited<ReturnType<typeof providerWire>> | undefined
  try {
    const fixture = lessonFixture(storage, "gpt-4.1-mini", "A".repeat(12_000))
    const analysis = storage.workflow.getAnalysis("analysis-1")
    if (!analysis) throw new TypeError("Missing persisted analysis")
    const selected = selectedEvidence(
      storage,
      analysis.claims.flatMap((finding) => finding.sources),
    )
    expect(selected.citations).toHaveLength(8)
    expect(selected.passages).toHaveLength(1)
    expect(selected.passages[0]?.text.length).toBe(12_000)
    storage.sources.appendGrant({
      ...completeGraphFixtures().grant,
      categories: ["book-text", "derived-study-material", "reader-context"],
    })
    const brief = storage.briefs.current("study-1")?.draft
    if (!brief) throw new TypeError("Missing approved brief")
    wire = await providerWire([protocolOutput("openrouter", "{}")])
    queueGenerationStage(storage, "outline", brief.id, "setup-1", "grant-1")
    const runner = new ProviderRunner({
      storage,
      ownerId: "owner-1",
      installationId: "installation-1",
      clock: () => new Date(),
      adapters: {
        openrouter: new ProviderAdapter({
          provider: "openrouter",
          apiKey: "fixture",
          baseURL: wire.baseURL,
        }),
      },
    })
    const worker = new WorkerRuntime({
      storage,
      clock: () => new Date(),
      leaseDurationMs: 120_000,
      tokenFactory: randomUUID,
      attemptIdFactory: () => randomUUID(),
      resolveStage: (job) => ({
        kind: "structured",
        runner,
        request: generationStage(storage, job),
      }),
    })
    const result = await worker.runNext()
    const sent = wire.requests.map((request) => Buffer.byteLength(JSON.stringify(request)))
    expect(fixture.text.length).toBe(12_000)
    expect(Math.max(0, ...sent)).toBeLessThanOrEqual(32_000)
    expect(result.kind === "provider" && result.job.state).toBe("failed")
    expect(result.kind === "provider" && storage.execution.listAttempts(result.job.runId)).toEqual(
      [],
    )
    expect(wire.requests).toHaveLength(0)
  } finally {
    await wire?.close()
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
