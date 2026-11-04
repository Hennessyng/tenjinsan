import {
  type PreparationReview,
  preparationAllowanceParams,
  preparationReasonKey,
} from "@reading-studio/contracts/setup-progress"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { BatchedMaximum } from "./BatchedMaximum.tsx"
import { UnsentRanges } from "./UnsentRanges.tsx"

export function PreparationPlan({ value }: { readonly value: PreparationReview }) {
  const { t } = useLanguage()
  return (
    <section aria-label={t("setup.preparation.title")}>
      <h2>{t("setup.preparation.title")}</h2>
      <p>{t("setup.preparation.flow")}</p>
      {value.verificationRoom && (
        <p data-verification-room-policy={value.verificationRoom.policy}>
          {t("setup.batched.roomPolicy", { bytes: value.verificationRoom.targetBytes })}
        </p>
      )}
      <p>{t("setup.preparation.parts", { groups: value.groupCount, parts: value.partCount })}</p>
      <p>{t("setup.preparation.allowance", preparationAllowanceParams(value.allowance))}</p>
      <p>{t("setup.preparation.uncertain")}</p>
      {value.batchedMaximum && (
        <BatchedMaximum value={value.batchedMaximum} analysisOnly={Boolean(value.purpose)} />
      )}
      {value.reason && <p role="status">{t(preparationReasonKey(value.reason))}</p>}
      {value.state === "blocked" && (
        <p>{t(value.purpose ? "setup.analysisOnlyBudget" : "setup.batched.windowBudget")}</p>
      )}
      {value.state === "blocked" && <UnsentRanges ranges={value.unsentRanges} />}
    </section>
  )
}
