import { NormalizationRevisionId, type StudySetupRevision } from "@reading-studio/contracts"
import { translate, type UiLocale } from "@reading-studio/contracts/i18n"
import { configuredCredential } from "@reading-studio/providers"
import type { SourceRepository, Storage } from "@reading-studio/storage"
import { setupResult } from "@reading-studio/studio/study-setup"
import { offeredModels } from "./provider-connections.ts"
import { subscriptionChoices } from "./subscription-setup.ts"

export type SetupContextOptions = {
  readonly sources: SourceRepository
  readonly storage?: Storage
  readonly localSubscriptions?: boolean
  readonly available?: (provider: "openai" | "anthropic" | "openrouter" | "codex") => boolean
}
export function createSetupContext(options: SetupContextOptions) {
  const choices = async (ownerId: string) => [
    ...(await offeredModels(options.storage, ownerId)),
    ...subscriptionChoices(options.storage, ownerId, options.localSubscriptions ?? false),
  ]
  const available = async (
    provider: StudySetupRevision["analysis"]["provider"],
    model: string,
    ownerId: string,
  ) =>
    provider !== "openai" &&
    (await choices(ownerId)).some(
      (choice) => choice.provider === provider && choice.model === model,
    ) &&
    (provider !== "anthropic" ||
      (options.available?.(provider) ?? configuredCredential(provider) !== undefined))
  const owned = (revision: string, ownerId: string) => {
    const parsed = NormalizationRevisionId.safeParse(revision)
    if (!parsed.success) return null
    const normalization = options.sources.getNormalization(parsed.data)
    if (!normalization) return null
    const study = options.sources
      .listStudiesByEdition(normalization.editionId)
      .find((study) => study.ownerId === ownerId)
    return study ? { normalization, study } : null
  }
  const unavailable = (revision: string, locale: UiLocale = "en") =>
    setupResult({
      title: translate(locale, "setup.unavailable"),
      message: translate(locale, "setup.stale"),
      revision,
      locale,
    })
  return { choices, available, owned, unavailable }
}
