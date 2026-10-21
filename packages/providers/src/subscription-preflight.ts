import {
  isSubscriptionProvider,
  type Job,
  JobAuthorization,
  sameSubscriptionDestination,
  subscriptionDestination,
  TransmissionAuthorization,
} from "@reading-studio/contracts"
import { SubscriptionLoginError } from "@reading-studio/storage"
import type { ProviderAuthority } from "./authorization.ts"
import { ProviderError } from "./catalog.ts"

export async function preflightSubscription(authority: ProviderAuthority, job: Job): Promise<void> {
  if (!isSubscriptionProvider(job.provider)) return
  const { storage, installationId, ownerId } = authority
  const setup = storage.sources.getSetup(job.setupRevisionId)
  const grant = storage.sources.getGrant(job.grant.id)
  const authorization = TransmissionAuthorization.safeParse({
    setup,
    grant,
    installationId,
    ownerId,
    categories: ["book-text"],
  })
  if (
    !authorization.success ||
    !JobAuthorization.safeParse({ job, authorization: authorization.data }).success
  )
    throw new ProviderError("unauthorized")
  const destination = authorization.data.setup.analysis.destination
  if (
    !destination ||
    storage.subscriptionConnections.revision(installationId, job.provider) !==
      destination.connectionRevision
  )
    throw new ProviderError("subscription-connection-changed")
  if (storage.sources.getLatestSetup(authorization.data.setup.studyId)?.id !== job.setupRevisionId)
    throw new ProviderError("unauthorized")
  const login = {
    "chatgpt-subscription": storage.subscriptionLogin,
    "grok-subscription": storage.grokSubscriptionLogin,
    "claude-subscription": null,
  }[job.provider]
  if (!authority.localSubscriptions || !login?.canDispatch(installationId))
    throw new ProviderError("subscription-unverified")
  if (
    destination.billingRoute !== "subscription-provider-managed" ||
    destination.executionPolicy !== "tool-managed-v1"
  )
    throw new ProviderError("subscription-connection-changed")
  try {
    const refreshed = await login.refresh(installationId)
    if (refreshed.connectionRevision !== destination.connectionRevision)
      throw new ProviderError("subscription-connection-changed")
    if (refreshed.status !== "connected" || job.provider === "claude-subscription")
      throw new ProviderError("subscription-unverified")
    const observed = subscriptionDestination(job.provider, installationId, refreshed)
    if (
      !observed ||
      !sameSubscriptionDestination(observed, destination) ||
      !refreshed.models.some((model) => model.model === job.model)
    )
      throw new ProviderError("subscription-connection-changed")
  } catch (error) {
    if (error instanceof SubscriptionLoginError) throw new ProviderError("subscription-unverified")
    throw error
  }
}
