import type { PublicationProjection } from "@reading-studio/contracts"
import { html } from "hono/html"
import { pairedLabel, pairedText } from "./primitives.ts"

export function bookMap(lesson: PublicationProjection) {
  return html`<section id="book-map" class="sources" tabindex="-1" aria-labelledby="book-map-heading">
    <h2 id="book-map-heading" class="pair-label">${pairedLabel({ en: "The wider book", ja: "本全体の見取り図" })}</h2>
    ${pairedText({ en: "Coverage means source material is used in this lesson, not that the chapter is fully taught.", ja: "扱う章とは、このレッスンが出典を使用する章のことです。章全体を解説するという意味ではありません。" })}
    ${
      lesson.bookMap?.length
        ? html`<nav aria-label="Chapter coverage / 章の扱い"><ol>${lesson.bookMap.map(
            (
              chapter,
            ) => html`<li data-coverage="${chapter.sectionIds.length ? "covered" : "not-covered"}">
      <h3 class="pair-label">${pairedLabel(chapter.title)}</h3>
      ${pairedText(chapter.sectionIds.length ? { en: "Covered in this lesson", ja: "このレッスンで扱う章" } : { en: "Not covered in this lesson", ja: "このレッスンでは扱わない章" })}
      ${chapter.sectionIds.map((id) => {
        const section = lesson.sections.find((entry) => entry.id === id)
        return section
          ? html`<a class="pair-label" href="#section-${id}">${pairedLabel(section.heading)}</a>`
          : html``
      })}</li>`,
          )}</ol></nav>`
        : pairedText({
            en: "Chapter inventory unavailable. Whole-book coverage is not established.",
            ja: "章の一覧がないため、本全体の扱いは確認できません。",
          })
    }
  </section>`
}
