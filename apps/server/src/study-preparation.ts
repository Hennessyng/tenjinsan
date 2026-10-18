import type { NormalizationRevision, StudySetupRevision } from "@reading-studio/contracts"
import { translate } from "@reading-studio/contracts/i18n"
import { prepareBookMapScope } from "@reading-studio/generation"
import { sourcePage } from "@reading-studio/studio/source-viewer"
import type { Context } from "hono"
import { html } from "hono/html"
import type { AppEnvironment } from "./middleware/access.ts"

export async function preflightStudyDecision(
  context: Context<AppEnvironment>,
  input: {
    readonly setup: StudySetupRevision
    readonly normalization: NormalizationRevision
    readonly decision: "send" | "revise" | "cancel"
  },
): Promise<Response | undefined> {
  switch (input.decision) {
    case "revise":
    case "cancel":
      return undefined
    case "send":
      break
    default:
      return assertNever(input.decision)
  }
  const scope = prepareBookMapScope(input.setup, input.normalization)
  switch (scope.kind) {
    case "ready":
      return undefined
    case "limited": {
      if (context.req.path.startsWith("/api/")) return context.json(scope.failure, 422)
      const coverage = scope.failure.coverage
      const locale = context.req.query("lang") === "ja" ? "ja" : "en"
      const title = translate(locale, "setup.refusal.title")
      const reason = translate(
        locale,
        coverage.reason === "analysis-window-limit"
          ? "setup.refusal.windowLimit"
          : "setup.refusal.emptyScope",
      )
      return context.html(
        sourcePage(
          title,
          html`<h1>${title}</h1><p>${translate(locale, "setup.refusal.reason", { reason, required: coverage.requiredWindows, max: coverage.maxWindows })} <code>${coverage.reason}</code></p><p>${translate(locale, "setup.refusal.body")}</p><h2>${translate(locale, "setup.refusal.unsent")}</h2><ul>${coverage.unsentRanges.map((range) => html`<li>${range.resourcePath} · ${range.blockId} · UTF-16 [${range.start}, ${range.end})</li>`)}</ul><a href="/sources/${input.normalization.id}/setup?lang=${locale}">${translate(locale, "setup.scope")}</a>`,
          locale,
        ),
        422,
      )
    }
    default:
      return assertNever(scope)
  }
}
function assertNever(value: never): never {
  throw new TypeError(`Unexpected preparation: ${value}`)
}
