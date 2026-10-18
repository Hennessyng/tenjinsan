import type { ExportUi, PublicationProjection } from "@reading-studio/contracts"
import { html } from "hono/html"
import { pairedLabel } from "./primitives.ts"
import { fixedUi, fixedUiBlock, fixedUiText } from "./ui.ts"

export function bookMap(lesson: PublicationProjection, ui: ExportUi = "en+ja") {
  return html`<section id="book-map" class="sources" tabindex="-1" aria-labelledby="book-map-heading">
     <h2 id="book-map-heading">${fixedUi("reader.map.title", ui)}</h2>
     <p>${fixedUiBlock("reader.map.note", ui)}</p>
    ${
      lesson.bookMap?.length
        ? html`<nav aria-label="${fixedUiText("reader.map.coverage", ui)}"><ol>${lesson.bookMap.map(
            (
              chapter,
            ) => html`<li data-coverage="${chapter.sectionIds.length ? "covered" : "not-covered"}">
      <h3 class="pair-label">${pairedLabel(chapter.title)}</h3>
       <p>${fixedUiBlock(chapter.sectionIds.length ? "reader.map.covered" : "reader.map.uncovered", ui)}</p>
      ${chapter.sectionIds.map((id) => {
        const section = lesson.sections.find((entry) => entry.id === id)
        return section
          ? html`<a class="pair-label" href="#section-${id}">${pairedLabel(section.heading)}</a>`
          : html``
      })}</li>`,
          )}</ol></nav>`
        : html`<p>${fixedUiBlock("reader.map.unavailable", ui)}</p>`
    }
  </section>`
}
