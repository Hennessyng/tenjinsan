import type { ReactElement } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import type { Revision } from "./client.ts"

export function RevisionHistory({
  history,
  currentId,
}: {
  readonly history: Revision["view"]["history"]
  readonly currentId: string
}): ReactElement {
  const { t } = useLanguage()
  const old = history.filter((revision) => revision.id !== currentId)
  return (
    <>
      <h2>{t("revision.history")}</h2>
      {old.length ? (
        old.map((revision, index) => (
          <section key={revision.id}>
            <h3>{t("revision.history.old", { n: old.length - index })}</h3>
            <p>
              {revision.analysis.provider} · {revision.analysis.model}
            </p>
            <p className="metadata">
              <code>{revision.id}</code>
            </p>
            <p>{t("revision.history.retained")}</p>
          </section>
        ))
      ) : (
        <p className="workspace-empty">{t("revision.history.empty")}</p>
      )}
      <p>{t("revision.history.exports")}</p>
    </>
  )
}
