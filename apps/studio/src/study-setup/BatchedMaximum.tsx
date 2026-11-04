import {
  type PreparationReview,
  preparationBatchParams,
} from "@reading-studio/contracts/setup-progress"
import { useLanguage } from "../i18n/LanguageProvider.tsx"

export function BatchedMaximum({
  value,
  analysisOnly = false,
}: {
  readonly value: NonNullable<PreparationReview["batchedMaximum"]>
  readonly analysisOnly?: boolean
}) {
  const { t } = useLanguage()
  return (
    <section aria-label={t("setup.batched.title")} data-batched-reserve={value.reserveId}>
      <h3>{t("setup.batched.title")}</h3>
      <p>{t("setup.batched.maximum", preparationBatchParams(value))}</p>
      <p>{t("setup.batched.unproven")}</p>
      <p>{t("setup.batched.refusal")}</p>
      <p>{t(analysisOnly ? "setup.analysisOnlyBudget" : "setup.batched.windowBudget")}</p>
      <details>
        <summary>{t("setup.batched.reserve")}</summary>
        <p>
          <code>{value.reserveId}</code> · <code>outputFitGuaranteed=false</code>
        </p>
      </details>
    </section>
  )
}
