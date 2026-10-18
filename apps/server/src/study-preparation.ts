import {
  type NormalizationRevision,
  SourcePreparationFailure,
  type StudySetupRevision,
} from "@reading-studio/contracts"
import { translate } from "@reading-studio/contracts/i18n"
import { bookMapRequestsFit, prepareBookMapScope } from "@reading-studio/generation"
import { reviewedSourceBlocks } from "@reading-studio/providers"
import { sourceLocation, sourcePage } from "@reading-studio/studio/source-viewer"
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
  let scope = prepareBookMapScope(input.setup, input.normalization)
  if (scope.kind === "ready" && !(await bookMapRequestsFit({ ...input, windows: scope.windows }))) {
    scope = {
      kind: "limited",
      failure: SourcePreparationFailure.parse({
        error: "scope-limit",
        coverage: {
          transmission: "not-sent",
          reason: "request-byte-limit",
          requiredWindows: scope.windows.length,
          maxWindows: 128,
          unsentRanges: reviewedSourceBlocks(input.setup, input.normalization).map((block) => ({
            resourcePath: block.resourcePath,
            blockId: block.blockId,
            start: block.start,
            end: block.end,
            ...(block.locator ? { locator: block.locator } : {}),
            ...(block.pageLabel ? { pageLabel: block.pageLabel } : {}),
            ...(block.originalFragment ? { originalFragment: block.originalFragment } : {}),
          })),
        },
      }),
    }
  }
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
        coverage.reason === "request-byte-limit"
          ? "setup.refusal.requestLimit"
          : coverage.reason === "analysis-window-limit"
            ? "setup.refusal.windowLimit"
            : "setup.refusal.emptyScope",
      )
      return context.html(
        sourcePage(
          title,
          html`<h1>${title}</h1><p>${translate(locale, "setup.refusal.reason", { reason, required: coverage.requiredWindows, max: coverage.maxWindows })} <code>${coverage.reason}</code></p><p>${translate(locale, "setup.refusal.body")}</p><h2>${translate(locale, "setup.refusal.unsent")}</h2><ul>${coverage.unsentRanges.map((range) => html`<li>${range.resourcePath} · ${range.blockId} · UTF-16 [${range.start}, ${range.end}) · ${sourceLocation(range, (key, params) => translate(locale, key, params))}${range.originalFragment ? html` · ${range.originalFragment}` : html``}</li>`)}</ul><a href="/sources/${input.normalization.id}/setup?lang=${locale}">${translate(locale, "setup.scope")}</a>`,
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
