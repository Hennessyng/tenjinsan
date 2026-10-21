import {
  isSubscriptionProvider,
  type NormalizationRevision,
  SetupSchedulingFailure,
  type StudySetupRevision,
  sameSubscriptionDestination,
} from "@reading-studio/contracts"
import { translate } from "@reading-studio/contracts/i18n"
import { ProviderError } from "@reading-studio/providers"
import { setupResult } from "@reading-studio/studio/study-setup"
import type { Context } from "hono"
import type { AppEnvironment } from "./middleware/access.ts"
import { preflightStudyDecision } from "./study-preparation.ts"
import type { createSetupContext, SetupContextOptions } from "./study-setup-context.ts"
import {
  refreshSubscription,
  selectedSubscription,
  subscriptionChoices,
} from "./subscription-setup.ts"
import { hasForwardedHeaders } from "./subscriptions.ts"

export function subscriptionSendRefusal(
  context: Context<AppEnvironment>,
  options: Pick<SetupContextOptions, "storage" | "localSubscriptions">,
  setup: StudySetupRevision,
): SetupSchedulingFailure | null {
  if (!isSubscriptionProvider(setup.analysis.provider)) return null
  if (!options.localSubscriptions || hasForwardedHeaders(context.req.raw.headers))
    return "local-only"
  if (
    !sameSubscriptionDestination(
      selectedSubscription(options.storage, context.get("ownerId"), setup.analysis.provider) ??
        undefined,
      setup.analysis.destination,
    )
  )
    return "subscription-connection-changed"
  if (
    !subscriptionChoices(options.storage, context.get("ownerId"), true).some(
      (choice) =>
        choice.provider === setup.analysis.provider && choice.model === setup.analysis.model,
    )
  )
    return "unsupported-model"
  return null
}

export async function checkSetupSend(
  context: Context<AppEnvironment>,
  options: Omit<SetupContextOptions, "available"> & {
    readonly available: ReturnType<typeof createSetupContext>["available"]
  },
  input: { readonly setup: StudySetupRevision; readonly normalization: NormalizationRevision },
): Promise<{
  readonly code: SetupSchedulingFailure
  readonly response: Response | Promise<Response>
} | null> {
  const locale = context.req.query("lang") === "ja" ? "ja" : "en"
  const refuse = (code: SetupSchedulingFailure, status: 403 | 409 | 503) => ({
    code,
    response: context.req.path.startsWith("/api/")
      ? context.json({ error: code, transmission: "not-sent" }, status)
      : context.html(
          setupResult({
            title: translate(locale, "setup.unavailable"),
            message: translate(locale, "setup.schedulingBlocked", { code }),
            revision: input.setup.analysis.normalizationRevisionId,
            locale,
          }),
          status,
        ),
  })
  try {
    if (isSubscriptionProvider(input.setup.analysis.provider)) {
      if (!options.localSubscriptions || hasForwardedHeaders(context.req.raw.headers))
        return refuse("local-only", 403)
      await refreshSubscription(
        options.storage,
        context.get("ownerId"),
        input.setup.analysis.provider,
      )
      const currentRefusal = subscriptionSendRefusal(context, options, input.setup)
      if (currentRefusal) return refuse(currentRefusal, 409)
    }
    const preparation = await preflightStudyDecision(context, { ...input, decision: "send" })
    if (preparation)
      return {
        code: SetupSchedulingFailure.parse(preparation.headers.get("X-Preparation-Refusal")),
        response: preparation,
      }
    if (
      !(await options.available(
        input.setup.analysis.provider,
        input.setup.analysis.model,
        context.get("ownerId"),
      ))
    )
      return refuse(
        isSubscriptionProvider(input.setup.analysis.provider)
          ? "unsupported-model"
          : "provider-unavailable",
        503,
      )
    return null
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error
    return refuse(SetupSchedulingFailure.parse(error.code), 409)
  }
}
