import { isSubscriptionProvider, type Job } from "@reading-studio/contracts"
import { BookMapPipeline } from "@reading-studio/generation"
import { generationStage, saveGenerationStage } from "@reading-studio/generation/provider-stages"
import {
  LocalSubscriptionAdapter,
  type ProviderAuthority,
  ProviderError,
  ProviderRunner,
  preflightSubscription,
} from "@reading-studio/providers"
import { questionsStage, saveQuestions } from "./production-questions.ts"
import type { StageHandler } from "./runtime.ts"

export async function resolveProductionStage(
  options: ProviderAuthority & { readonly clock: () => Date },
  job: Extract<Job, { readonly state: "running" }>,
): Promise<StageHandler> {
  options.storage.liveStudyGuard.assertJob(job)
  const setup = options.storage.sources.getSetup(job.setupRevisionId)
  if (
    setup &&
    isSubscriptionProvider(job.provider) &&
    setup.analysis.destination?.executionPolicy !== "tool-managed-v1"
  )
    throw new ProviderError("route-re-review-required")
  await preflightSubscription(options, job)
  const runner = new ProviderRunner({
    ...options,
    adapters: { "chatgpt-subscription": new LocalSubscriptionAdapter(options, job) },
  })
  switch (job.stage) {
    case "analysis":
      return { kind: "structured", runner, request: new BookMapPipeline(options).stage(job) }
    case "questions":
      return {
        kind: "structured",
        runner,
        request: {
          ...questionsStage(options.storage, job),
          onValidated: () => saveQuestions(options.storage, job),
        },
      }
    case "outline":
    case "lesson":
      return {
        kind: "structured",
        runner,
        request: {
          ...generationStage(options.storage, job),
          onValidated: () => saveGenerationStage(options.storage, job),
        },
      }
    case "synthesis":
    case "brief":
    case "evidence":
    case "publication":
    case "artifact":
      throw new TypeError("Unsupported persisted inference stage")
    default: {
      const unreachable: never = job.stage
      throw new TypeError(`Unknown stage: ${unreachable}`)
    }
  }
}
