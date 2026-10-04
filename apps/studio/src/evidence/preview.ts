import {
  type EvidenceView,
  projectedStrings,
  requiredTeachingStates,
} from "@reading-studio/contracts"
import { html } from "hono/html"
import { sourcePage } from "../source-viewer/page.ts"

export function evidencePreview(view: EvidenceView) {
  const projection = view.draft.projection
  return sourcePage(
    "Cleaned projection preview / 公開用データの確認",
    html`
    <section class="setup evidence"><p class="eyebrow">PRIVATE / PROJECTION PREVIEW</p>
    <h1>Cleaned projection preview / <span lang="ja">公開用データの確認</span></h1>
    <p role="status">${view.ready ? "Ready for later publication approval; not published." : "Review incomplete or blocked; not publishable."}</p>
    <p>${view.draft.semantic.some((item) => item.status === "acknowledged") ? "Semantic uncertainty acknowledged, not verified truth." : "Semantic judgments are human review, not proof of truth."}</p>
    <p class="metadata">Projection: ${view.draft.projectionHash}</p>
    <a href="/evidence/${view.draft.studyId}/${view.draft.lessonRevisionId}">Return to review / <span lang="ja">確認に戻る</span></a>
    <h2>${projection.title.en}</h2><p lang="ja">${projection.title.ja}</p>
    ${projection.sections.map(
      (
        section,
      ) => html`<article><h2>${section.heading.en}</h2><p lang="ja">${section.heading.ja}</p>
      ${section.content.en.split("\n\n").map((paragraph) => html`<p>${paragraph}</p>`)}
      ${section.content.ja.split("\n\n").map((paragraph) => html`<p lang="ja">${paragraph}</p>`)}
      <h3>Source notes / <span lang="ja">出典</span></h3>
      ${section.sourceNotes.map((note) => html`<p>${note.title.en} · ${note.locator}</p>${note.quotation ? html`<blockquote>${note.quotation}</blockquote>` : html``}<p>${note.note.en}</p><p lang="ja">${note.note.ja}</p>`)}
      ${section.scenes.map(
        (scene) => html`<h3>${scene.title.en}</h3><p lang="ja">${scene.title.ja}</p>
        ${requiredTeachingStates(scene).map((state) => html`<p>${state.label.en}: ${state.explanation.en}</p><p lang="ja">${state.label.ja}: ${state.explanation.ja}</p>`)}
        ${scene.captions?.map((caption) => html`<p>${caption.text.en}</p><p lang="ja">${caption.text.ja}</p>`)}`,
      )}
      ${section.practice.map((practice) => html`<h3>${practice.prompt.en}</h3><p lang="ja">${practice.prompt.ja}</p>${practice.options.map((option) => html`<p>${option.label.en}: ${option.feedback.en}</p><p lang="ja">${option.label.ja}: ${option.feedback.ja}</p>`)}`)}
    </article>`,
    )}
    ${projection.assets.map((asset) => html`<p>Asset description: ${asset.alt.en}</p><p lang="ja">${asset.alt.ja}</p><p>${asset.license}</p>`)}
    <details><summary>All projected content / すべての公開用データ</summary>
    <dl>${projectedStrings(projection).map((entry) => html`<dt><code>${entry.path}</code></dt><dd lang="${entry.path.endsWith("/ja") ? "ja" : "en"}">${entry.text}</dd>`)}</dl></details>
    </section>`,
  )
}
