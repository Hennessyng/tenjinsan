import type { SourcePreparationFailure } from "@reading-studio/contracts/source"
import { type ReactElement, useEffect, useRef } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { sourceLocation } from "../source-viewer/SourceDetails.tsx"

export function PreparationRefusal({
  failure,
}: {
  readonly failure: SourcePreparationFailure
}): ReactElement {
  const { t } = useLanguage()
  const alert = useRef<HTMLElement>(null)
  useEffect(() => {
    alert.current?.focus()
  }, [])
  const { coverage } = failure
  return (
    <section className="setup" role="alert" ref={alert} tabIndex={-1}>
      <h2>{t("setup.refusal.title")}</h2>
      <p>
        {t("setup.refusal.reason", {
          reason: t(
            coverage.reason === "analysis-window-limit"
              ? "setup.refusal.windowLimit"
              : "setup.refusal.emptyScope",
          ),
          required: coverage.requiredWindows,
          max: coverage.maxWindows,
        })}{" "}
        <code>{coverage.reason}</code>
      </p>
      <p>{t("setup.refusal.body")}</p>
      <p>
        <a href="/imports">{t("setup.refusal.import")}</a>
      </p>
      <h3>{t("setup.refusal.unsent")}</h3>
      <ul>
        {coverage.unsentRanges.map((range) => (
          <li key={`${range.resourcePath}-${range.blockId}-${range.start}`}>
            {range.resourcePath} · {range.blockId} · UTF-16 [{range.start}, {range.end}) ·{" "}
            {sourceLocation(range, t)}
          </li>
        ))}
      </ul>
    </section>
  )
}
