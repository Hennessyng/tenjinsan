import { translate, type UiLocale } from "@reading-studio/contracts/i18n"
import {
  type PreparationReview,
  preparationBatchParams,
} from "@reading-studio/contracts/setup-progress"
import { html } from "hono/html"

export function batchedMarkup(
  value: PreparationReview["batchedMaximum"],
  locale: UiLocale,
  analysisOnly = false,
) {
  if (!value) return html``
  const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
    translate(locale, key, params)
  return html`<section aria-label="${t("setup.batched.title")}" data-batched-reserve="${value.reserveId}">
    <h3>${t("setup.batched.title")}</h3><p>${t("setup.batched.maximum", preparationBatchParams(value))}</p>
    <p>${t("setup.batched.unproven")}</p><p>${t("setup.batched.refusal")}</p><p>${t(analysisOnly ? "setup.analysisOnlyBudget" : "setup.batched.windowBudget")}</p>
    <details><summary>${t("setup.batched.reserve")}</summary><p><code>${value.reserveId}</code> · <code>outputFitGuaranteed=false</code></p></details>
  </section>`
}
