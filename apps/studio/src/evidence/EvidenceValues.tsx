import type { FormEvent, ReactElement } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import type { Evidence, EvidenceAction } from "./client.ts"

export function EvidenceValues({
  value,
  onAction,
  busy,
}: {
  readonly value: Evidence
  readonly onAction: (action: EvidenceAction) => void
  readonly busy: boolean
}): ReactElement {
  const { t, locale } = useLanguage()
  return (
    <>
      <h2 id="projected-content">{t("evidence.inspectTitle")}</h2>
      <a
        href={`/api/evidence/${value.view.draft.studyId}/${value.view.draft.lessonRevisionId}/preview?lang=${locale}`}
      >
        {t("evidence.preview")}
      </a>
      <p>
        <a
          href={`/api/evidence/${value.view.draft.studyId}/${value.view.draft.lessonRevisionId}/read?lang=${locale}`}
        >
          {t("evidence.read")}
        </a>
      </p>
      <p>
        <a href={`/publications/${value.view.draft.studyId}`}>{t("evidence.publication")}</a>
      </p>
      <details>
        <summary>{t("evidence.inspectAll")}</summary>
        {value.entries.map((entry, index) => (
          <details key={entry.path}>
            <summary>{entry.path}</summary>
            <p lang={entry.path.endsWith("/ja") ? "ja" : "en"}>{entry.text}</p>
            <form
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                const data = new FormData(event.currentTarget)
                onAction({
                  action: "replace-text",
                  path: entry.path,
                  text: String(data.get("text") ?? ""),
                })
              }}
            >
              <label htmlFor={`value-${index}`}>
                {t("evidence.correct", { path: entry.path })}
              </label>
              <textarea
                id={`value-${index}`}
                name="text"
                rows={3}
                required
                defaultValue={entry.text}
              />
              <button type="submit" disabled={busy}>
                {t("evidence.saveCorrection")}
              </button>
            </form>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction({ action: "privacy-flag", path: entry.path })}
            >
              {t("evidence.flagPrivate")}
            </button>
          </details>
        ))}
      </details>
      <details>
        <summary>{t("evidence.removeUncertain")}</summary>
        {value.removable.map((path) => (
          <p key={path}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction({ action: "remove-content", path })}
            >
              {t("evidence.remove", { path })}
            </button>
          </p>
        ))}
      </details>
    </>
  )
}
