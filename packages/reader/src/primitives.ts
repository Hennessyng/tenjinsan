import type { Bilingual, ExportUi, TeachingState } from "@reading-studio/contracts"
import { html } from "hono/html"
import { fixedUi } from "./ui.ts"

export function pairedText(value: Bilingual) {
  return html`<div class="pair"><p lang="en">${value.en}</p><p lang="ja">${value.ja}</p></div>`
}

export function pairedLabel(value: Bilingual) {
  return html`<span lang="en">${value.en}</span><span lang="ja">${value.ja}</span>`
}

export function teachingState(state: TeachingState) {
  return html`<li id="state-${state.id}" data-state="${state.id}" tabindex="-1">
    <h4 class="pair-label">${pairedLabel(state.label)}</h4>${pairedText(state.explanation)}</li>`
}

export { practiceSection } from "./practice.ts"

export function languageControls(ui: ExportUi = "en+ja") {
  return html`<fieldset class="language-controls"><legend>${fixedUi("reader.language", ui)}</legend>
    <label><input type="radio" name="reader-language" value="paired" checked> ${fixedUi("reader.language.paired", ui)}</label>
    <label><input type="radio" name="reader-language" value="en"> ${fixedUi("reader.language.en", ui)}</label>
    <label><input type="radio" name="reader-language" value="ja"> ${fixedUi("reader.language.ja", ui)}</label>
  </fieldset>`
}
