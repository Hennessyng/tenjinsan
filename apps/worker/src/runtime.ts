import type { Digest, ExternalAttempt, GenerationRun, Job } from "@reading-studio/contracts"
import type { ProviderRunner, StructuredStage } from "@reading-studio/providers"
import { MaintenancePausedError, type Storage } from "@reading-studio/storage"

export type ProviderDispatch = {
  readonly job: Extract<Job, { readonly state: "running" }>
  readonly attempt: Extract<ExternalAttempt, { readonly state: "dispatching" }>
  readonly maxRetries: 0
}

export type ProviderResponse = {
  readonly responseBody: Uint8Array
  readonly usage: Extract<ExternalAttempt, { readonly state: "response-received" }>["usage"]
}

export interface ExternalProvider {
  dispatch(input: ProviderDispatch): Promise<ProviderResponse>
}

export type LocalStageContext = {
  readonly job: Extract<Job, { readonly state: "running" }>
  readonly saveCheckpoint: (checkpoint: Digest) => void
}

export type StageHandler =
  | {
      readonly kind: "structured"
      readonly runner: ProviderRunner
      readonly request: StructuredStage
    }
  | {
      readonly kind: "local"
      readonly execute: (context: LocalStageContext) => Digest | Promise<Digest>
    }
  | {
      readonly kind: "external"
      readonly provider: ExternalProvider
      readonly validate: (responseBody: Uint8Array) => Digest | Promise<Digest>
    }

export type WorkerRunResult =
  | { readonly kind: "provider"; readonly job: Job }
  | { readonly kind: "idle" }
  | { readonly kind: "paused"; readonly run: GenerationRun }
  | { readonly kind: "cancelled"; readonly job: Job }
  | { readonly kind: "completed"; readonly job: Job }

export type WorkerRuntimeOptions = {
  readonly storage: Storage
  readonly leaseDurationMs: number
  readonly clock: () => Date
  readonly tokenFactory: () => string
  readonly attemptIdFactory: (reservation: number) => string
  readonly signal?: AbortSignal
  readonly resolveStage: (job: Extract<Job, { readonly state: "running" }>) => StageHandler
}

export class WorkerRuntimeError extends Error {
  override readonly name = "WorkerRuntimeError"
}

function runningJob(job: Job | null): Extract<Job, { readonly state: "running" }> | null {
  return job?.state === "running" ? job : null
}

export class WorkerRuntime {
  constructor(private readonly options: WorkerRuntimeOptions) {}

  async runNext(): Promise<WorkerRunResult> {
    const admission = this.options.storage.maintenance.enter()
    if (admission === null) return { kind: "idle" }
    try {
      return await this.runAdmitted()
    } finally {
      this.options.storage.maintenance.leave(admission)
    }
  }

  private async runAdmitted(): Promise<WorkerRunResult> {
    const now = this.options.clock()
    const claimed = runningJob(
      this.options.storage.execution.claimNextJob({
        token: this.options.tokenFactory(),
        now: now.toISOString(),
        expiresAt: new Date(now.getTime() + this.options.leaseDurationMs).toISOString(),
      }),
    )
    if (claimed === null) return { kind: "idle" }
    if (this.options.storage.maintenance.active()) {
      this.options.storage.execution.releaseForMaintenance(this.lease(claimed))
      return { kind: "idle" }
    }
    const stage = this.options.resolveStage(claimed)
    let heartbeatError: unknown
    const heartbeat = setInterval(
      () => {
        try {
          const time = this.options.clock()
          this.options.storage.execution.heartbeatJob({
            ...this.lease(claimed),
            expiresAt: new Date(time.getTime() + this.options.leaseDurationMs).toISOString(),
          })
        } catch (error) {
          heartbeatError =
            error instanceof Error ? error : new WorkerRuntimeError("Heartbeat failed")
        }
      },
      Math.max(10, Math.floor(this.options.leaseDurationMs / 3)),
    )
    heartbeat.unref()
    try {
      let result: WorkerRunResult
      switch (stage.kind) {
        case "structured":
          result = {
            kind: "provider",
            job: await stage.runner.execute(claimed, {
              ...stage.request,
              ...(this.options.signal ? { signal: this.options.signal } : {}),
            }),
          }
          break
        case "local":
          result = await this.runLocal(claimed, stage)
          break
        case "external":
          result = await this.runExternal(claimed, stage)
          break
        default:
          return this.assertNever(stage)
      }
      if (heartbeatError) throw heartbeatError
      return result
    } catch (error) {
      if (!(error instanceof MaintenancePausedError)) throw error
      this.options.storage.execution.releaseForMaintenance(this.lease(claimed))
      return { kind: "idle" }
    } finally {
      clearInterval(heartbeat)
    }
  }

  private async runLocal(
    job: Extract<Job, { readonly state: "running" }>,
    stage: Extract<StageHandler, { readonly kind: "local" }>,
  ): Promise<WorkerRunResult> {
    const resultHash = await stage.execute({
      job,
      saveCheckpoint: (checkpoint) => {
        this.options.storage.execution.saveCheckpoint({ ...this.lease(job), checkpoint })
      },
    })
    const cancellation = this.cancelIfRequested(job)
    if (cancellation !== null) return cancellation
    return {
      kind: "completed",
      job: this.options.storage.execution.completeJob({ ...this.lease(job), resultHash }),
    }
  }

  private async runExternal(
    job: Extract<Job, { readonly state: "running" }>,
    stage: Extract<StageHandler, { readonly kind: "external" }>,
  ): Promise<WorkerRunResult> {
    const attempts = this.options.storage.execution.listAttempts(job.runId)
    const latest = attempts.at(-1)
    if (latest?.state === "response-received") {
      const responseBody = this.options.storage.execution.getAttemptReceipt(latest.id)
      if (responseBody === null) throw new WorkerRuntimeError("durable response receipt is missing")
      return this.validateAndComplete(job, stage, responseBody)
    }
    const prepared = latest?.state === "prepared" ? latest : this.prepareAttempt(job)
    if (prepared === null) {
      const run = this.options.storage.execution.getRun(job.runId)
      if (run === null) throw new WorkerRuntimeError("paused run is missing")
      return { kind: "paused", run }
    }
    if (this.options.storage.maintenance.active()) throw new MaintenancePausedError()
    const dispatched = this.options.storage.execution.markAttemptDispatching({
      ...this.lease(job),
      attemptId: prepared.id,
      dispatchedAt: this.options.clock().toISOString(),
    })
    if (dispatched.state !== "dispatching") {
      throw new WorkerRuntimeError("attempt did not enter dispatching")
    }
    const response = await stage.provider.dispatch({ job, attempt: dispatched, maxRetries: 0 })
    this.options.storage.execution.recordAttemptReceipt({
      ...this.lease(job),
      attemptId: dispatched.id,
      receivedAt: this.options.clock().toISOString(),
      responseBody: response.responseBody,
      usage: response.usage,
    })
    const cancellation = this.cancelIfRequested(job)
    if (cancellation !== null) return cancellation
    return this.validateAndComplete(job, stage, response.responseBody)
  }

  private prepareAttempt(
    job: Extract<Job, { readonly state: "running" }>,
  ): Extract<ExternalAttempt, { readonly state: "prepared" }> | null {
    const run = this.options.storage.execution.getRun(job.runId)
    if (run === null) throw new WorkerRuntimeError("generation run is missing")
    const result = this.options.storage.execution.reserveAttempt({
      ...this.lease(job),
      attemptId: this.options.attemptIdFactory(run.reservedCalls + 1),
      preparedAt: this.options.clock().toISOString(),
    })
    if (result.kind === "budget-exhausted") return null
    if (result.attempt.state !== "prepared") {
      throw new WorkerRuntimeError("attempt did not enter prepared")
    }
    return result.attempt
  }

  private async validateAndComplete(
    job: Extract<Job, { readonly state: "running" }>,
    stage: Extract<StageHandler, { readonly kind: "external" }>,
    responseBody: Uint8Array,
  ): Promise<WorkerRunResult> {
    const resultHash = await stage.validate(responseBody)
    const cancellation = this.cancelIfRequested(job)
    if (cancellation !== null) return cancellation
    return {
      kind: "completed",
      job: this.options.storage.execution.completeJob({ ...this.lease(job), resultHash }),
    }
  }

  private cancelIfRequested(
    job: Extract<Job, { readonly state: "running" }>,
  ): WorkerRunResult | null {
    const current = this.options.storage.execution.getJob(job.id)
    if (current?.state !== "running" || !current.cancellationRequested) return null
    return {
      kind: "cancelled",
      job: this.options.storage.execution.cancelClaimedJob(this.lease(job)),
    }
  }

  private lease(job: Extract<Job, { readonly state: "running" }>) {
    return {
      jobId: job.id,
      token: job.lease.token,
      fence: job.lease.fence,
      now: this.options.clock().toISOString(),
    }
  }

  private assertNever(value: never): never {
    throw new WorkerRuntimeError(`unsupported stage ${String(value)}`)
  }
}
