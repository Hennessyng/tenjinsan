import { assertNever, type Practice } from "@reading-studio/contracts"
import { html } from "hono/html"
import { pairedLabel, pairedText } from "./primitives.ts"

export function practiceSection(
  exercises: readonly Practice[],
  prefix: string,
  sectionId?: string,
) {
  return exercises.map((exercise) => {
    const id = `practice-${prefix}-${exercise.id}`
    const kind = exercise.kind ?? "reply"
    const title = (() => {
      switch (kind) {
        case "reply":
          return { en: "Reply practice · fictional scene", ja: "応答の練習・架空の場面" }
        case "topic":
          return { en: "Topic question card", ja: "テーマの問いカード" }
        case "reflection":
          return { en: "Personal reflection · not graded", ja: "自分の振り返り・採点なし" }
        default:
          return assertNever(kind)
      }
    })()
    return html`<section class="practice" data-practice-kind="${kind}" aria-labelledby="${id}">
      <p class="eyebrow pair-label">${pairedLabel(title)}</p>
      <h3 id="${id}" class="pair-label">${pairedLabel(exercise.prompt)}</h3>
      ${exercise.scenario ? pairedText(exercise.scenario) : html``}
      ${pairedText({ en: "Learner practice, not preference intake. Explore ideas; personal answers are not graded. These explanations do not predict a real person's response.", ja: "これは希望を収集する質問ではなく、学ぶための練習です。個人の回答を採点したり、実在する人の反応を予測したりしません。" })}
      <fieldset class="practice-choices"><legend><span lang="en">Choose a response to explore</span> / <span lang="ja">考えたい回答を選ぶ</span></legend>
      ${exercise.options.map(
        (option) => html`<div class="practice-option">
        <label class="pair-label"><input type="radio" name="${id}" value="${option.id}" aria-controls="state-${prefix}:practice:${exercise.id}:${option.id}">${pairedLabel(option.label)}</label>
        <div class="practice-feedback" id="state-${prefix}:practice:${exercise.id}:${option.id}" data-state="${prefix}:practice:${exercise.id}:${option.id}" tabindex="-1">
          <p class="eyebrow"><span lang="en">AUTHORED FEEDBACK · NOT A SCORE</span> / <span lang="ja">著者による解説・採点ではありません</span></p>
          ${pairedText(exercise.attribution ?? { en: "Attribution: lesson author's interpretation, not a quotation.", ja: "帰属：レッスン作成者の解釈であり、引用ではありません。" })}
          ${pairedText(option.feedback)}
        </div></div>`,
      )}
      </fieldset>
      ${kind === "reflection" ? html`<label class="pair-label" for="${id}-custom">${pairedLabel({ en: "Or use your own words (optional)", ja: "または自分の言葉で（任意）" })}</label><textarea id="${id}-custom" rows="3" maxlength="4000" autocomplete="off" aria-describedby="${id}-privacy"></textarea><div id="${id}-privacy">${pairedText({ en: "Only on this page. Not sent, saved or assessed; leaving may discard it.", ja: "このページだけのメモです。送信・保存・評価はされず、移動すると失われる場合があります。" })}</div>` : html``}
      ${sectionId ? html`<a href="#sources-${sectionId}"><span lang="en">Open source context</span><span lang="ja">出典の文脈を読む</span></a>` : html``}
    </section>`
  })
}
