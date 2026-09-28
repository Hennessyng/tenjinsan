import type { Bilingual, TeachingState } from "@reading-studio/contracts"
import { html } from "hono/html"

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

export function languageControls() {
  return html`<fieldset class="language-controls"><legend><span lang="en">Reading language</span> / <span lang="ja">表示言語</span></legend>
    <label><input type="radio" name="reader-language" value="paired" checked> English + <span lang="ja">日本語</span></label>
    <label><input type="radio" name="reader-language" value="en"> English</label>
    <label><input type="radio" name="reader-language" value="ja"> <span lang="ja">日本語</span></label>
  </fieldset>`
}
