import { UI_LOCALES } from "@reading-studio/contracts/i18n"
import type { ReactElement } from "react"
import { useLanguage } from "./LanguageProvider.tsx"
import "./language-switch.css"

export function LanguageSwitch(): ReactElement {
  const { locale, t, requestLocale, persistence } = useLanguage()
  const names = { en: t("language.name.en"), ja: t("language.name.ja") } as const
  return (
    <div className="language-switch">
      <fieldset aria-label={t("language.label")}>
        {UI_LOCALES.map((code) => (
          <button
            key={code}
            type="button"
            lang={code}
            aria-pressed={code === locale}
            onClick={() => requestLocale(code)}
          >
            {names[code]}
          </button>
        ))}
      </fieldset>
      {persistence === "session-only" && <p role="status">{t("language.notice.unsaved")}</p>}
    </div>
  )
}
