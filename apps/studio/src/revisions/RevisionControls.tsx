import type { ReactElement } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"

export function RevisionForkControls({
  busy,
  onFork,
}: {
  readonly busy: boolean
  readonly onFork: () => void
}): ReactElement {
  const { t } = useLanguage()
  return (
    <div>
      <button type="button" disabled={busy} onClick={onFork}>
        {t("revision.fork")}
      </button>
      <p>{t("revision.fork.note")}</p>
    </div>
  )
}
