import { randomUUID } from "node:crypto"
import { contentDigest, type Job, RunBudget } from "@reading-studio/contracts"
import { MaintenancePausedError } from "@reading-studio/storage"
import { z } from "zod"
import {
  MAX_PROVIDER_REQUEST_BYTES,
  type ProviderAdapter,
  ProviderReceipt,
  type StructuredRequest,
} from "./adapter.ts"
import { authorizeSource, type ProviderAuthority } from "./authorization.ts"
import { ProviderError, type ProviderName } from "./catalog.ts"

type RunningJob = Extract<Job, { readonly state: "running" }>
type Options = ProviderAuthority & {
  readonly clock: () => Date
  readonly adapters: Readonly<
    Partial<
      Record<
        ProviderName,
        Pick<ProviderAdapter, "dispatch"> & Partial<Pick<ProviderAdapter, "measure">>
      >
    >
  >
}
export type StructuredStage = {
  readonly schema: z.ZodType
  readonly instruction: string
  readonly signal?: AbortSignal
  readonly sourceWindow?: { readonly blockId: string; readonly start: number; readonly end: number }
  readonly onValidated?: (job: RunningJob) => void
}

export class ProviderRunner {
  constructor(private readonly options: Options) {}
  async execute(job: RunningJob, stage: StructuredStage): Promise<Job> {
    const execution = this.options.storage.execution
    const lease = () => ({
      jobId: job.id,
      token: job.lease.token,
      fence: job.lease.fence,
      now: this.options.clock().toISOString(),
    })
    const fail = (code: string, retryable = false) => {
      const result = execution.failProviderJob({ lease: lease(), code, retryable })
      const pause = execution.providerPause(job.id)
      if (pause) console.info(JSON.stringify({ event: "provider-paused", jobId: job.id, ...pause }))
      return result
    }
    try {
      let schema: Record<string, unknown>
      try {
        schema = z.toJSONSchema(stage.schema, { reused: "ref" })
      } catch (error) {
        if (error instanceof Error) return fail("unsupported-schema")
        throw error
      }
      while (true) {
        const current = execution.getJob(job.id)
        if (current?.state !== "running") throw new ProviderError("unauthorized")
        const identityFields = [
          "runId",
          "inputRevisionId",
          "setupRevisionId",
          "provider",
          "model",
          "promptVersion",
          "schemaVersion",
          "stage",
        ] as const
        if (
          identityFields.some((field) => current[field] !== job[field]) ||
          current.grant.id !== job.grant.id
        )
          throw new ProviderError("unauthorized")
        if (stage.signal?.aborted && !current.cancellationRequested)
          execution.requestCancellation({ jobId: job.id })
        if (current.cancellationRequested || stage.signal?.aborted)
          return execution.cancelClaimedJob(lease())
        const { setup, blocks: approvedBlocks } = authorizeSource(this.options, current)
        const currentGrant = this.options.storage.sources.getGrant(current.grant.id)
        if (
          job.stage !== "analysis" &&
          (currentGrant?.kind !== "active" ||
            !currentGrant.categories.includes("derived-study-material") ||
            (job.stage !== "questions" && !currentGrant.categories.includes("reader-context")) ||
            job.promptVersion !== setup.generation.promptVersion ||
            job.schemaVersion !== setup.generation.schemaVersion)
        )
          throw new ProviderError("unauthorized")
        const window = stage.sourceWindow
        const blocks = window
          ? approvedBlocks
              .filter((block) => block.blockId === window.blockId)
              .map((block) => {
                if (
                  !Number.isInteger(window.start) ||
                  !Number.isInteger(window.end) ||
                  window.start < 0 ||
                  window.end <= window.start ||
                  window.end > block.text.length
                )
                  throw new ProviderError("input-limit")
                return {
                  ...block,
                  text: block.text.slice(window.start, window.end),
                  start: window.start,
                  end: window.end,
                }
              })
          : approvedBlocks
        if (blocks.length === 0) throw new ProviderError("unauthorized")
        const adapter = this.options.adapters[job.provider]
        if (!adapter) throw new ProviderError("missing-credentials")
        const run = execution.getRun(job.runId)
        if (run?.state !== "running") throw new ProviderError("unauthorized")
        const approvedLimits = RunBudget.parse({})
        if (
          run.budget.maxCalls > approvedLimits.maxCalls ||
          run.budget.maxSourceCharacters > approvedLimits.maxSourceCharacters ||
          run.budget.maxOutputTokens > approvedLimits.maxOutputTokens
        )
          return fail("budget-limit")
        if (
          blocks.reduce((total, block) => total + block.text.length, 0) >
            run.budget.maxSourceCharacters ||
          (job.stage === "analysis" ? setup.analysis.settings : setup.generation.settings)
            .maxOutputTokens > run.budget.maxOutputTokens
        )
          throw new ProviderError("input-limit")
        const request: StructuredRequest = {
          model: job.model,
          settings: job.stage === "analysis" ? setup.analysis.settings : setup.generation.settings,
          prompt: `${stage.instruction}\n${JSON.stringify(blocks)}`,
          schema,
          signal: stage.signal ?? new AbortController().signal,
        }
        const bytes = adapter.measure
          ? await adapter.measure(request)
          : Buffer.byteLength(
              JSON.stringify({
                model: request.model,
                settings: request.settings,
                messages: [{ role: "user", content: request.prompt }],
                schema: request.schema,
                output_config: request.schema,
                response_format: request.schema,
              }),
              "utf8",
            ) + 4096
        if (bytes > MAX_PROVIDER_REQUEST_BYTES) throw new ProviderError("input-limit")
        const attempts = execution.listAttempts(job.runId)
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
            responseBody: new TextEncoder().encode(JSON.stringify(receipt)),
            usage: receipt.usage,
          })
        }
        if (execution.getJob(job.id)?.cancellationRequested)
          return execution.cancelClaimedJob(lease())
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
            let value: unknown
            try {
              value = JSON.parse(receipt.text)
            } catch (error) {
              if (!(error instanceof SyntaxError)) throw error
            }
            const parsed = stage.schema.safeParse(value)
            if (parsed.success) {
              stage.onValidated?.(job)
              return execution.completeJob({
                ...lease(),
                resultHash: contentDigest(JSON.stringify(parsed.data)),
              })
            }
            const outputs = execution.listAttempts(job.runId).filter((attempt) => {
              if (attempt.state !== "response-received") return false
              const body = execution.getAttemptReceipt(attempt.id)
              return (
                body !== null &&
                ProviderReceipt.parse(JSON.parse(new TextDecoder().decode(body))).kind === "output"
              )
            })
            if (outputs.length > run.budget.maxSchemaRepairs) return fail("malformed-output")
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
      if (error instanceof ProviderError) return fail(error.code)
      throw error
    }
  }
}
function assertNever(value: never): never {
  throw new TypeError(`Unsupported receipt: ${value}`)
}
