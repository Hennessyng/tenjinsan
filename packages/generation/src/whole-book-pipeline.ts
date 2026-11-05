import {
  AnalysisRevision,
  BATCHED_VERIFICATION_VERSION,
  batchedVerificationComplete,
  bookMapProjection,
  COVERAGE_VERIFICATION_VERSION,
  contentDigest,
  type Job,
  WholeBookPreparation,
  wholeBookCheckAccepted,
} from "@reading-studio/contracts"
import type { ProviderAuthority, StructuredStage } from "@reading-studio/providers"
import { ProviderError } from "@reading-studio/providers"
import { batchHasBlockingReceipt, prepareBatchedChecks } from "./batched-runtime.ts"
import { batchedRuntimeStage } from "./batched-runtime-stage.ts"
import { WholeBookContext } from "./whole-book-context.ts"
import { coverageVerificationStage, coverageVerificationTargets } from "./whole-book-coverage.ts"
import { requireCoverageCapacity } from "./whole-book-coverage-capacity.ts"
import { completedCoverageVerification } from "./whole-book-coverage-runtime.ts"
import {
  completedMaps,
  completedSynthesis,
  completedVerification,
  verificationTargets,
  wholeBookStage,
} from "./whole-book-stages.ts"

const rangeIdentity = ({
  resourcePath,
  blockId,
  start,
  end,
}: {
  readonly resourcePath: string
  readonly blockId: string
  readonly start: number
  readonly end: number
}) => ({ resourcePath, blockId, start, end })

export class WholeBookPipeline {
  constructor(private readonly authority: ProviderAuthority) {}
  prepare(setupId: string, grantId: string): AnalysisRevision {
    const context = new WholeBookContext(this.authority, setupId, grantId)
    if (context.setup.batchedVerificationReserve)
      return this.authority.storage.atomicWrite(() => this.prepareContext(context))
    return this.prepareContext(context)
  }
  private prepareContext(context: WholeBookContext): AnalysisRevision {
    const setupId = context.setup.id,
      grantId = context.grantId
    const { workflow } = this.authority.storage
    const cached = workflow.findSuccessfulAnalysis(context.key, { setupId, grantId })
    if (
      cached &&
      (!context.setup.batchedVerificationReserve ||
        (cached.wholeBook?.batched?.setupId === setupId &&
          cached.wholeBook.batched.grantId === grantId))
    )
      return cached
    const existing = context.scope.windows.some((_, index) => context.job("map", index))
    if (!existing) context.requireFeasible()
    for (const index of context.scope.windows.keys()) context.enqueue("map", index)
    const maps = completedMaps(context)
    const mapsComplete =
      maps.length === context.scope.windows.length && maps.every((map) => map.complete)
    if (mapsComplete) context.enqueue("synthesis")
    const synthesis = completedSynthesis(context)
    const coveragePolicy =
      context.setup.analysis.processing?.synthesisVersion === COVERAGE_VERIFICATION_VERSION
    const batchPolicy =
      context.setup.analysis.processing?.synthesisVersion === BATCHED_VERIFICATION_VERSION
    const batched = batchPolicy ? prepareBatchedChecks(context, { maps, synthesis }) : null
    if (synthesis?.complete && !batchPolicy) {
      const targets = coveragePolicy
        ? coverageVerificationTargets(context)
        : verificationTargets(context)
      const pending = [...targets.keys()].filter((index) => !context.job("verify", index))
      if (coveragePolicy && pending.length > 0) requireCoverageCapacity(context, pending)
      for (const index of pending) context.enqueue("verify", index)
    }
    const verification = batchPolicy
      ? []
      : synthesis?.complete && coveragePolicy
        ? completedCoverageVerification(context)
        : completedVerification(context)
    const jobs = this.authority.storage.execution
      .listSetupJobs(setupId)
      .filter((job) => job.grant.id === grantId && job.id.startsWith("wb-"))
    const flagged =
      verification.some((check) => !wholeBookCheckAccepted(check)) ||
      (batched ? batchHasBlockingReceipt(batched.state) : false)
    const blocked =
      flagged ||
      (batched?.refused !== null && batched?.refused !== undefined) ||
      maps.some((map) => !map.complete) ||
      synthesis?.complete === false ||
      jobs.some(
        (job) => job.state === "failed" || job.state === "cancelled" || job.state === "paused",
      )
    const complete =
      !blocked &&
      mapsComplete &&
      synthesis?.complete &&
      (batchPolicy
        ? !!batched?.state.manifest &&
          batchedVerificationComplete(batched.state.manifest, batched.state.receipts)
        : verification.length === maps.length + 1)
    const phase = blocked
      ? "blocked"
      : complete
        ? "complete"
        : synthesis
          ? "verifying"
          : mapsComplete
            ? "synthesizing"
            : "mapping"
    const wholeBook = WholeBookPreparation.parse({
      version: "whole-book-2",
      preprocessingVersion: context.setup.analysis.processing?.preprocessingVersion,
      synthesisVersion: context.setup.analysis.processing?.synthesisVersion,
      capacityId: context.capacity.id,
      phase,
      groups:
        context.scope.groups?.map((group) => ({
          ...group,
          ranges: group.ranges.map(rangeIdentity),
        })) ?? [],
      parts: context.scope.windows.map((window, index) => {
        const job = context.job("map", index)
        const attempts = job ? this.authority.storage.execution.listAttempts(job.runId) : []
        const status = maps.some((map) => map.partId === context.id("map", index) && map.complete)
          ? "complete"
          : job?.state === "failed" || job?.state === "cancelled"
            ? "failed"
            : job?.state === "paused"
              ? "uncertain"
              : attempts.some((attempt) => attempt.state !== "prepared")
                ? "transmitted"
                : job?.state === "running"
                  ? "pending"
                  : "unsent"
        return {
          id: context.id("map", index),
          groupId: window.groupId,
          ranges: (window.ranges ?? [window]).map(rangeIdentity),
          status,
        }
      }),
      maps,
      synthesis,
      verification,
      ...(batched ? { batched: batched.state } : {}),
      allowance: context.allowance(),
      limitations: [
        "Coverage is not proof of semantic exhaustiveness or live comprehension.",
        ...(batched?.refused
          ? [
              `Bounded batch verification refused: ${batched.refused}; no new allowance or source replan.`,
            ]
          : []),
        ...(flagged
          ? [
              "Blocking original-verification findings or material map omissions require review; no new question bank is usable.",
            ]
          : []),
        ...jobs
          .filter((job) => job.state === "failed")
          .map((job) => `Provider stage requires attention: ${job.error.code}`),
        ...(jobs.some((job) => job.state === "paused")
          ? ["Paused work requires the existing retry/stop or budget decision."]
          : []),
        ...this.normalizationOmissions(context),
      ],
      ...(context.setup.analysis.purpose && complete ? { terminal: "verified-analysis" } : {}),
    })
    const { claims, concepts, qualifications } = bookMapProjection(wholeBook)
    const record = AnalysisRevision.parse({
      id: `map-${contentDigest(JSON.stringify([context.key, wholeBook]))}`,
      editionId: context.setup.editionId,
      cacheInput: context.setup.analysis,
      cacheKey: context.key,
      status: complete ? "successful" : "partial",
      wholeBook,
      claims,
      concepts,
      qualifications,
      chapters: context.setup.analysis.scope.selected.map((selection) => ({
        ...selection,
        status: context.scope.windows.every(
          (window, index) =>
            !(window.ranges ?? [window]).some(
              (range) => range.resourcePath === selection.resourcePath,
            ) || maps.some((map) => map.partId === context.id("map", index) && map.complete),
        )
          ? "complete"
          : "pending",
      })),
    })
    return (
      workflow.getAnalysis(record.id) ?? workflow.appendAnalysis({ record, parentRevisionId: null })
    )
  }
  private normalizationOmissions(context: WholeBookContext) {
    return (context.normalization.omissions ?? []).map(
      (omission) => `Unavailable, not analyzed: ${omission.path} (${omission.reason})`,
    )
  }
  stage(job: Job): StructuredStage {
    const context = new WholeBookContext(this.authority, job.setupRevisionId, job.grant.id)
    const persisted = this.authority.storage.execution.getJob(job.id)
    if (
      !persisted ||
      persisted.cancellationRequested ||
      persisted.provider !== context.template.provider ||
      persisted.model !== context.template.model ||
      persisted.promptVersion !== context.template.promptVersion ||
      persisted.schemaVersion !== context.template.schemaVersion ||
      persisted.stage !== "analysis" ||
      persisted.grant.id !== job.grant.id ||
      job.provider !== persisted.provider ||
      job.model !== persisted.model ||
      job.promptVersion !== persisted.promptVersion ||
      job.schemaVersion !== persisted.schemaVersion
    )
      throw new ProviderError("unauthorized")
    if (context.setup.analysis.processing?.synthesisVersion === COVERAGE_VERIFICATION_VERSION)
      for (let index = 0; index <= context.scope.windows.length; index++)
        if (job.id === context.id("verify", index)) return coverageVerificationStage(context, index)
    if (context.setup.batchedVerificationReserve) {
      const state = this.authority.storage.workflow.findBatchedAnalysis(
        context.key,
        context.setup.id,
        context.grantId,
      )?.wholeBook?.batched
      if (state?.manifest)
        for (const [index, target] of state.manifest.targets.entries())
          if (job.id === context.id(`batch-${target.id}`, index))
            return batchedRuntimeStage(context, state.manifest, index)
    }
    return wholeBookStage(context, job.id)
  }
}
