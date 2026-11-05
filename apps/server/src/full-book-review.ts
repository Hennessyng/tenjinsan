import { contentDigest } from "@reading-studio/contracts"
import type { Storage } from "@reading-studio/storage"
import { type FullBookPreparationOptions, prepareFullBook } from "./full-book-preparation.ts"
import { type FullBookServerRuntime, inspectFullBookRuntime } from "./full-book-runtime.ts"

export function reviewFullBook(
  deps: Readonly<{ storage: Storage; runtime: FullBookServerRuntime | undefined }>,
  scope: Readonly<{ owner: string; setupId: string }>,
  options: FullBookPreparationOptions,
) {
  const prepared = prepareFullBook(deps.storage, scope, options),
    runtime = inspectFullBookRuntime(deps.runtime, options)
  const consent = runtime
    ? {
        runtimeBinding: runtime.binding,
        recipientBinding: prepared.summary.route.binding,
        planBinding: contentDigest(JSON.stringify(prepared.session.plan)),
        omissionsHash: contentDigest(JSON.stringify(prepared.summary.source.omissions)),
        maxAttempts: prepared.session.plan.maxAttempts,
        priorSpent: prepared.summary.budget.spent,
        priorUnknown: prepared.summary.budget.unknown,
        priorUsageUnknown: prepared.summary.budget.usageUnknown,
        priorHeld: prepared.summary.budget.held,
        sourceVersion: prepared.summary.budget.sourceVersion,
        sourceCeiling: prepared.summary.budget.sourceCeiling,
        coverage: prepared.summary.source.coverage,
        omissionCount: prepared.summary.source.omissions.length,
      }
    : null
  return {
    ...prepared,
    runtime,
    summary: {
      ...prepared.summary,
      canConsent:
        Boolean(runtime) &&
        prepared.summary.budget.fits &&
        prepared.summary.budget.activeConsents === 0 &&
        prepared.summary.budget.pending === 0 &&
        prepared.summary.budget.awaitingOwner === 0,
      route: { ...prepared.summary.route, recipient: prepared.session.destination },
      runtime: { ...prepared.summary.runtime, build: runtime?.public ?? null },
      consent,
    },
    reviewBinding: contentDigest(
      JSON.stringify({ review: prepared.reviewBinding, runtime: runtime?.binding ?? null }),
    ),
  }
}
