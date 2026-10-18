import type { FormEvent, ReactElement } from "react"
import type { z } from "zod"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import type { Brief } from "./client.ts"
import { BriefSave } from "./client.ts"

const selects = {
  questionChoice: {
    label: "brief.guiding",
    options: [
      ["original", "brief.editor.keep"],
      ["refined", "brief.editor.useRefined"],
    ],
  },
  depth: {
    label: "brief.depth",
    options: [
      ["overview", "brief.depth.overview"],
      ["focused", "brief.depth.focused"],
      ["deep", "brief.depth.deep"],
    ],
  },
  language: {
    label: "brief.languages",
    options: [
      ["en", "brief.english"],
      ["ja", "brief.japanese"],
      ["paired", "brief.paired"],
    ],
  },
  spoilerPolicy: {
    label: "brief.spoilers",
    options: [
      ["avoid", "brief.spoilers.avoid"],
      ["allow", "brief.spoilers.allow"],
    ],
  },
} as const

export function BriefEditor({
  view,
  onSave,
  busy,
}: {
  readonly view: Brief["view"]
  readonly onSave: (value: z.infer<typeof BriefSave>) => void
  readonly busy: boolean
}): ReactElement {
  const { t } = useLanguage()
  const content = view?.draft.content
  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const values = Object.fromEntries(
      [...form.entries()].map(([key, value]) => [key, String(value)]),
    )
    const parsed = BriefSave.safeParse(values)
    if (parsed.success) onSave(parsed.data)
  }
  const text = (name: string, label: string, value = "", required = false) => (
    <label key={name}>
      {label}
      <textarea name={name} rows={2} required={required} defaultValue={value} />
    </label>
  )
  const select = (name: keyof typeof selects, value: string) => (
    <label key={name}>
      {t(selects[name].label)}
      <select name={name} defaultValue={value}>
        {selects[name].options.map(([id, title]) => (
          <option key={id} value={id}>
            {t(title)}
          </option>
        ))}
      </select>
    </label>
  )
  return (
    <form key={view?.draft.id ?? "new"} onSubmit={save}>
      <input type="hidden" name="action" value="save" />
      <input type="hidden" name="expectedRevisionId" value={view?.draft.id ?? ""} />
      <h2>{t("brief.editor.original")}</h2>
      {content ? (
        <>
          <p lang="en">{content.originalQuestion.en}</p>
          <p lang="ja">{content.originalQuestion.ja}</p>
          <input type="hidden" name="originalEn" value={content.originalQuestion.en} />
          <input type="hidden" name="originalJa" value={content.originalQuestion.ja} />
        </>
      ) : (
        <>
          {text("originalEn", t("brief.editor.originalEn"), "", true)}
          {text("originalJa", t("brief.editor.originalJa"), "", true)}
        </>
      )}
      <h2>{t("brief.refined")}</h2>
      <p>{t("brief.editor.refinedNote")}</p>
      {text("refinedEn", t("brief.editor.refinedEn"), content?.refinedQuestion?.en ?? "")}
      {text("refinedJa", t("brief.editor.refinedJa"), content?.refinedQuestion?.ja ?? "")}
      {select("questionChoice", content?.questionChoice ?? "original")}
      <h2>{t("brief.supporting")}</h2>
      <p>{t("brief.editor.supportNote")}</p>
      {[0, 1, 2].map((index) => (
        <div key={index}>
          {text(
            `supportEn${index}`,
            t("brief.editor.supportEn", { n: index + 1 }),
            content?.supportingQuestions[index]?.en ?? "",
          )}
          {text(
            `supportJa${index}`,
            t("brief.editor.supportJa", { n: index + 1 }),
            content?.supportingQuestions[index]?.ja ?? "",
          )}
        </div>
      ))}
      {text("purpose", t("brief.purpose"), content?.purpose ?? "", true)}
      {text("context", t("brief.context"), content?.context ?? "", true)}
      {select("depth", content?.depth ?? "focused")}
      {select("language", content?.language ?? "paired")}
      {select("spoilerPolicy", content?.spoilerPolicy ?? "avoid")}
      {text("exclusions", t("brief.editor.exclusions"), content?.exclusions.join("\n") ?? "")}
      <p>{t("brief.editor.saveNote")}</p>
      <button type="submit" disabled={busy}>
        {t("brief.editor.review")}
      </button>
    </form>
  )
}
