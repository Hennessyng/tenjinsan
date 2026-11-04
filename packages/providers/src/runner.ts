import { randomUUID } from "node:crypto"
import { contentDigest, type Job } from "@reading-studio/contracts"
import { MaintenancePausedError } from "@reading-studio/storage"
import { z } from "zod"
import { ProviderError } from "./catalog.ts"
import type {
  ProviderRunnerOptions,
  RunningProviderJob,
  StructuredStage,
} from "./execution-contracts.ts"

export type { StructuredStage } from "./execution-contracts.ts"

import { measureRequest } from "./request-measurement.ts"
import { preparedSchemaRepair, receivedOutputCount, validateStageOutput } from "./schema-repair.ts"
import { inputCoverage, RecordedProviderReceipt as ProviderReceipt } from "./source-input.ts"
import { authorizeStage, currentProviderJob } from "./stage-authorization.ts"
import { prepareStageRequest, withinDefaultRunBudget } from "./stage-request.ts"
import { preflightSubscription } from "./subscription-preflight.ts"

export class ProviderRunner {
  constructor(private readonly options: ProviderRunnerOptions) {}
  async execute(job: RunningProviderJob, stage: StructuredStage): Promise<Job> {
    const execution = this.options.storage.execution
    const lease = () => ({
      jobId: job.id,
      token: job.lease.token,
      fence: job.lease.fence,
      now: this.options.clock().toISOString(),
    })
    const fail = (code: string, retryable = false) => {
      if (execution.getJob(job.id)?.cancellationRequested)
        return execution.cancelClaimedJob(lease())
      const result = execution.failProviderJob({ lease: lease(), code, retryable })
      const pause = execution.providerPause(job.id)
      if (pause) console.info(JSON.stringify({ event: "provider-paused", jobId: job.id, ...pause }))
      return result
    }
    try {
      let schema: Record<string, unknown>
      try {
        schema = stage.wireSchema ?? z.toJSONSchema(stage.schema, { reused: "ref" })
      } catch (error) {
        if (error instanceof Error) return fail("unsupported-schema")
        throw error
      }
      while (true) {
        const current = currentProviderJob(this.options, job)
        if (stage.signal?.aborted && !current.cancellationRequested)
          execution.requestCancellation({ jobId: job.id })
        if (current.cancellationRequested || stage.signal?.aborted)
          return execution.cancelClaimedJob(lease())
        await preflightSubscription(this.options, current)
        const {
          setup,
          blocks: approvedBlocks,
          normalization,
        } = authorizeStage(this.options, job, stage)
        const adapter = this.options.adapters[job.provider]
        if (!adapter) throw new ProviderError("missing-credentials")
        const run = execution.getRun(job.runId)
        if (run?.state !== "running") throw new ProviderError("unauthorized")
        if (!withinDefaultRunBudget(run.budget)) return fail("budget-limit")
        if (
          (job.stage === "analysis" ? setup.analysis.settings : setup.generation.settings)
            .maxOutputTokens > run.budget.maxOutputTokens
        )
          throw new ProviderError("input-limit")
        const attempts = execution.listAttempts(job.runId)
        const feedback = preparedSchemaRepair({
          execution,
          attempts,
          schema: stage.schema,
          wireSchema: schema,
        })
        const requestInput = {
          model: job.model,
          settings: job.stage === "analysis" ? setup.analysis.settings : setup.generation.settings,
          instruction: stage.instruction,
          schema,
          signal: stage.signal ?? new AbortController().signal,
          ...(feedback ? { schemaRepair: feedback } : {}),
        }
        const { request, blocks, strategy } = await prepareStageRequest({
          sourceCharacterLimit: run.budget.maxSourceCharacters,
          setup,
          stage: {
            ...stage,
            ...(this.options.capacity ? { capacity: this.options.capacity } : {}),
          },
          approved: approvedBlocks,
          request: requestInput,
          measure: (request) => measureRequest(request, adapter),
        })
        const latest = attempts.at(-1)
        if (latest?.state === "dispatching") return execution.pauseUnknownProviderJob(lease())
        let receipt: ProviderReceipt
        if (latest?.state === "response-received" && !latest.retryApproved) {
          const body = execution.getAttemptReceipt(latest.id)
          if (!body) throw new ProviderError("outcome-unknown")
          receipt = ProviderReceipt.parse(JSON.parse(new TextDecoder().decode(body)))
        } else {
          const prepared =
            latest?.state === "prepared"
              ? { kind: "prepared" as const, attempt: latest }
              : execution.reserveAttempt({
                  ...lease(),
                  attemptId: randomUUID(),
                  preparedAt: this.options.clock().toISOString(),
                })
          if (prepared.kind === "budget-exhausted") {
            const paused = execution.getJob(job.id)
            if (!paused) throw new ProviderError("unauthorized")
            return paused
          }
          if (this.options.storage.maintenance.active()) throw new MaintenancePausedError()
          execution.markAttemptDispatching({
            ...lease(),
            attemptId: prepared.attempt.id,
            dispatchedAt: this.options.clock().toISOString(),
          })
          try {
            receipt = await adapter.dispatch(request)
          } catch (error) {
            if (error instanceof ProviderError && error.code === "outcome-unknown") {
              if (stage.signal?.aborted) execution.requestCancellation({ jobId: job.id })
              if (execution.getJob(job.id)?.cancellationRequested)
                return execution.cancelClaimedJob(lease())
              return execution.pauseUnknownProviderJob(lease())
            }
            throw error
          }
          execution.recordAttemptReceipt({
            ...lease(),
            attemptId: prepared.attempt.id,
            receivedAt: this.options.clock().toISOString(),
            responseBody: new TextEncoder().encode(
              JSON.stringify({
                ...receipt,
                ...(strategy ? { processingStrategy: strategy } : {}),
                ...(stage.processingStep ? { processingStep: stage.processingStep } : {}),
                ...(stage.batchTarget ? { batchTarget: stage.batchTarget } : {}),
                ...(stage.batchManifestHash ? { batchManifestHash: stage.batchManifestHash } : {}),
                ...(stage.verificationTarget
                  ? { verificationTarget: stage.verificationTarget }
                  : {}),
                inputCoverage: inputCoverage({
                  normalization,
                  approved: approvedBlocks,
                  sent: blocks,
                  prompt: request.prompt,
                }),
              }),
            ),
            usage: receipt.usage,
          })
        }
        if (execution.getJob(job.id)?.cancellationRequested)
          return execution.cancelClaimedJob(lease())
        authorizeStage(this.options, job, stage)
        if (
          receipt.usage.kind === "known" &&
          receipt.usage.outputTokens > Math.min(6000, run.budget.maxOutputTokens)
        )
          return fail("output-limit")
        switch (receipt.kind) {
          case "error":
            return fail(
              receipt.code,
              receipt.code === "rate-limited" || receipt.code === "unavailable",
            )
          case "output": {
            const validation = validateStageOutput({
              schema: stage.schema,
              wireSchema: schema,
              text: receipt.text,
            })
            const parsed = validation.parsed
            if (parsed.success) {
              if (this.options.storage.liveStudyGuard.target)
                this.options.storage.liveStudyGuard.used()
              authorizeStage(this.options, job, stage)
              stage.onValidated?.(job)
              if (execution.getJob(job.id)?.cancellationRequested)
                return execution.cancelClaimedJob(lease())
              authorizeStage(this.options, job, stage)
              return execution.completeJob({
                ...lease(),
                resultHash: contentDigest(JSON.stringify(parsed.data)),
              })
            }
            if (
              receivedOutputCount(execution, execution.listAttempts(job.runId)) >
              run.budget.maxSchemaRepairs
            )
              return fail("malformed-output")
            await prepareStageRequest({
              sourceCharacterLimit: run.budget.maxSourceCharacters,
              setup,
              stage: {
                ...stage,
                ...(this.options.capacity ? { capacity: this.options.capacity } : {}),
              },
              approved: approvedBlocks,
              request: {
                ...requestInput,
                ...(validation.repair ? { schemaRepair: validation.repair } : {}),
              },
              measure: (request) => measureRequest(request, adapter),
            })
            const prepared = execution.reserveAttempt({
              ...lease(),
              attemptId: randomUUID(),
              preparedAt: this.options.clock().toISOString(),
            })
            if (prepared.kind === "budget-exhausted") {
              const paused = execution.getJob(job.id)
              if (!paused) throw new ProviderError("unauthorized")
              return paused
            }
            break
          }
          default:
            return assertNever(receipt)
        }
      }
    } catch (error) {
      if (error instanceof ProviderError) {
        if (execution.getJob(job.id)?.cancellationRequested)
          return execution.cancelClaimedJob(lease())
        return fail(error.code)
      }
      throw error
    }
  }
}
function assertNever(value: never): never {
  throw new TypeError(`Unsupported receipt: ${value}`)
}
