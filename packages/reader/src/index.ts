import { PublicationProjection, requiredTeachingStates } from "@reading-studio/contracts"
import { html, raw } from "hono/html"
import { bookMap } from "./book-map.ts"
import { practiceStyles } from "./practice-styles.ts"
import {
  languageControls,
  pairedLabel,
  pairedText,
  practiceSection,
  teachingState,
} from "./primitives.ts"
import { sceneFigure } from "./scene-figure.ts"
import { sceneRuntime } from "./scene-script.ts"
import { sceneStyles } from "./scene-styles.ts"
import { spatialRuntime } from "./spatial-script.ts"
import { spatialStyles } from "./spatial-styles.ts"
import { readerStyles } from "./styles.ts"

export {
  languageControls,
  pairedLabel,
  pairedText,
  practiceSection,
  teachingState,
} from "./primitives.ts"
export { sceneFigure } from "./scene-figure.ts"
export { sceneRuntime } from "./scene-script.ts"
export { sceneStyles } from "./scene-styles.ts"
export { spatialRuntime } from "./spatial-script.ts"
export { spatialStyles } from "./spatial-styles.ts"
export { readerStyles } from "./styles.ts"

export type ReaderDelivery = {
  readonly head?: ReturnType<typeof html>
  readonly appendix?: ReturnType<typeof html>
  readonly scripts?: ReturnType<typeof html>
  readonly footer?: ReturnType<typeof html>
}

export function readerDocument(input: unknown, delivery: ReaderDelivery = {}) {
  const lesson = PublicationProjection.parse(input)
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8">
    ${delivery.head ?? html``}<meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="A bilingual reading copy with complete teaching explanations and source notes.">
    <title>${lesson.title.en} / ${lesson.title.ja}</title><style>${raw(readerStyles + sceneStyles + spatialStyles + practiceStyles)}</style></head>
    <body><div class="editorial" id="top">
    <header class="masthead"><p class="eyebrow">READING STUDIO · <span lang="ja">読むためのノート</span></p>
      <a href="#reading"><span lang="en">Skip to lesson</span> / <span lang="ja">本文へ</span></a></header>
    ${languageControls()}
    <div class="reading-content"><h1 class="pair-label">${pairedLabel(lesson.title)}</h1>
    <div class="reader-grid"><nav class="contents" aria-label="Contents / 目次">
      <h2 class="pair-label">${pairedLabel({ en: "In this reading", ja: "このノートの内容" })}</h2>
      <ol>${lesson.sections.map((section) => html`<li><a class="pair-label" href="#section-${section.id}">${pairedLabel(section.heading)}</a></li>`)}</ol>
      <a href="#book-map"><span lang="en">Book map</span><span lang="ja">本の見取り図</span></a>
      <a href="#sources"><span lang="en">Source notes</span><span lang="ja">出典ノート</span></a></nav>
    <main id="reading" class="chapters" tabindex="-1">
    ${lesson.sections.map(
      (
        section,
        index,
      ) => html`<article class="chapter" id="section-${section.id}" tabindex="-1" aria-labelledby="heading-${section.id}">
      <p class="eyebrow">${String(index + 1).padStart(2, "0")} / ${String(lesson.sections.length).padStart(2, "0")}</p>
      <h2 id="heading-${section.id}" class="pair-label">${pairedLabel(section.heading)}</h2>
      ${pairedText(section.content)}
      ${section.scenes.map(
        (
          scene,
        ) => html`<section class="scene" aria-labelledby="scene-${scene.id}" data-print-states="${JSON.stringify(requiredTeachingStates(scene).map((state) => state.id))}">
        <h3 id="scene-${scene.id}" class="pair-label">${pairedLabel(scene.title)}</h3>
        ${sceneFigure(scene)}
        <p class="eyebrow"><span lang="en">TEACHING NOTES · ALL STATES</span> / <span lang="ja">図解の説明・すべての状態</span></p>
        <ul class="states">${requiredTeachingStates({ ...scene, practice: [] }).map((state) => html`${teachingState(state)}`)}</ul>
        ${practiceSection(scene.practice, scene.id, section.id)}
        ${scene.captions?.map((caption) => html`<aside class="caption"><a href="#state-${caption.stateId}"><span lang="en">Caption · related explanation</span><span lang="ja">注記・対応する説明</span></a>${pairedText(caption.text)}</aside>`)}
      </section>`,
      )}
      ${practiceSection(section.practice, section.id, section.id)}
      <p class="chapter-nav"><a href="#sources-${section.id}"><span lang="en">Sources for this section</span><span lang="ja">この節の出典</span></a><a href="#top"><span lang="en">Back to top</span><span lang="ja">先頭へ</span></a></p>
    </article>`,
    )}
    ${bookMap(lesson)}
    <section id="sources" tabindex="-1"><h2 class="pair-label">${pairedLabel({ en: "Sources & reading notes", ja: "出典と読書ノート" })}</h2>
      ${lesson.sections.map(
        (section) => html`<section class="sources" id="sources-${section.id}" tabindex="-1">
        <h3 class="pair-label">${pairedLabel(section.heading)}</h3>
        ${
          section.sourceNotes.length
            ? html`<ol>${section.sourceNotes.map(
                (note) => html`<li><h4 class="pair-label">${pairedLabel(note.title)}</h4>
          <p class="locator">${note.locator}</p>${note.quotation ? html`<blockquote>${note.quotation}</blockquote>` : html``}${pairedText(note.note)}</li>`,
              )}</ol>`
            : pairedText({
                en: "No source notes supplied for this section.",
                ja: "この節には出典ノートがありません。",
              })
        }
        <a href="#section-${section.id}"><span lang="en">Return to section</span><span lang="ja">本文に戻る</span></a></section>`,
      )}
    </section>
    ${lesson.assets.map((asset) => html`<aside class="sources">${pairedText(asset.alt)}<p>${asset.license}</p></aside>`)}
    ${delivery.appendix ?? html``}</main></div></div><footer>${delivery.footer ?? html`<p><span lang="en">Reading copy · not a publication approval</span> / <span lang="ja">閲覧用・公開の承認ではありません</span></p>`}</footer>
    </div>${delivery.scripts ?? html`<script data-scene-runtime>${raw(sceneRuntime)}</script>${lesson.sections.some((section) => section.scenes.some((scene) => scene.kind === "perspective-3d" || scene.kind === "spatial-layers-3d")) ? html`<script data-three-runtime>${raw(spatialRuntime)}</script>` : html``}`}</body></html>`
}
