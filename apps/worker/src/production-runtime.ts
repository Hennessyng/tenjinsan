import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { BookMapPipeline } from "@reading-studio/generation"
import {
  advanceLessonStage,
  generationStage,
  saveGenerationStage,
} from "@reading-studio/generation/provider-stages"
import {
  configuredCredential,
  LocalSubscriptionAdapter,
  ProviderAdapter,
  ProviderRunner,
  preflightSubscription,
  type VerifiedRouteCapacity,
} from "@reading-studio/providers"
import { renderPublicationOutput } from "@reading-studio/server/publication-service"
import {
  configuredLiveStudyTarget,
  LiveStudyGuardError,
  openStorage,
} from "@reading-studio/storage"
import { z } from "zod"
import { runAnalysisEvaluation } from "./analysis-evaluation-runtime.ts"
import { advanceProductionStage, recoverQuestionHandoffs } from "./production-handoffs.ts"
import { questionsStage, saveQuestions } from "./production-questions.ts"
import { resolveProductionStage } from "./production-stage.ts"
import { WorkerRuntime } from "./runtime.ts"

const Config = z.object({
  DATABASE_PATH: z.string().trim().min(1),
  PRIVATE_DATA_ROOT: z.string().trim().min(1),
  SERVER_HOST: z.string().optional(),
  TRUST_PROXY: z.string().optional(),
  TRUSTED_ORIGINS: z.string().optional(),
  STUDIO_PROVIDER_BASE_URL: z
    .url()
    .refine((url) => new URL(url).hostname === "127.0.0.1")
    .optional(),
  STUDIO_MATRIX_RENDER_FAILURE: z.literal("enabled").optional(),
})

export async function runProductionWorker(
  signal: AbortSignal,
  capacity?: VerifiedRouteCapacity,
): Promise<void> {
  const config = Config.parse(process.env)
  const liveStudyTarget = configuredLiveStudyTarget(process.env["STUDIO_LIVE_STUDY_TARGET"])
  const origins = z
    .array(z.url())
    .min(1)
    .safeParse(config.TRUSTED_ORIGINS?.split(",").map((origin) => origin.trim()))
  const localSubscriptions =
    config.SERVER_HOST !== undefined &&
    ["127.0.0.1", "::1", "[::1]", "localhost"].includes(config.SERVER_HOST) &&
    config.TRUST_PROXY === "0" &&
    origins.success &&
    origins.data.every((origin) =>
      ["127.0.0.1", "::1", "[::1]", "localhost"].includes(new URL(origin).hostname),
    )
  if (config.STUDIO_MATRIX_RENDER_FAILURE && !config.STUDIO_PROVIDER_BASE_URL)
    throw new TypeError("Matrix renderer fault requires a loopback provider")
  if (liveStudyTarget && (!localSubscriptions || config.STUDIO_PROVIDER_BASE_URL))
    throw new LiveStudyGuardError("target-mismatch")
  const storage = openStorage({
    databasePath: config.DATABASE_PATH,
    privateDataRoot: config.PRIVATE_DATA_ROOT,
    runtimeRole: "worker",
    liveStudyTarget,
  })
  const adapters = {
    ...(configuredCredential("openrouter")
      ? {
          openrouter: new ProviderAdapter({
            provider: "openrouter",
            ...(config.STUDIO_PROVIDER_BASE_URL
              ? { baseURL: config.STUDIO_PROVIDER_BASE_URL }
              : {}),
          }),
        }
      : {}),
    ...(configuredCredential("anthropic")
      ? {
          anthropic: new ProviderAdapter({
            provider: "anthropic",
            ...(config.STUDIO_PROVIDER_BASE_URL
              ? { baseURL: config.STUDIO_PROVIDER_BASE_URL }
              : {}),
          }),
        }
      : {}),
  }
  try {
    if (liveStudyTarget?.purpose) {
      const grant = liveStudyTarget.grantId && storage.sources.getGrant(liveStudyTarget.grantId)
      if (!grant) throw new LiveStudyGuardError("target-mismatch")
      await runAnalysisEvaluation({
        storage,
        ownerId: grant.ownerId,
        installationId: grant.installationId,
        localSubscriptions,
        ...(capacity ? { capacity } : {}),
        signal,
      })
      return
    }
    if (liveStudyTarget) {
      const reservedAttempts = storage.liveStudyGuard.used()
      const attemptLimit = storage.liveStudyGuard.limit(liveStudyTarget.setupRevisionId)
      const shared = storage.liveStudyGuard.sharedStatus(liveStudyTarget.setupRevisionId)
      console.info(
        JSON.stringify({
          event: "live-study-scoped",
          pid: process.pid,
          attemptLimit,
          reservedAttempts,
          ...(shared ? { cumulativeReserved: shared.used, cumulativeLimit: shared.limit } : {}),
        }),
      )
      if (reservedAttempts >= attemptLimit) return
    }
    const startupAdmission = storage.maintenance.enter()
    if (startupAdmission !== null)
      try {
        recoverQuestionHandoffs(storage, localSubscriptions, capacity)
        for (const job of storage.execution.listCompletedLessonJobs()) {
          if (job.provider === "openai") continue
          const setup = storage.sources.getSetup(job.setupRevisionId)
          if (setup && storage.sources.getLatestSetup(setup.studyId)?.id === setup.id)
            advanceLessonStage(storage, job)
        }
      } finally {
        storage.maintenance.leave(startupAdmission)
      }
    const worker = new WorkerRuntime({
      storage,
      clock: () => new Date(),
      leaseDurationMs: 120_000,
      signal,
      tokenFactory: randomUUID,
      attemptIdFactory: () => randomUUID(),
      resolveStage: async (job) => {
        if (
          job.stage !== "analysis" &&
          job.stage !== "questions" &&
          job.stage !== "outline" &&
          job.stage !== "lesson"
        )
          throw new TypeError(`Unsupported persisted stage: ${job.stage}`)
        const authority = {
          storage,
          localSubscriptions,
          ownerId: job.grant.ownerId,
          installationId: job.grant.installationId,
          ...(capacity ? { capacity } : {}),
        }
        if (
          storage.sources.getSetup(job.setupRevisionId)?.analysis.analysisPromptVersion ===
          "whole-book-2"
        )
          return resolveProductionStage({ ...authority, clock: () => new Date() }, job)
        await preflightSubscription(authority, job)
        return {
          kind: "structured" as const,
          runner: new ProviderRunner({
            ...authority,
            clock: () => new Date(),
            adapters: {
              ...adapters,
              ...(["chatgpt-subscription", "grok-subscription"].includes(job.provider)
                ? { [job.provider]: new LocalSubscriptionAdapter(authority, job) }
                : {}),
              codex: new ProviderAdapter({
                provider: "codex",
                codex: storage.providerConnections.codex(
                  authority.ownerId,
                  authority.installationId,
                ),
              }),
            },
          }),
          request:
            job.stage === "analysis"
              ? new BookMapPipeline(authority).stage(job)
              : job.stage === "questions"
                ? {
                    ...questionsStage(storage, job),
                    onValidated: () => saveQuestions(storage, job),
                  }
                : {
                    ...generationStage(storage, job),
                    onValidated: () => saveGenerationStage(storage, job),
                  },
        }
      },
    })
    while (!signal.aborted) {
      if (
        liveStudyTarget &&
        storage.liveStudyGuard.used() >=
          storage.liveStudyGuard.limit(liveStudyTarget.setupRevisionId)
      )
        break
      const result = await worker.runNext()
      const postJobAdmission = storage.maintenance.enter()
      if (postJobAdmission !== null)
        try {
          if (
            result.kind === "provider" &&
            result.job.state === "completed" &&
            result.job.stage === "analysis"
          ) {
            advanceProductionStage(storage, result.job, {
              localSubscriptions,
              ...(capacity ? { capacity } : {}),
            })
          }
          if (
            result.kind === "provider" &&
            result.job.state === "completed" &&
            result.job.stage === "lesson"
          )
            advanceLessonStage(storage, result.job)
          const output = storage.publicationOutputs.nextQueued()
          if (output && !signal.aborted)
            await renderPublicationOutput(
              storage,
              output,
              config.STUDIO_MATRIX_RENDER_FAILURE &&
                existsSync(join(dirname(config.DATABASE_PATH), "matrix-render-failure"))
                ? { chromiumExecutablePath: "/nonexistent/studio-matrix-chromium" }
                : {},
            )
        } finally {
          storage.maintenance.leave(postJobAdmission)
        }
      if (result.kind === "idle")
        await delay(250, undefined, { signal }).catch((error: unknown) => {
          if (!signal.aborted) throw error
        })
    }
  } finally {
    storage.close()
  }
}
