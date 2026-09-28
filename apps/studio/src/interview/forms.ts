import type { Answer, InterviewDefinition } from "@reading-studio/contracts"
import { html } from "hono/html"
import { type InterviewLanguage, interviewCopy } from "./copy.ts"

export function answerForms(input: {
  readonly definition: InterviewDefinition
  readonly step: InterviewDefinition["steps"][number]
  readonly answer: Answer | undefined
  readonly language: InterviewLanguage
}) {
  const { definition, step, answer, language } = input
  const { question } = step
  const copy = interviewCopy[language]
  const action = `/interviews/${definition.studyId}?step=${question.id}&lang=${language}`
  const identity = html`<input type="hidden" name="interviewId" value="${definition.id}"><input type="hidden" name="questionId" value="${question.id}"><input type="hidden" name="questionRevisionId" value="${question.revisionId}">`
  return html`
    <p id="selection-limit">${copy.range} ${question.minSelections} ${copy.to} ${question.maxSelections} ${copy.choices}.</p>
    ${step.purpose === "approval" ? html`<p>${copy.required}</p>` : html``}
    <form method="post" action="${action}">${identity}<input type="hidden" name="kind" value="choice">
      <fieldset aria-describedby="selection-limit"><legend>${question.prompt[language]}</legend>
        ${question.options.map((option) => html`<label class="answer-card"><input type="${question.mode === "single" ? "radio" : "checkbox"}" name="optionIds" value="${option.id}" ${answer?.kind === "choice" && answer.optionIds.includes(option.id) ? html`checked` : html``}><span>${option.label[language]}</span></label>`)}
      </fieldset><button>${copy.save}</button>
    </form>
    ${question.policy.custom ? html`<form method="post" action="${action}">${identity}<input type="hidden" name="kind" value="custom"><label for="custom">${copy.custom}</label><textarea id="custom" name="text" rows="4" required maxlength="12000">${answer?.kind === "custom" ? answer.text : ""}</textarea><button>${copy.saveCustom}</button></form>` : html``}
    <div class="setup-actions">${question.policy.unsure ? html`<form method="post" action="${action}">${identity}<button name="kind" value="unsure">${copy.unsure}</button></form>` : html``}
    ${question.policy.skip ? html`<form method="post" action="${action}">${identity}<button name="kind" value="skipped">${copy.skip}</button></form>` : html``}</div>`
}
