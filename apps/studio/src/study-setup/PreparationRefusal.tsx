import {
  preparationAllowanceParams,
  preparationReasonKey,
} from "@reading-studio/contracts/setup-progress"
import type { SourcePreparationFailure } from "@reading-studio/contracts/source"
import { type ReactElement, useEffect, useRef } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { UnsentRanges } from "./UnsentRanges.tsx"

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
          reason: t(preparationReasonKey(coverage.reason)),
          required: coverage.requiredWindows,
          max: coverage.maxWindows,
        })}
      </p>
      <p>
        <code>{coverage.reason}</code>
      </p>
      <p>{t("setup.refusal.body")}</p>
      <p>{t("setup.batched.windowBudget")}</p>
      {coverage.allowance && (
        <p>
          {t("setup.preparation.allowance", preparationAllowanceParams(coverage.allowance))}{" "}
          {t("setup.preparation.uncertain")}
        </p>
      )}
      <UnsentRanges ranges={coverage.unsentRanges} />
      <p>
        <a href="/imports">{t("setup.refusal.import")}</a>
      </p>
    </section>
  )
}
