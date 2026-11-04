import { authorizeSource, type ProviderAuthority } from "./authorization.ts"
import { ProviderError } from "./catalog.ts"
import {
  providerJobIdentityFields,
  type RunningProviderJob,
  type StructuredStage,
} from "./execution-contracts.ts"

export function currentProviderJob(authority: ProviderAuthority, captured: RunningProviderJob) {
  const current = authority.storage.execution.getJob(captured.id)
  if (
    current?.state !== "running" ||
    providerJobIdentityFields.some((field) => current[field] !== captured[field]) ||
    current.grant.id !== captured.grant.id ||
    JSON.stringify(current.foundationTask) !== JSON.stringify(captured.foundationTask)
  )
    throw new ProviderError("unauthorized")
  return current
}

export function authorizeStage(
  authority: ProviderAuthority,
  captured: RunningProviderJob,
  stage: StructuredStage,
) {
  const current = currentProviderJob(authority, captured)
  if (current.cancellationRequested) throw new ProviderError("unauthorized")
  const source = authorizeSource(authority, current)
  const grant = authority.storage.sources.getGrant(current.grant.id)
  if (
    (stage.derivedData?.length ?? 0) > 0 &&
    (grant?.kind !== "active" || !grant.categories.includes("derived-study-material"))
  )
    throw new ProviderError("unauthorized")
  if (
    current.stage !== "analysis" &&
    (grant?.kind !== "active" ||
      !grant.categories.includes("derived-study-material") ||
      (current.stage !== "questions" && !grant.categories.includes("reader-context")) ||
      current.promptVersion !== source.setup.generation.promptVersion ||
      current.schemaVersion !== source.setup.generation.schemaVersion)
  )
    throw new ProviderError("unauthorized")
  return source
}
