import type { ReactElement } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import type { Evidence, EvidenceAction } from "./client.ts"
import { evidenceCategories, evidenceStatus } from "./copy.ts"

export function EvidenceReviewControls({
  semantic,
  busy,
  onAction,
}: {
  readonly semantic: Evidence["view"]["draft"]["semantic"]
  readonly busy: boolean
  readonly onAction: (action: EvidenceAction) => Promise<void>
}): ReactElement {
  const { t } = useLanguage()
  return (
    <div className="meaning-decisions">
      {semantic.map((decision) => (
        <section key={decision.category} aria-label={t(evidenceCategories[decision.category])}>
          <h3>{t(evidenceCategories[decision.category])}</h3>
          <p>{t("evidence.state", { status: evidenceStatus(decision.status, t) })}</p>
          <div className="setup-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void onAction({
                  action: "semantic",
                  category: decision.category,
                  status: "reviewed",
                })
              }}
            >
              {t("evidence.markReviewed", { category: t(evidenceCategories[decision.category]) })}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void onAction({
                  action: "semantic",
                  category: decision.category,
                  status: "acknowledged",
                })
              }}
            >
              {t("evidence.acknowledge", { category: t(evidenceCategories[decision.category]) })}
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}
