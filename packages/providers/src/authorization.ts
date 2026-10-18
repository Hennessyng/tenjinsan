import {
  type Job,
  JobAuthorization,
  type NormalizationRevision,
  NormalizedStudySetup,
  type StudySetupRevision,
  TransmissionAuthorization,
} from "@reading-studio/contracts"
import type { Storage } from "@reading-studio/storage"
import { ProviderError, validateModel } from "./catalog.ts"

export type ProviderAuthority = {
  readonly storage: Storage
  readonly installationId: string
  readonly ownerId: string
}
export function authorizeSource(authority: ProviderAuthority, job: Job) {
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
