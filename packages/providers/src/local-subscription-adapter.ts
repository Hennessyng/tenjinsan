import {
  type Job,
  LocalSubscriptionProvider,
  sameSubscriptionDestination,
  subscriptionDestination,
} from "@reading-studio/contracts"
import { SubscriptionLoginError } from "@reading-studio/storage"
import { z } from "zod"
import type { StructuredRequest } from "./adapter.ts"
import { authorizeSource, type ProviderAuthority } from "./authorization.ts"
import { ProviderError, validateModel } from "./catalog.ts"
import { dispatchLocalCodex } from "./local-codex-dispatch.ts"
import { dispatchLocalGrok } from "./local-grok-dispatch.ts"
import { localRequestBytes } from "./local-tool-request.ts"
import type { ProviderReceipt } from "./provider-receipt.ts"

export class LocalSubscriptionAdapter {
  constructor(
    private readonly authority: ProviderAuthority,
    private readonly job: Job,
  ) {}
  async measure(request: StructuredRequest): Promise<number> {
    return localRequestBytes(LocalSubscriptionProvider.parse(this.job.provider), request)
  }
  async dispatch(request: StructuredRequest): Promise<ProviderReceipt> {
    if (!this.authority.localSubscriptions) throw new ProviderError("subscription-unverified")
    const provider = LocalSubscriptionProvider.parse(this.job.provider)
    const { storage, installationId } = this.authority
    const login = {
      "chatgpt-subscription": storage.subscriptionLogin,
      "grok-subscription": storage.grokSubscriptionLogin,
    }[provider]
    let sent = false
    try {
      return await login.withSession(installationId, async (session) => {
        const { setup } = authorizeSource(this.authority, this.job)
        const destination = subscriptionDestination(provider, installationId, session.state)
        if (!sameSubscriptionDestination(destination ?? undefined, setup.analysis.destination))
          throw new ProviderError("subscription-connection-changed")
        if (
          request.model !== setup.analysis.model ||
          !session.state.models.some((model) => model.model === request.model)
        )
          throw new ProviderError("unsupported-model")
        validateModel(provider, request.model, request.settings)
        if (localRequestBytes(provider, request) > 32000) throw new ProviderError("input-limit")
        const revoked = new AbortController()
        const signal = AbortSignal.any([request.signal, revoked.signal])
        const guard = setInterval(() => {
          if (!session.rpc.active) {
            revoked.abort()
            return
          }
          const current = storage.execution.getJob(this.job.id)
          if (
            storage.sources.getGrant(this.job.grant.id)?.kind !== "active" ||
            current?.state !== "running" ||
            current.cancellationRequested
          ) {
            revoked.abort()
            session.rpc.stop()
          }
        }, 100)
        guard.unref()
        try {
          sent = true
          const input = { ...request, signal }
          const authorize = () => {
            if (!session.rpc.profileAllowed()) throw new ProviderError("subscription-unverified")
            if (session.rpc.clientRequestRejected)
              throw new ProviderError("subscription-unverified")
            authorizeSource(this.authority, this.job)
            const current = storage.execution.getJob(this.job.id)
            if (current?.state !== "running" || current.cancellationRequested || signal.aborted)
              throw new ProviderError("unauthorized")
          }
          let receipt: ProviderReceipt
          switch (provider) {
            case "chatgpt-subscription":
              receipt = await dispatchLocalCodex(session, input, authorize)
              break
            case "grok-subscription":
              receipt = await dispatchLocalGrok(session, input, authorize)
              break
            default:
              return assertNever(provider)
          }
          authorizeSource(this.authority, this.job)
          return receipt
        } finally {
          clearInterval(guard)
        }
      })
    } catch (error) {
      if (error instanceof SubscriptionLoginError || error instanceof z.ZodError)
        throw new ProviderError(sent ? "outcome-unknown" : "subscription-unverified")
      throw error
    }
  }
}
function assertNever(value: never): never {
  throw new TypeError(`Unknown local provider: ${value}`)
}
