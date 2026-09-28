import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type BookMapDefinition,
  BookMapPipeline,
  bookMapDefinition,
} from "@reading-studio/generation"
import type { ProviderReceipt, StructuredRequest } from "@reading-studio/providers"
import { ProviderRunner } from "@reading-studio/providers"
import type { Storage } from "@reading-studio/storage"
import { openStorage } from "@reading-studio/storage"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { z } from "zod"
import { WorkerRuntime } from "../src/runtime.ts"

export class FixtureAdapter {
  readonly requests: StructuredRequest[] = []
  constructor(readonly fault: "none" | "invalid-citation" | "refused" = "none") {}
  async dispatch(request: StructuredRequest): Promise<ProviderReceipt> {
    this.requests.push(request)
    if (this.fault === "refused")
      return {
        kind: "error",
        code: "refused",
        usage: { kind: "known", inputTokens: 10, outputTokens: 0 },
      }
    const blocks = z
      .array(z.object({ start: z.number(), end: z.number(), text: z.string() }))
      .parse(JSON.parse(request.prompt.slice(request.prompt.lastIndexOf("\n") + 1)))
    const block = blocks[0]
    if (!block) throw new TypeError("Fixture requires a source window")
    const start = block.start
    const end = this.fault === "invalid-citation" ? block.end + 1 : Math.min(start + 9, block.end)
    return {
      kind: "output",
      usage: { kind: "known", inputTokens: 10, outputTokens: 10 },
      text: JSON.stringify({
        claims: [{ text: "Listening helps understanding.", start, end }],
        concepts: [{ text: "Attention", start, end }],
        qualifications: [{ text: "Quiet company can matter too.", start, end }],
      }),
    }
  }
}

export function bookMapFixture(text?: string, blockCount = 1, derivedConsent = false) {
  const directory = mkdtempSync(join(tmpdir(), "book-map-"))
  const databasePath = join(directory, "studio.sqlite")
  const privateDataRoot = join(directory, "private")
  const storage = openStorage({ databasePath, privateDataRoot })
  const fixture = completeGraphFixtures()
  const second = {
    path: "text/company.xhtml",
    role: "main-chapter",
    status: "included",
    blocks: [
      {
        id: "block-2",
        text: "Companion presence matters.",
        originalFragment: "Companion presence matters.",
      },
    ],
  }
  storage.sources.createOwner("owner-1")
  storage.sources.createInstallation({ id: "installation-1", ownerId: "owner-1" })
  storage.sources.appendEdition(fixture.edition)
  storage.sources.createStudy({ id: "study-1", ownerId: "owner-1", editionId: "edition-1" })
  const resources = fixture.normalization.resources.map((resource) => ({
    ...resource,
    blocks: resource.blocks.flatMap((block) =>
      Array.from({ length: blockCount }, (_, index) => ({
        ...block,
        id: index === 0 ? block.id : `${block.id}-${index}`,
        text: text ?? block.text,
      })),
    ),
  }))
  storage.sources.appendNormalization({
    record: { ...fixture.normalization, resources: [...resources, second] },
    parentRevisionId: null,
  })
  storage.sources.appendSetup({
    record: {
      ...fixture.setup,
      analysis: {
        ...fixture.setup.analysis,
        model: "gpt-4.1-mini",
        analysisPromptVersion: "analysis-1",
        analysisSchemaVersion: "analysis-1",
        scope: {
          kind: "all-main-chapters",
          selected: [
            ...fixture.setup.analysis.scope.selected.map((resource) => ({
              ...resource,
              blockIds:
                resources
                  .find((item) => item.path === resource.resourcePath)
                  ?.blocks.map((block) => block.id) ?? resource.blockIds,
            })),
            { resourcePath: second.path, blockIds: ["block-2"] },
          ],
          exclusions: [],
        },
      },
    },
    parentRevisionId: null,
  })
  storage.sources.appendGrant(
    derivedConsent
      ? {
          ...fixture.grant,
          categories: ["book-text", "derived-study-material", "reader-context"],
        }
      : fixture.grant,
  )
  return { directory, databasePath, privateDataRoot, storage }
}

export function fixtureWorker(
  storage: Storage,
  adapter: FixtureAdapter,
  definition: BookMapDefinition = bookMapDefinition,
) {
  const authority = { storage, ownerId: "owner-1", installationId: "installation-1" }
  const pipeline = new BookMapPipeline(authority, definition)
  const runner = new ProviderRunner({
    ...authority,
    clock: () => new Date("2026-09-23T00:00:00Z"),
    adapters: { openai: adapter, anthropic: adapter },
  })
  const worker = new WorkerRuntime({
    storage,
    clock: () => new Date("2026-09-23T00:00:00Z"),
    leaseDurationMs: 120000,
    tokenFactory: () => "fixture-worker",
    attemptIdFactory: (n) => `attempt-${n}`,
    resolveStage: (job) => ({ kind: "structured", runner, request: pipeline.stage(job) }),
  })
  return { pipeline, worker }
}
