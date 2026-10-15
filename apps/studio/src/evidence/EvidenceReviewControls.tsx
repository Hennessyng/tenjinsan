import type { ReactElement } from "react"
import type { Evidence, EvidenceAction } from "./client.ts"

const labels = {
  support: "Support / 主張の裏付け",
  qualification: "Qualifications / 留保",
  translation: "Translation / 翻訳",
  visual: "Visual assumptions / 図解の仮定",
} as const

export function EvidenceReviewControls({
  semantic,
  busy,
  onAction,
}: {
  readonly semantic: Evidence["view"]["draft"]["semantic"]
  readonly busy: boolean
  readonly onAction: (action: EvidenceAction) => Promise<void>
}): ReactElement {
  return (
    <div className="meaning-decisions">
      {semantic.map((decision) => (
        <section key={decision.category} aria-label={decision.category}>
          <h3>{labels[decision.category]}</h3>
          <p>State: {decision.status}</p>
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
              Mark {decision.category} reviewed
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
              Acknowledge {decision.category} uncertainty
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}
