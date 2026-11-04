import {
  type NormalizationRevision,
  PreparationReview,
  preparationReasonKey,
  SourcePreparationFailure,
  type StudySetupRevision,
  VERIFICATION_ROOM_BYTES,
  VERIFICATION_ROOM_PREPROCESSING_VERSION,
} from "@reading-studio/contracts"
import { translate } from "@reading-studio/contracts/i18n"
import {
  bookMapRequestsFit,
  prepareBookMapScope,
  wholeBookFeasibility,
} from "@reading-studio/generation"
import { reviewedSourceBlocks, type VerifiedRouteCapacity } from "@reading-studio/providers"
import { sourcePage } from "@reading-studio/studio/source-viewer"
import type { Context } from "hono"
import { html } from "hono/html"
import type { AppEnvironment } from "./middleware/access.ts"
import type { SetupContextOptions } from "./study-setup-context.ts"

export async function preparationReview(
  options: SetupContextOptions,
  setup: StudySetupRevision,
  normalization: NormalizationRevision,
): Promise<PreparationReview | undefined> {
  if (
    setup.analysis.analysisPromptVersion === "analysis-1" &&
    setup.analysis.analysisSchemaVersion === "analysis-1"
  )
    return undefined
  const used = new Set(
    (options.storage?.execution.listSetupJobs(setup.id) ?? []).flatMap(
      (job) =>
        options.storage?.execution.listAttempts(job.runId).map((attempt) => attempt.id) ?? [],
    ),
  ).size
  const bound = Boolean(
    options.storage?.liveStudyGuard.target?.purpose &&
      options.storage.liveStudyGuard.includes(setup.id),
  )
  const study = options.sources
    .listStudiesByEdition(setup.editionId)
    .find((study) => study.id === setup.studyId)
  const cap = setup.analysis.purpose
    ? options.storage && study
      ? bound
        ? options.storage.liveStudyGuard.limit(setup.id)
        : Math.min(
            20,
            used +
              options.storage.liveStudyBudget.analysisAllowance(
                study.ownerId,
                setup.analysis.editionHash,
              ),
          )
      : 0
    : (options.storage?.liveStudyGuard.limit(setup.id) ?? 64)
  const result = await wholeBookFeasibility({
    setup,
    normalization,
    cap,
    used,
    ...(options.bookMapCapacity ? { capacity: options.bookMapCapacity } : {}),
  })
  const local = prepareBookMapScope(setup, normalization)
  return PreparationReview.parse({
    ...(setup.analysis.purpose
      ? { purpose: setup.analysis.purpose, purposeTargetBound: bound }
      : {}),
    state: result.kind === "ready" ? "ready" : "blocked",
    reason: result.kind === "limited" ? result.failure.coverage.reason : null,
    unsentRanges: result.kind === "limited" ? result.failure.coverage.unsentRanges : [],
    groupCount: local.kind === "ready" ? (local.groups?.length ?? 0) : 0,
    partCount:
      result.kind === "ready" ? result.windows.length : result.failure.coverage.requiredWindows,
    allowance:
      result.kind === "ready"
        ? result.allowance
        : (result.failure.coverage.allowance ?? {
            cap,
            used,
            remaining: Math.max(0, cap - used),
            plannedAttempts: 0,
            reservedLaterAttempts: setup.analysis.purpose ? 0 : 12,
            uncertainCounts: true,
          }),
    ...(setup.analysis.processing?.preprocessingVersion === VERIFICATION_ROOM_PREPROCESSING_VERSION
      ? {
          verificationRoom: {
            policy: VERIFICATION_ROOM_PREPROCESSING_VERSION,
            targetBytes: VERIFICATION_ROOM_BYTES,
            sampleOnly: true,
          },
        }
      : {}),
    ...(setup.batchedVerificationReserve
      ? {
          batchedMaximum: {
            reserveId: setup.batchedVerificationReserve.id,
            maxFindingBatches: setup.batchedVerificationReserve.maxFindingBatches,
            maxVerificationJobs: setup.batchedVerificationReserve.maxVerificationJobs,
            maxAnalysisJobs: setup.batchedVerificationReserve.maxAnalysisJobs,
            maxAnalysisAttempts: setup.batchedVerificationReserve.maxAnalysisJobs * 2,
            reservedLaterAttempts: setup.batchedVerificationReserve.reservedLaterAttempts,
            maxTotalAttempts: setup.batchedVerificationReserve.plannedAttempts,
            outputFitGuaranteed: false,
            refusalLimits: [
              "A whole-map omission review or indivisible finding/citation may not fit after generation.",
              "Finding-batch excess refuses without expanding the approved allowance or replanning evidence.",
            ],
          },
        }
      : {}),
  })
}

export async function preflightStudyDecision(
  context: Context<AppEnvironment>,
  input: {
    readonly setup: StudySetupRevision
    readonly normalization: NormalizationRevision
    readonly decision: "send" | "revise" | "cancel"
    readonly capacity?: VerifiedRouteCapacity
    readonly cap?: number
    readonly used?: number
  },
): Promise<Response | undefined> {
  switch (input.decision) {
    case "revise":
    case "cancel":
      return undefined
    case "send":
      break
    default:
      return assertNever(input.decision)
  }
  const whole =
    input.setup.analysis.analysisPromptVersion !== "analysis-1" ||
    input.setup.analysis.analysisSchemaVersion !== "analysis-1"
  let scope = whole
    ? await wholeBookFeasibility({ ...input, cap: input.cap ?? 64, used: input.used ?? 0 })
    : prepareBookMapScope(input.setup, input.normalization)
  if (
    !whole &&
    scope.kind === "ready" &&
    !(await bookMapRequestsFit({ ...input, windows: scope.windows }))
  ) {
    scope = {
      kind: "limited",
      failure: SourcePreparationFailure.parse({
        error: "scope-limit",
        coverage: {
          transmission: "not-sent",
          reason: "request-byte-limit",
          requiredWindows: scope.windows.length,
          maxWindows: 128,
          unsentRanges: reviewedSourceBlocks(input.setup, input.normalization).map((block) => ({
            resourcePath: block.resourcePath,
            blockId: block.blockId,
            start: block.start,
            end: block.end,
            ...(block.locator ? { locator: block.locator } : {}),
            ...(block.pageLabel ? { pageLabel: block.pageLabel } : {}),
            ...(block.originalFragment ? { originalFragment: block.originalFragment } : {}),
          })),
        },
      }),
    }
  }
  switch (scope.kind) {
    case "ready":
      return undefined
    case "limited": {
      context.header("X-Preparation-Refusal", scope.failure.coverage.reason)
      if (context.req.path.startsWith("/api/")) return context.json(scope.failure, 422)
      const coverage = scope.failure.coverage
      const locale = context.req.query("lang") === "ja" ? "ja" : "en"
      const title = translate(locale, "setup.refusal.title")
      const reason = translate(locale, preparationReasonKey(coverage.reason))
      return context.html(
        sourcePage(
          title,
          html`<h1>${title}</h1><p>${translate(locale, "setup.refusal.reason", { reason, required: coverage.requiredWindows, max: coverage.maxWindows })} <code>${coverage.reason}</code></p><p>${translate(locale, "setup.refusal.body")}</p><p>${translate(locale, "setup.batched.windowBudget")}</p><h2>${translate(locale, "setup.refusal.unsent")}</h2><ul>${coverage.unsentRanges.map((range) => html`<li>${range.resourcePath} · ${range.blockId} · UTF-16 [${range.start}, ${range.end})</li>`)}</ul><a href="/sources/${input.normalization.id}/setup?lang=${locale}">${translate(locale, "setup.back")}</a>`,
          locale,
        ),
        422,
      )
    }
    default:
      return assertNever(scope)
  }
}
function assertNever(value: never): never {
  throw new TypeError(`Unexpected preparation: ${value}`)
}
