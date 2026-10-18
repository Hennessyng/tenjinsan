import type { ReactElement } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import type { Evidence } from "./client.ts"

export function EvidenceSources({ value }: { readonly value: Evidence }): ReactElement {
  const { t } = useLanguage()
  const { mechanical } = value.view
  return (
    <>
      <h2>{t("evidence.sourceTitle")}</h2>
      <p>{mechanical.length ? t("evidence.sourceBroken") : t("evidence.sourceMatched")}</p>
      <ul>
        {mechanical.map((flag) => (
          <li role="alert" key={`${flag.category}-${flag.path}`}>
            {flag.category}: <code>{flag.path}</code>
          </li>
        ))}
      </ul>
      <details>
        <summary>{t("evidence.compare")}</summary>
        {value.references.map((reference) => (
          <div key={reference.href}>
            <p>
              <a href={reference.href}>{reference.title}</a>
            </p>
            <blockquote>{reference.text}</blockquote>
          </div>
        ))}
      </details>
    </>
  )
}
