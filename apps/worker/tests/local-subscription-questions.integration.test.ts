import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { subscriptionDestination } from "@reading-studio/contracts"
import { BookMapPipeline, bookMapDefinition } from "@reading-studio/generation"
import { DiscoveryDraft } from "@reading-studio/generation/questions"
import { LocalSubscriptionAdapter, ProviderRunner } from "@reading-studio/providers"
import { openStorage } from "@reading-studio/storage"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { expect, it, vi } from "vitest"
import { z } from "zod"
import { questionsStage, queueQuestions, saveQuestions } from "../src/production-questions.ts"
import { WorkerRuntime } from "../src/runtime.ts"

it.each([false, true])(
  "persists cited questions with optional citation fields (after approved review=%s)",
  async (renewApproval) => {
    // Given
    const network = vi.fn(async () => {
      throw new TypeError("Network forbidden")
    })
    vi.stubGlobal("fetch", network)
    const directory = await mkdtemp(join(tmpdir(), "ten21-questions-"))
    const control = join(directory, "control")
    await mkdir(control)
    const binary = join(directory, "tool-fixture")
    await writeFile(
      binary,
      `#!/bin/sh\nexec "${process.execPath}" "${resolve("packages/storage/tests/subscription-execution-fixture.cjs")}" kind:codex scenario:strict-schema "control:${control}" "$@"\n`,
      { mode: 0o700 },
    )
    vi.stubEnv("STUDIO_SUBSCRIPTION_CODEX_BINARY", binary)
    const storage = openStorage({
      databasePath: join(directory, "studio.sqlite"),
      privateDataRoot: join(directory, "private"),
    })
    try {
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
      const authority = {
        storage,
        ownerId: "owner-1",
        installationId: "installation-1",
        localSubscriptions: true,
      }
      const pipeline = new BookMapPipeline(authority)
      const worker = new WorkerRuntime({
        storage,
        clock: () => new Date(),
        leaseDurationMs: 120000,
        tokenFactory: randomUUID,
        attemptIdFactory: () => randomUUID(),
        resolveStage: (job) => {
          const runner = new ProviderRunner({
            ...authority,
            clock: () => new Date(),
            adapters: { "chatgpt-subscription": new LocalSubscriptionAdapter(authority, job) },
          })
          switch (job.stage) {
            case "analysis":
              return { kind: "structured", runner, request: pipeline.stage(job) }
            case "questions":
              return {
                kind: "structured",
                runner,
                request: {
                  ...questionsStage(storage, job),
                  onValidated: () => saveQuestions(storage, job),
                },
              }
            default:
              throw new TypeError("Unexpected fixture stage")
          }
        },
      })
      pipeline.prepare(setup.id, grant.id)
      const mapping = await worker.runNext()
      if (mapping.kind !== "provider" || mapping.job.state !== "completed")
        throw new TypeError("Analysis precondition failed")
      const analysis = pipeline.prepare(setup.id, grant.id)
      queueQuestions(storage, setup.id, grant.id, analysis)
      let questionJob = storage.execution
        .listSetupJobs(setup.id)
        .find((job) => job.stage === "questions")
      const source = analysis.claims[0]?.sources[0]
      if (!questionJob || !source) throw new TypeError("Missing fixture questions precondition")
      if (renewApproval) {
        await writeFile(join(control, "reject-next"), "fixture")
        const stopped = await worker.runNext()
        if (stopped.kind !== "provider" || stopped.job.state !== "paused")
          throw new TypeError("Expected a paused fixture questions job")
        const renewed = storage.sources.appendSetup({
          record: { ...setup, id: "setup-approved-again" },
          parentRevisionId: setup.id,
        })
        const approved = storage.sources.appendGrant({
          ...grant,
          id: "grant-approved-again",
          setupRevisionId: renewed.id,
        })
        const reused = pipeline.prepare(renewed.id, approved.id)
        if (reused.id !== analysis.id)
          throw new TypeError("Approved review did not reuse successful analysis")
        queueQuestions(storage, renewed.id, approved.id, reused)
        questionJob = storage.execution
          .listSetupJobs(renewed.id)
          .find((job) => job.stage === "questions")
        if (!questionJob) throw new TypeError("Renewed questions job missing")
      }
      const draft = DiscoveryDraft.parse({
        analysisRevisionId: analysis.id,
        contextRevisionId: questionJob.inputRevisionId,
        groups: [{ id: "focus", label: { en: "Focus", ja: "焦点" } }],
        lenses: [
          {
            id: "lens",
            revisionId: "question-revision",
            groupId: "focus",
            learningGoalKey: "attention",
            label: { en: "Attention", ja: "注意" },
            rationale: { en: "Explore", ja: "考える" },
            sources: [source],
            complications: [{ label: { en: "Limit", ja: "限界" }, sources: [source] }],
            prompt: { en: "Which skill?", ja: "どの力？" },
            mode: "single",
            minSelections: 1,
            maxSelections: 1,
            options: [
              {
                id: "one",
                goalKey: "one",
                label: { en: "Listen", ja: "聴く" },
                rationale: { en: "Notice", ja: "気づく" },
              },
              {
                id: "two",
                goalKey: "two",
                label: { en: "Ask", ja: "尋ねる" },
                rationale: { en: "Reflect", ja: "振り返る" },
              },
            ],
          },
        ],
      })
      await writeFile(join(control, "questions-output.json"), JSON.stringify(draft))
      if (!questionsStage(storage, questionJob).schema.safeParse(draft).success)
        throw new TypeError("Question output fixture does not match application constraints")
      // When
      const result = await worker.runNext()
      // Then
      const status =
        result.kind === "provider"
          ? {
              state: result.job.state,
              failureCode: result.job.state === "failed" ? result.job.error.code : null,
            }
          : { state: result.kind, failureCode: null }
      expect(status).toEqual({ state: "completed", failureCode: null })
      expect(storage.interviews.latest(setup.studyId)?.steps[0]?.question.options).toHaveLength(2)
      expect(storage.execution.listAttempts(questionJob.runId)).toHaveLength(1)
      expect(
        storage.execution.listOwnerJobs("owner-1").filter((job) => job.stage === "analysis"),
      ).toHaveLength(1)
      const Wire = z.object({ nativeSchema: z.boolean() })
      expect(
        Wire.parse(JSON.parse(await readFile(join(control, "analysis-wire.json"), "utf8")))
          .nativeSchema,
      ).toBe(true)
      expect(
        Wire.parse(JSON.parse(await readFile(join(control, "questions-wire.json"), "utf8")))
          .nativeSchema,
      ).toBe(false)
      expect(network).not.toHaveBeenCalled()
    } finally {
      storage.close()
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      await rm(directory, { recursive: true, force: true })
    }
  },
)
