import {
  type ExportUi,
  PublicationProjection,
  requiredTeachingStates,
} from "@reading-studio/contracts"
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
import { fixedUi, fixedUiBlock, fixedUiText } from "./ui.ts"

export {
  languageControls,
  pairedLabel,
  pairedText,
  practiceSection,
  teachingState,
} from "./primitives.ts"
export { privateReaderDocument, privateReaderRuntime } from "./private.ts"
export { sceneFigure } from "./scene-figure.ts"
export { sceneRuntime } from "./scene-script.ts"
export { sceneStyles } from "./scene-styles.ts"
export { spatialRuntime } from "./spatial-script.ts"
export { spatialStyles } from "./spatial-styles.ts"
export { readerStyles } from "./styles.ts"
export { fixedUi, fixedUiBlock, fixedUiText } from "./ui.ts"

export type ReaderDelivery = {
  readonly controls?: ReturnType<typeof html>
  readonly ui?: ExportUi
  readonly head?: ReturnType<typeof html>
  readonly appendix?: ReturnType<typeof html>
  readonly scripts?: ReturnType<typeof html>
  readonly trailingScripts?: ReturnType<typeof html>
  readonly footer?: ReturnType<typeof html>
}

export function readerDocument(input: unknown, delivery: ReaderDelivery = {}) {
  const ui = delivery.ui ?? "en+ja"
  const lesson = PublicationProjection.parse(input)
  return html`<!doctype html><html lang="${ui === "ja" ? "ja" : "en"}"><head><meta charset="utf-8">
    ${delivery.head ?? html``}<meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${fixedUiText("reader.description", ui)}">
    <title>${lesson.title.en} / ${lesson.title.ja}</title><style>${raw(readerStyles + sceneStyles + spatialStyles + practiceStyles)}</style></head>
    <body><div class="editorial" id="top">
    <header class="masthead"><p class="eyebrow">${fixedUiBlock("reader.masthead", ui)}</p>
      <a href="#reading">${fixedUi("reader.skip", ui)}</a></header>
    ${delivery.controls ?? html``}
    ${languageControls(delivery.ui)}
    <div class="reading-content"><h1 class="pair-label">${pairedLabel(lesson.title)}</h1>
    <div class="reader-grid"><nav class="contents" aria-label="${fixedUiText("reader.contents", ui)}">
      <h2>${fixedUi("reader.inThisReading", ui)}</h2>
      <ol>${lesson.sections.map((section) => html`<li><a class="pair-label" href="#section-${section.id}">${pairedLabel(section.heading)}</a></li>`)}</ol>
      <a href="#book-map">${fixedUi("reader.bookMapLink", ui)}</a>
      <a href="#sources">${fixedUi("reader.sourceNotesLink", ui)}</a></nav>
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
         ${sceneFigure(scene, false, ui)}
         <p class="eyebrow">${fixedUiBlock("reader.teachingNotes", ui)}</p>
        <ul class="states">${requiredTeachingStates({ ...scene, practice: [] }).map((state) => html`${teachingState(state)}`)}</ul>
         ${practiceSection(scene.practice, scene.id, { sectionId: section.id, ui })}
         ${scene.captions?.map((caption) => html`<aside class="caption"><a href="#state-${caption.stateId}">${fixedUi("reader.caption", ui)}</a>${pairedText(caption.text)}</aside>`)}
      </section>`,
      )}
       ${practiceSection(section.practice, section.id, { sectionId: section.id, ui })}
       <p class="chapter-nav"><a href="#sources-${section.id}">${fixedUi("reader.sectionSources", ui)}</a><a href="#top">${fixedUi("reader.top", ui)}</a></p>
    </article>`,
    )}
     ${bookMap(lesson, ui)}
     <section id="sources" tabindex="-1"><h2>${fixedUi("reader.sourcesTitle", ui)}</h2>
      ${lesson.sections.map(
        (section) => html`<section class="sources" id="sources-${section.id}" tabindex="-1">
        <h3 class="pair-label">${pairedLabel(section.heading)}</h3>
        ${
          section.sourceNotes.length
            ? html`<ol>${section.sourceNotes.map(
                (note) => html`<li><h4 class="pair-label">${pairedLabel(note.title)}</h4>
          <p class="locator">${note.locator}</p>${note.quotation ? html`<blockquote>${note.quotation}</blockquote>` : html``}${pairedText(note.note)}</li>`,
              )}</ol>`
            : html`<p>${fixedUiBlock("reader.noSources", ui)}</p>`
        }
         <a href="#section-${section.id}">${fixedUi("reader.returnSection", ui)}</a></section>`,
      )}
    </section>
    ${lesson.assets.map((asset) => html`<aside class="sources">${pairedText(asset.alt)}<p>${asset.license}</p></aside>`)}
     ${delivery.appendix ?? html``}</main></div></div><footer>${delivery.footer ?? html`<p>${fixedUiBlock("reader.footer", ui)}</p>`}</footer>
    </div>${delivery.scripts ?? html`<script data-scene-runtime>${raw(sceneRuntime)}</script>${lesson.sections.some((section) => section.scenes.some((scene) => scene.kind === "perspective-3d" || scene.kind === "spatial-layers-3d")) ? html`<script data-three-runtime>${raw(spatialRuntime)}</script>` : html``}`}${delivery.trailingScripts ?? html``}</body></html>`
}
