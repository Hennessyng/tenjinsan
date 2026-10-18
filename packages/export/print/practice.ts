import { type ExportUi, type Practice, practiceTeachingStates } from "@reading-studio/contracts"
import { fixedUiBlock, pairedLabel, pairedText, teachingState } from "@reading-studio/reader"
import { html } from "hono/html"

export function printPractice(
  exercises: readonly Practice[],
  prefix: string,
  ui: ExportUi = "en+ja",
) {
  return html`${exercises.map(
    (exercise) => html`<section class="practice" data-practice="${prefix}:${exercise.id}">
    <h3 class="pair-label">${pairedLabel(exercise.prompt)}</h3>
    ${exercise.scenario ? html`<div data-scenario>${pairedText(exercise.scenario)}</div>` : html``}
    <div data-attribution>${exercise.attribution ? pairedText(exercise.attribution) : html`<p>${fixedUiBlock("export.practiceAttribution", ui)}</p>`}</div>
    <ol class="states">${practiceTeachingStates([exercise], prefix).map(teachingState)}</ol>
  </section>`,
  )}`
}
