import { useLanguage } from "../i18n/LanguageProvider.tsx"

export function ToolManagedNotice() {
  const { t } = useLanguage()
  return (
    <section className="setup-connection-slip" aria-label={t("subscription.executionTitle")}>
      <h3>{t("subscription.executionTitle")}</h3>
      <p>{t("subscription.requestScope")}</p>
      <p>{t("subscription.executionLimits")}</p>
      <p>{t("subscription.executionTrust")}</p>
      <p>{t("subscription.identityBinding")}</p>
      <p>{t("subscription.responseValidation")}</p>
    </section>
  )
}
