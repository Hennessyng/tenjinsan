import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { analysisCacheKey, subscriptionDestination } from "@reading-studio/contracts"
import { BookMapPipeline, bookMapDefinition } from "@reading-studio/generation"
import { LocalSubscriptionAdapter, ProviderRunner } from "@reading-studio/providers"
import { openStorage } from "@reading-studio/storage"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { vi } from "vitest"
import { questionsStage, saveQuestions } from "../src/production-questions.ts"
import { WorkerRuntime } from "../src/runtime.ts"

export async function questionHandoffFixture(cached = false) {
  const directory = await mkdtemp(join(tmpdir(), "ten25-handoff-"))
  const control = join(directory, "control")
  await mkdir(control)
  const binary = join(directory, "synthetic-tool")
  await writeFile(
    binary,
    `#!/bin/sh\nexec "${process.execPath}" "${resolve("apps/worker/tests/question-handoff-fixture.cjs")}" kind:codex scenario:strict-schema "control:${control}" "$@"\n`,
    { mode: 0o700 },
  )
  vi.stubEnv("STUDIO_SUBSCRIPTION_CODEX_BINARY", binary)
  vi.stubEnv("OPENROUTER_API_KEY", "")
  vi.stubEnv("ANTHROPIC_API_KEY", "")
  vi.stubEnv("SERVER_HOST", "127.0.0.1")
  vi.stubEnv("TRUST_PROXY", "0")
  vi.stubEnv("TRUSTED_ORIGINS", "http://127.0.0.1:8787")
  const databasePath = join(directory, "studio.sqlite")
  const privateDataRoot = join(directory, "private")
  vi.stubEnv("DATABASE_PATH", databasePath)
  vi.stubEnv("PRIVATE_DATA_ROOT", privateDataRoot)
  const storage = openStorage({ databasePath, privateDataRoot })
  const fixture = completeGraphFixtures()
  storage.sources.createOwner("owner-1")
  storage.sources.createInstallation({ id: "installation-1", ownerId: "owner-1" })
  storage.sources.persistDocument({
    edition: fixture.edition,
    normalization: fixture.normalization,
  })
  storage.sources.createStudy({
    id: fixture.setup.studyId,
    ownerId: "owner-1",
    editionId: fixture.edition.id,
  })
  await storage.subscriptionLogin.connect("installation-1")
  await storage.subscriptionLogin.settled("installation-1")
  const destination = subscriptionDestination(
    "chatgpt-subscription",
    "installation-1",
    storage.subscriptionLogin.status("installation-1"),
  )
  const setup = storage.sources.appendSetup({
    record: {
      ...fixture.setup,
      analysis: {
        ...fixture.setup.analysis,
        provider: "chatgpt-subscription",
        model: "study-model",
        destination,
        analysisPromptVersion: bookMapDefinition.promptVersion,
        analysisSchemaVersion: bookMapDefinition.schemaVersion,
      },
    },
    parentRevisionId: null,
  })
  const grant = storage.sources.appendGrant({
    ...fixture.grant,
    destination,
    categories: ["book-text", "derived-study-material", "reader-context"],
  })
  if (cached)
    storage.workflow.appendAnalysis({
      record: {
        ...fixture.analysis,
        cacheInput: setup.analysis,
        cacheKey: analysisCacheKey(setup.analysis),
      },
      parentRevisionId: null,
    })
  const authority = {
    storage,
    ownerId: "owner-1",
    installationId: "installation-1",
    localSubscriptions: true,
  }
  const pipeline = new BookMapPipeline(authority)
  function worker(persist = true, clock: () => Date = () => new Date()) {
    return new WorkerRuntime({
      storage,
      clock,
      leaseDurationMs: 120000,
      tokenFactory: randomUUID,
      attemptIdFactory: () => randomUUID(),
      resolveStage: (job) => ({
        kind: "structured",
        runner: new ProviderRunner({
          ...authority,
          clock,
          adapters: { "chatgpt-subscription": new LocalSubscriptionAdapter(authority, job) },
        }),
        request:
          job.stage === "analysis"
            ? pipeline.stage(job)
            : {
                ...questionsStage(storage, job),
                ...(persist ? { onValidated: () => saveQuestions(storage, job) } : {}),
              },
      }),
    })
  }
  return {
    storage,
    setup,
    grant,
    pipeline,
    worker,
    fixture,
    control,
    close: async () => {
      storage.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}
