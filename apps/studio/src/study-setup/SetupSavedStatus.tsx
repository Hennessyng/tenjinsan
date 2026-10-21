import type { ReactElement } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import type { SavedSetupDecision } from "./client.ts"

export function SetupSavedStatus({
  value,
  onResume,
  busy,
}: {
  readonly value: SavedSetupDecision & { readonly progressUrl: string }
  readonly onResume: () => void
  readonly busy: boolean
}): ReactElement {
  const { t } = useLanguage()
  return (
    <>
      {value.schedulingFailure && (
        <p role="alert">{t("setup.schedulingBlocked", { code: value.schedulingFailure })}</p>
      )}
      <p role="status" data-analysis-progress={value.analysisProgress}>
        {t(`setup.progress.${value.analysisProgress}`)}
      </p>
      <p data-grant={value.grantId}>{t("setup.consentSaved")}</p>
      <p>
        <a href={value.progressUrl}>{t("setup.viewProgress")}</a>
      </p>
      {value.canResume && (
        <button type="button" disabled={busy} onClick={onResume}>
          {t("setup.resumeScheduling")}
        </button>
      )}
      {value.analysisProgress === "questions-ready" && (
        <a href={value.questionsUrl ?? "/interviews"}>{t("setup.openQuestions")}</a>
      )}
    </>
  )
}
