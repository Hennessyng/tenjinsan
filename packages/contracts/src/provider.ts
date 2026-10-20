import { z } from "zod"
import { SubscriptionProvider } from "./subscriptions.ts"

export const Provider = z.enum([
  "openai",
  "anthropic",
  "openrouter",
  "codex",
  ...SubscriptionProvider.options,
])
