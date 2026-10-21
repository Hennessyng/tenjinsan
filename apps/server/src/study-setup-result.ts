import { type StudySetupRevision, setupDecisionHeading } from "@reading-studio/contracts"
import { translate, type UiLocale } from "@reading-studio/contracts/i18n"
import type { Storage } from "@reading-studio/storage"
import { setupResult } from "@reading-studio/studio/study-setup"
import type { Context } from "hono"
import type { AppEnvironment } from "./middleware/access.ts"
import { subscriptionSendRefusal } from "./study-send-guards.ts"
import { savedSetupDecision } from "./study-setup-send.ts"

export function setupDecisionResponse(
  context: Context<AppEnvironment>,
  input: {
    readonly decision: "send" | "revise" | "cancel"
    readonly setup: StudySetupRevision
    readonly grantId: string
    readonly storage: Storage | undefined
    readonly locale: UiLocale
    readonly localSubscriptions?: boolean
  },
): Response | Promise<Response> {
  const revision = input.setup.analysis.normalizationRevisionId
  const json = context.req.path.startsWith("/api/")
  switch (input.decision) {
    case "revise":
      return json
        ? context.json({ decision: "revise" as const })
        : context.redirect(`/sources/${revision}/setup?lang=${input.locale}`, 303)
    case "cancel":
      return json
        ? context.json({ decision: "cancel" as const })
        : context.html(
            setupResult({
              title: translate(input.locale, "setup.cancelled"),
              message: translate(input.locale, "setup.cancelledNote"),
              revision,
              locale: input.locale,
            }),
          )
    case "send": {
      const persisted = savedSetupDecision(input.storage, input.setup, input.grantId)
      const refusal = subscriptionSendRefusal(
        context,
        {
          ...(input.storage ? { storage: input.storage } : {}),
          localSubscriptions: input.localSubscriptions ?? false,
        },
        input.setup,
      )
      const result = refusal
        ? { ...persisted, schedulingFailure: refusal, canResume: false }
        : persisted
      return json
        ? context.json(result)
        : context.html(
            setupResult({
              title: translate(
                input.locale,
                setupDecisionHeading(result.analysisProgress, result.schedulingFailure),
              ),
              message: result.schedulingFailure
                ? `${translate(input.locale, "setup.schedulingBlocked", { code: result.schedulingFailure })} ${translate(input.locale, `setup.progress.${result.analysisProgress}`)}`
                : translate(input.locale, `setup.progress.${result.analysisProgress}`),
              revision,
              locale: input.locale,
              grantId: input.grantId,
              progressUrl: result.progressUrl,
            }),
          )
    }
    default:
      return assertNever(input.decision)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unknown setup decision: ${value}`)
}
