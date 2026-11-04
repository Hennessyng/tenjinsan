import {
  isSubscriptionProvider,
  type Job,
  JobAuthorization,
  type NormalizationRevision,
  NormalizedStudySetup,
  type StudySetupRevision,
  sameSubscriptionDestination,
  subscriptionDestination,
  TransmissionAuthorization,
} from "@reading-studio/contracts"
import type { Storage } from "@reading-studio/storage"
import { ProviderError, validateModel } from "./catalog.ts"
import { requireManagedChatGPT } from "./inference-policy.ts"
import type { VerifiedRouteCapacity } from "./request-capacity.ts"

export type ProviderAuthority = {
  readonly storage: Storage
  readonly installationId: string
  readonly ownerId: string
  readonly localSubscriptions?: boolean
  readonly capacity?: VerifiedRouteCapacity
}
export function authorizeSource(authority: ProviderAuthority, job: Job) {
  const result = authorizeSetupSource(authority, job)
  try {
    authority.storage.liveStudyGuard.assertJob(job)
  } catch (error) {
    if (error instanceof Error) throw new ProviderError("unauthorized")
    throw error
  }
  return result
}
export function authorizeSetupSource(authority: ProviderAuthority, job: Job) {
  authority.storage.liveStudyGuard.assertActive(job.setupRevisionId)
  if (job.provider === "openai") throw new ProviderError("unauthorized")
  const sources = authority.storage.sources
  const setup = sources.getSetup(job.setupRevisionId)
  const grant = sources.getGrant(job.grant.id)
  const authorization = TransmissionAuthorization.safeParse({
    setup,
    grant,
    installationId: authority.installationId,
    ownerId: authority.ownerId,
    categories: ["book-text"],
  })
  if (
    !authorization.success ||
    !JobAuthorization.safeParse({ job, authorization: authorization.data }).success
  )
    throw new ProviderError("unauthorized")
  const approved = authorization.data.setup
  if (approved.analysis.analysisPromptVersion === "whole-book-2")
    requireManagedChatGPT(job.provider)
  if (isSubscriptionProvider(job.provider)) {
    const destination = approved.analysis.destination
    if (
      !destination ||
      authority.storage.subscriptionConnections.revision(authority.installationId, job.provider) !==
        destination.connectionRevision
    )
      throw new ProviderError("subscription-connection-changed")
    if (
      !authority.localSubscriptions ||
      job.provider === "claude-subscription" ||
      destination.executionPolicy !== "tool-managed-v1"
    )
      throw new ProviderError("subscription-unverified")
    const login =
      job.provider === "chatgpt-subscription"
        ? authority.storage.subscriptionLogin
        : authority.storage.grokSubscriptionLogin
    if (!login.canDispatch(authority.installationId))
      throw new ProviderError("subscription-unverified")
    const current = subscriptionDestination(
      job.provider,
      authority.installationId,
      login.status(authority.installationId),
    )
    if (!current || !sameSubscriptionDestination(current, destination))
      throw new ProviderError("subscription-connection-changed")
    if (!login.status(authority.installationId).models.some((model) => model.model === job.model))
      throw new ProviderError("unsupported-model")
  }
  if (sources.getLatestSetup(approved.studyId)?.id !== approved.id)
    throw new ProviderError("unauthorized")
  if (
    !sources
      .listStudiesByEdition(approved.editionId)
      .some((study) => study.id === approved.studyId && study.ownerId === authority.ownerId)
  )
    throw new ProviderError("unauthorized")
  const normalization = sources.getNormalization(approved.analysis.normalizationRevisionId)
  const linked = NormalizedStudySetup.safeParse({ setup: approved, normalization })
  if (!linked.success) throw new ProviderError("unauthorized")
  validateModel(job.provider, job.model, approved.analysis.settings)
  const blocks = reviewedSourceBlocks(approved, linked.data.normalization)
  return { setup: approved, blocks, normalization: linked.data.normalization }
}

export function reviewedSourceBlocks(
  setup: StudySetupRevision,
  normalization: NormalizationRevision,
) {
  return setup.analysis.scope.selected.flatMap((selection) => {
    const resource = normalization.resources.find(
      (resource) => resource.path === selection.resourcePath,
    )
    if (resource?.status !== "included") throw new ProviderError("unauthorized")
    return selection.blockIds.map((id) => {
      const block = resource.blocks.find((block) => block.id === id)
      if (!block) throw new ProviderError("unauthorized")
      return {
        resourcePath: resource.path,
        blockId: block.id,
        text: block.text,
        editionId: normalization.editionId,
        normalizationRevisionId: normalization.id,
        start: 0,
        end: block.text.length,
        ...(block.locator ? { locator: block.locator } : {}),
        ...(block.originalFragment ? { originalFragment: block.originalFragment } : {}),
        ...(block.pageLabel ? { pageLabel: block.pageLabel } : {}),
        ...(block.heading ? { heading: block.heading } : {}),
        ...(block.structure ? { structure: block.structure } : {}),
      }
    })
  })
}
