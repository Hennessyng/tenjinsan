import {
  LocalSubscriptionProvider,
  type StudySetupRevision,
  subscriptionDestination,
} from "@reading-studio/contracts"
import type { Storage } from "@reading-studio/storage"

export function subscriptionChoices(storage: Storage | undefined, ownerId: string, local: boolean) {
  const installation = storage?.sources.getInstallation(ownerId)
  if (!local || !storage || !installation) return []
  return LocalSubscriptionProvider.options.flatMap((provider) => {
    const login =
      provider === "chatgpt-subscription"
        ? storage.subscriptionLogin
        : storage.grokSubscriptionLogin
    const state = login.status(installation)
    return login.canDispatch(installation)
      ? state.models.map((model) => ({
          provider,
          model: model.model,
          label: `${provider === "chatgpt-subscription" ? "ChatGPT" : "Grok"} subscription / ${model.label}`,
        }))
      : []
  })
}
export function selectedSubscription(
  storage: Storage | undefined,
  ownerId: string,
  provider: StudySetupRevision["analysis"]["provider"],
) {
  const parsed = LocalSubscriptionProvider.safeParse(provider)
  const installation = storage?.sources.getInstallation(ownerId)
  if (!parsed.success || !storage || !installation) return null
  const login =
    parsed.data === "chatgpt-subscription"
      ? storage.subscriptionLogin
      : storage.grokSubscriptionLogin
  if (!login.canDispatch(installation)) return null
  return subscriptionDestination(parsed.data, installation, login.status(installation))
}
export async function refreshSubscription(
  storage: Storage | undefined,
  ownerId: string,
  provider: StudySetupRevision["analysis"]["provider"],
) {
  const parsed = LocalSubscriptionProvider.safeParse(provider)
  const installation = storage?.sources.getInstallation(ownerId)
  if (parsed.success && storage && installation) {
    const login =
      parsed.data === "chatgpt-subscription"
        ? storage.subscriptionLogin
        : storage.grokSubscriptionLogin
    if (!login.canDispatch(installation)) return
    await login.refresh(installation)
  }
}
