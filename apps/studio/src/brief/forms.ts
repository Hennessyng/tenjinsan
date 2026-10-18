import type { BriefView } from "@reading-studio/contracts"
import { translate, type UiLocale } from "@reading-studio/contracts/i18n"
import { html } from "hono/html"

export function briefEditor(view: BriefView | null, locale: UiLocale = "en") {
  const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
    translate(locale, key, params)
  const content = view?.draft.content
  const text = (name: string, label: string, value = "") =>
    html`<label>${label}<textarea name="${name}" rows="2" ${["originalEn", "originalJa", "purpose", "context"].includes(name) ? html`required` : html``}>${value}</textarea></label>`
  const labels = {
    questionChoice: t("brief.guiding"),
    depth: t("brief.depth"),
    language: t("brief.languages"),
    spoilerPolicy: t("brief.spoilers"),
  } as const
  const select = (
    name: keyof typeof labels,
    options: readonly (readonly [string, string])[],
    value: string,
  ) =>
    html`<label>${labels[name]}<select name="${name}">${options.map(([key, title]) => html`<option value="${key}" ${key === value ? html`selected` : html``}>${title}</option>`)}</select></label>`
  return html`<form method="post">
    <input type="hidden" name="action" value="save"><input type="hidden" name="expectedRevisionId" value="${view?.draft.id ?? ""}">
    <h2>${t("brief.editor.original")}</h2>
    ${content ? html`<p lang="en">${content.originalQuestion.en}</p><p lang="ja">${content.originalQuestion.ja}</p><input type="hidden" name="originalEn" value="${content.originalQuestion.en}"><input type="hidden" name="originalJa" value="${content.originalQuestion.ja}">` : html`${text("originalEn", t("brief.editor.originalEn"))}${text("originalJa", t("brief.editor.originalJa"))}`}
    <h2>${t("brief.refined")}</h2><p>${t("brief.editor.refinedNote")}</p>
    ${text("refinedEn", t("brief.editor.refinedEn"), content?.refinedQuestion?.en)}
    ${text("refinedJa", t("brief.editor.refinedJa"), content?.refinedQuestion?.ja)}
    ${select(
      "questionChoice",
      [
        ["original", t("brief.editor.keep")],
        ["refined", t("brief.editor.useRefined")],
      ],
      content?.questionChoice ?? "original",
    )}
    <h2>${t("brief.supporting")}</h2><p>${t("brief.editor.supportNote")}</p>
    ${[0, 1, 2].map((index) => html`${text(`supportEn${index}`, t("brief.editor.supportEn", { n: index + 1 }), content?.supportingQuestions[index]?.en)}${text(`supportJa${index}`, t("brief.editor.supportJa", { n: index + 1 }), content?.supportingQuestions[index]?.ja)}`)}
    ${text("purpose", t("brief.purpose"), content?.purpose)}
    ${text("context", t("brief.context"), content?.context)}
    ${select(
      "depth",
      [
        ["overview", t("brief.depth.overview")],
        ["focused", t("brief.depth.focused")],
        ["deep", t("brief.depth.deep")],
      ],
      content?.depth ?? "focused",
    )}
    ${select(
      "language",
      [
        ["en", t("brief.english")],
        ["ja", t("brief.japanese")],
        ["paired", t("brief.paired")],
      ],
      content?.language ?? "paired",
    )}
    ${select(
      "spoilerPolicy",
      [
        ["avoid", t("brief.spoilers.avoid")],
        ["allow", t("brief.spoilers.allow")],
      ],
      content?.spoilerPolicy ?? "avoid",
    )}
    ${text("exclusions", t("brief.editor.exclusions"), content?.exclusions.join("\n"))}
    <p>${t("brief.editor.saveNote")}</p>
    <button type="submit">${t("brief.editor.review")}</button>
  </form>`
}

export function briefDecisions(view: BriefView, locale: UiLocale = "en") {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key)
  return html`<form method="post"><input type="hidden" name="revisionId" value="${view.draft.id}">
    <div class="setup-actions">${view.status !== "approved" && view.status !== "outdated" && view.status !== "revise" ? html`<button name="action" value="approve">${t("brief.approve")}</button>` : html``}
    <button name="action" value="revise">${t("brief.revise")}</button><button name="action" value="defer">${t("brief.defer")}</button></div>
  </form>`
}
