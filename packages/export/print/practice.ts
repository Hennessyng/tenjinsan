import { type Practice, practiceTeachingStates } from "@reading-studio/contracts"
import { pairedLabel, pairedText, teachingState } from "@reading-studio/reader"
import { html } from "hono/html"

export function printPractice(exercises: readonly Practice[], prefix: string) {
  return html`${exercises.map(
    (exercise) => html`<section class="practice" data-practice="${prefix}:${exercise.id}">
    <h3 class="pair-label">${pairedLabel(exercise.prompt)}</h3>
    ${exercise.scenario ? html`<div data-scenario>${pairedText(exercise.scenario)}</div>` : html``}
    <div data-attribution>${pairedText(exercise.attribution ?? { en: "Lesson-author feedback; not a score or quotation.", ja: "教材作成者による解説です。採点や引用ではありません。" })}</div>
    <ol class="states">${practiceTeachingStates([exercise], prefix).map(teachingState)}</ol>
  </section>`,
  )}`
}
