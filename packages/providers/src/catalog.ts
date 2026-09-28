import type { StudySetupRevision } from "@reading-studio/contracts"

export const modelChoices = [
  { provider: "openai", model: "gpt-4.1-mini", label: "OpenAI / GPT-4.1 mini" },
  { provider: "anthropic", model: "claude-sonnet-4-6", label: "Anthropic / Claude Sonnet 4.6" },
] as const
export type ProviderName = (typeof modelChoices)[number]["provider"]
export type Settings = StudySetupRevision["analysis"]["settings"]
export class ProviderError extends Error {
  override readonly name = "ProviderError"
  constructor(
    readonly code:
      | "missing-credentials"
      | "unsupported-model"
      | "unsupported-settings"
      | "outcome-unknown"
      | "unauthorized"
      | "input-limit",
  ) {
    super(code)
  }
}
export function validateModel(provider: ProviderName, model: string, settings: Settings) {
  if (!modelChoices.some((choice) => choice.provider === provider && choice.model === model))
    throw new ProviderError("unsupported-model")
  if (
    settings.temperature !== 0 ||
    settings.topP !== 1 ||
    settings.seed !== null ||
    settings.reasoningEffort !== "default" ||
    settings.maxOutputTokens > 6000
  )
    throw new ProviderError("unsupported-settings")
}

export const defaultSettings: Settings = {
  temperature: 0,
  topP: 1,
  seed: null,
  reasoningEffort: "default",
  maxOutputTokens: 6000,
}
