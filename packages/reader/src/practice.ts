import { assertNever, type ExportUi, type Practice } from "@reading-studio/contracts"
import { html } from "hono/html"
import { pairedLabel, pairedText } from "./primitives.ts"
import { fixedUi, fixedUiBlock } from "./ui.ts"

export function practiceSection(
  exercises: readonly Practice[],
  prefix: string,
  placement: { readonly sectionId?: string; readonly ui?: ExportUi } = {},
) {
  const { sectionId, ui = "en+ja" } = placement
  return exercises.map((exercise) => {
    const id = `practice-${prefix}-${exercise.id}`
    const kind = exercise.kind ?? "reply"
    const title = (() => {
      switch (kind) {
        case "reply":
          return "reader.practice.reply"
        case "topic":
          return "reader.practice.topic"
        case "reflection":
          return "reader.practice.reflection"
        default:
          return assertNever(kind)
      }
    })()
    return html`<section class="practice" data-practice-kind="${kind}" aria-labelledby="${id}">
       <p class="eyebrow">${fixedUi(title, ui)}</p>
      <h3 id="${id}" class="pair-label">${pairedLabel(exercise.prompt)}</h3>
      ${exercise.scenario ? pairedText(exercise.scenario) : html``}
       <p>${fixedUiBlock("reader.practice.note", ui)}</p>
       <fieldset class="practice-choices"><legend>${fixedUi("reader.practice.choose", ui)}</legend>
      ${exercise.options.map(
        (option) => html`<div class="practice-option">
        <label class="pair-label"><input type="radio" name="${id}" value="${option.id}" aria-controls="state-${prefix}:practice:${exercise.id}:${option.id}">${pairedLabel(option.label)}</label>
        <div class="practice-feedback" id="state-${prefix}:practice:${exercise.id}:${option.id}" data-state="${prefix}:practice:${exercise.id}:${option.id}" tabindex="-1">
           <p class="eyebrow">${fixedUiBlock("reader.practice.feedback", ui)}</p>
           ${exercise.attribution ? pairedText(exercise.attribution) : html`<p>${fixedUiBlock("reader.practice.attribution", ui)}</p>`}
          ${pairedText(option.feedback)}
        </div></div>`,
      )}
      </fieldset>
       ${kind === "reflection" ? html`<label for="${id}-custom">${fixedUi("reader.practice.ownWords", ui)}</label><textarea id="${id}-custom" rows="3" maxlength="4000" autocomplete="off" aria-describedby="${id}-privacy"></textarea><div id="${id}-privacy"><p>${fixedUiBlock("reader.practice.privacy", ui)}</p></div>` : html``}
       ${sectionId ? html`<a href="#sources-${sectionId}">${fixedUi("reader.practice.source", ui)}</a>` : html``}
    </section>`
  })
}
