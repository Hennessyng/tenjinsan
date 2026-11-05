import {
  analysisCacheKey,
  BATCHED_VERIFICATION_VERSION,
  COVERAGE_VERIFICATION_VERSION,
  type CoverageVerificationTarget,
  contentDigest,
  Job,
  RunBudget,
  type StudySetupRevision,
  VERIFICATION_ROOM_PREPROCESSING_VERSION,
  validatedBatchedSetupSources,
} from "@reading-studio/contracts"
import {
  authorizeSetupSource,
  type ProviderAuthority,
  ProviderError,
  ProviderReceipt,
  requireRouteCapacity,
} from "@reading-studio/providers"
import type { z } from "zod"
import { batchedRuntimeAllowance } from "./batched-runtime-budget.ts"
import { BookMapError } from "./book-map-output.ts"
import { prepareBookMapScope } from "./book-map-scope.ts"
import { verificationRoomAssessment } from "./verification-room.ts"
import { wholeBookAllowance } from "./whole-book-feasibility.ts"
import { WHOLE_BOOK_VERSION } from "./whole-book-scope.ts"

export class WholeBookContext {
  readonly setup: StudySetupRevision
  readonly template: Job
  readonly key: string
  readonly scope: Extract<ReturnType<typeof prepareBookMapScope>, { kind: "ready" }>
  readonly capacity
  readonly normalization
  readonly approved
  constructor(
    readonly authority: ProviderAuthority,
    setupId: string,
    readonly grantId: string,
  ) {
    const setup = authority.storage.sources.getSetup(setupId)
    const grant = authority.storage.sources.getGrant(grantId)
    if (!setup || !grant) throw new ProviderError("unauthorized")
    this.setup = setup
    this.key = analysisCacheKey(setup.analysis)
    const id = this.id("authority")
    this.template = Job.parse({
      id,
      runId: id,
      inputRevisionId: id,
      setupRevisionId: setup.id,
      provider: setup.analysis.provider,
      model: setup.analysis.model,
      promptVersion: setup.analysis.analysisPromptVersion,
      schemaVersion: setup.analysis.analysisSchemaVersion,
      grant,
      stage: "analysis",
      checkpoint: null,
      cancellationRequested: false,
      usage: { kind: "known", inputTokens: 0, outputTokens: 0 },
      state: "queued",
    })
    const authorized = authorizeSetupSource(authority, this.template)
    if (grant.kind !== "active" || !grant.categories.includes("derived-study-material"))
      throw new ProviderError("unauthorized")
    if (
      setup.analysis.analysisPromptVersion !== WHOLE_BOOK_VERSION ||
      setup.analysis.analysisSchemaVersion !== WHOLE_BOOK_VERSION ||
      (setup.analysis.processing?.preprocessingVersion !== "packed-unicode-2" &&
        setup.analysis.processing?.preprocessingVersion !== "packed-capacity-3" &&
        setup.analysis.processing?.preprocessingVersion !== "batched-capacity-4" &&
        setup.analysis.processing?.preprocessingVersion !== "batched-room-5") ||
      (setup.analysis.processing.synthesisVersion !== "maps-original-check-2" &&
        setup.analysis.processing.synthesisVersion !== COVERAGE_VERIFICATION_VERSION &&
        setup.analysis.processing.synthesisVersion !== BATCHED_VERIFICATION_VERSION)
    )
      throw new ProviderError("unsupported-version")
    if (
      setup.analysis.processing.synthesisVersion === COVERAGE_VERIFICATION_VERSION &&
      setup.experimentalCoverageOptIn?.enabled !== true
    )
      throw new ProviderError("route-re-review-required")
    if (
      setup.analysis.processing.synthesisVersion === BATCHED_VERIFICATION_VERSION &&
      (!setup.batchedVerificationReserve ||
        setup.analysis.processing.batchReserveId !== setup.batchedVerificationReserve.id)
    )
      throw new ProviderError("route-re-review-required")
    this.capacity = requireRouteCapacity(setup, authority.capacity)
    if (setup.analysis.processing.capacityId !== this.capacity.id)
      throw new ProviderError("capacity-unknown")
    if (setup.analysis.scope.kind !== "whole-document") throw new ProviderError("unauthorized")
    if (
      (setup.analysis.processing.preprocessingVersion === "packed-capacity-3" ||
        setup.analysis.processing.preprocessingVersion === "batched-capacity-4" ||
        setup.analysis.processing.preprocessingVersion === "batched-room-5") &&
      !setup.analysis.processing.plan
    )
      throw new ProviderError("analysis-incomplete")
    this.normalization = authorized.normalization
    this.approved = authorized.blocks
    const scope = prepareBookMapScope(setup, this.normalization)
    if (scope.kind !== "ready") throw new ProviderError("input-limit")
    this.scope = scope
    if (
      setup.analysis.processing.preprocessingVersion === VERIFICATION_ROOM_PREPROCESSING_VERSION
    ) {
      const windows = validatedBatchedSetupSources(setup, this.normalization)
      for (const [index, originals] of windows.entries()) {
        const groupId = scope.windows[index]?.groupId
        if (
          !groupId ||
          !verificationRoomAssessment(
            { setup, normalization: this.normalization, capacity: this.capacity },
            { originals, groupId },
          ).fits
        )
          throw new ProviderError("capacity-limit")
      }
    }
  }

  id(kind: string, index = 0): string {
    return `wb-${contentDigest(JSON.stringify([this.setup.id, this.grantId, this.key, kind, index]))}`
  }
  job(kind: string, index = 0) {
    return this.authority.storage.execution.getJob(this.id(kind, index))
  }
  allowance() {
    if (this.setup.batchedVerificationReserve)
      return batchedRuntimeAllowance(this, this.setup.batchedVerificationReserve)
    const { execution, liveStudyGuard } = this.authority.storage
    const jobs = execution.listSetupJobs(this.setup.id)
    const used = new Set(
      jobs.flatMap((job) => execution.listAttempts(job.runId).map((attempt) => attempt.id)),
    ).size
    const cap = Math.min(64, liveStudyGuard.limit(this.setup.id))
    const done = jobs.filter((job) => job.state === "completed" && job.id.startsWith("wb-")).length
    return wholeBookAllowance({ windows: this.scope.windows.length, cap, used, completed: done })
  }
  requireFeasible() {
    const allowance = this.allowance()
    if (allowance.plannedAttempts > allowance.remaining)
      throw new ProviderError("attempt-budget-limit")
    return allowance
  }
  enqueue(
    kind: string,
    index = 0,
    manifest?: import("@reading-studio/contracts").BatchedVerificationManifest,
  ): Job {
    const { execution, workflow } = this.authority.storage
    const existing = this.job(kind, index)
    if (existing) return existing
    const reserve = this.setup.batchedVerificationReserve
    if (
      reserve &&
      this.authority.storage.execution
        .listSetupJobs(this.setup.id)
        .filter((job) => job.stage === "analysis" && job.grant.id === this.grantId).length >=
        reserve.maxAnalysisJobs
    )
      throw new ProviderError("attempt-budget-limit")
    this.requireFeasible()
    const id = this.id(kind, index)
    const inputRevisionId = workflow.ensureAnalysisInput(this.setup.id)
    if (!execution.getRun(id))
      execution.appendRun({
        id,
        inputRevisionId,
        budget: RunBudget.parse({ maxCalls: 2, maxSchemaRepairs: 1, maxSourceCharacters: 32000 }),
        reservedCalls: 0,
        state: "running",
      })
    const foundationTask = this.setup.analysis.purpose
      ? kind === "map"
        ? { kind: "map" as const, index }
        : kind === "synthesis"
          ? { kind: "synthesis" as const }
          : manifest
            ? { kind: "verification" as const, index, manifest }
            : null
      : undefined
    if (foundationTask === null) throw new ProviderError("unauthorized")
    return execution.appendJob({
      ...this.template,
      id,
      runId: id,
      inputRevisionId,
      ...(foundationTask ? { foundationTask } : {}),
    })
  }
  output<T extends z.ZodType>(
    kind: string,
    schema: T,
    index = 0,
  ): {
    readonly data: z.infer<T>
    readonly strategy?: "complete-maps" | "complete-maps-and-original"
    readonly verificationTarget?: CoverageVerificationTarget
    readonly batchTarget?: NonNullable<ProviderReceipt["batchTarget"]>
    readonly batchManifestHash?: NonNullable<ProviderReceipt["batchManifestHash"]>
    readonly inputCoverage?: NonNullable<ProviderReceipt["inputCoverage"]>
  } | null {
    const job = this.job(kind, index)
    if (job?.state !== "completed") return null
    const attempt = this.authority.storage.execution.listAttempts(job.runId).at(-1)
    const receipt = attempt ? this.authority.storage.execution.getAttemptReceipt(attempt.id) : null
    if (!receipt) throw new BookMapError("missing-receipt")
    const result = ProviderReceipt.parse(JSON.parse(new TextDecoder().decode(receipt)))
    if (result.kind !== "output") throw new BookMapError("missing-receipt")
    const data = schema.parse(JSON.parse(result.text))
    if (contentDigest(JSON.stringify(data)) !== job.resultHash)
      throw new BookMapError("missing-receipt")
    return {
      data,
      ...(result.processingStrategy ? { strategy: result.processingStrategy } : {}),
      ...(result.verificationTarget ? { verificationTarget: result.verificationTarget } : {}),
      ...(result.batchTarget ? { batchTarget: result.batchTarget } : {}),
      ...(result.batchManifestHash ? { batchManifestHash: result.batchManifestHash } : {}),
      ...(result.inputCoverage ? { inputCoverage: result.inputCoverage } : {}),
    }
  }
}
