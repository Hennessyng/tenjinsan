import {
  type EvidenceView,
  projectedStrings,
  requiredTeachingStates,
} from "@reading-studio/contracts"
import { translate, type UiLocale } from "@reading-studio/contracts/i18n"
import { html } from "hono/html"
import { sourcePage } from "../source-viewer/page.ts"

export function evidencePreview(view: EvidenceView, locale: UiLocale = "en") {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key)
  const projection = view.draft.projection
  return sourcePage(
    t("preview.title"),
    html`
    <section class="setup evidence"><p class="eyebrow">${t("preview.eyebrow")}</p>
    <h1>${t("preview.title")}</h1>
    <p role="status">${t(view.ready ? "evidence.state.ready" : "evidence.state.review")}</p>
    <p>${t(view.draft.semantic.some((item) => item.status === "acknowledged") ? "preview.acknowledged" : "preview.human")}</p>
    <p class="metadata">${t("evidence.projection")} ${view.draft.projectionHash}</p>
    <a href="/evidence/${view.draft.studyId}/${view.draft.lessonRevisionId}?lang=${locale}">${t("preview.back")}</a>
    <h2>${projection.title.en}</h2><p lang="ja">${projection.title.ja}</p>
    ${projection.sections.map(
      (
        section,
      ) => html`<article><h2>${section.heading.en}</h2><p lang="ja">${section.heading.ja}</p>
      ${section.content.en.split("\n\n").map((paragraph) => html`<p>${paragraph}</p>`)}
      ${section.content.ja.split("\n\n").map((paragraph) => html`<p lang="ja">${paragraph}</p>`)}
       <h3>${t("reader.sourceNotesLink")}</h3>
      ${section.sourceNotes.map((note) => html`<p>${note.title.en} · ${note.locator}</p>${note.quotation ? html`<blockquote>${note.quotation}</blockquote>` : html``}<p>${note.note.en}</p><p lang="ja">${note.note.ja}</p>`)}
      ${section.scenes.map(
        (scene) => html`<h3>${scene.title.en}</h3><p lang="ja">${scene.title.ja}</p>
        ${requiredTeachingStates(scene).map((state) => html`<p>${state.label.en}: ${state.explanation.en}</p><p lang="ja">${state.label.ja}: ${state.explanation.ja}</p>`)}
        ${scene.captions?.map((caption) => html`<p>${caption.text.en}</p><p lang="ja">${caption.text.ja}</p>`)}`,
      )}
      ${section.practice.map((practice) => html`<h3>${practice.prompt.en}</h3><p lang="ja">${practice.prompt.ja}</p>${practice.options.map((option) => html`<p>${option.label.en}: ${option.feedback.en}</p><p lang="ja">${option.label.ja}: ${option.feedback.ja}</p>`)}`)}
    </article>`,
    )}
    ${projection.assets.map((asset) => html`<p>${t("preview.asset")} ${asset.alt.en}</p><p lang="ja">${asset.alt.ja}</p><p>${asset.license}</p>`)}
    <details><summary>${t("preview.all")}</summary>
    <dl>${projectedStrings(projection).map((entry) => html`<dt><code>${entry.path}</code></dt><dd lang="${entry.path.endsWith("/ja") ? "ja" : "en"}">${entry.text}</dd>`)}</dl></details>
    </section>`,
    locale,
  )
}
