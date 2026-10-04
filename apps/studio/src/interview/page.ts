import {
  type AnswerSubmission,
  assertNever,
  type InterviewDefinition,
} from "@reading-studio/contracts"
import { html, raw } from "hono/html"
import { sourcePage } from "../source-viewer/page.ts"
import { type InterviewLanguage, interviewCopy } from "./copy.ts"
import { answerForms } from "./forms.ts"

export { interviewFromDiscovery } from "./discovery.ts"

const styles = `
.interview form { margin-block: var(--space-6); }
.interview .answer-card { display: flex; align-items: baseline; gap: var(--space-3); padding: var(--space-4); margin-block: var(--space-2); border: var(--rule) solid var(--color-line); background: var(--color-paper-raised); cursor: pointer; }
.answer-card:has(:checked) { background: var(--color-green-soft); border-color: var(--color-green); }
.answer-card:focus-within { outline: var(--focus-width) solid var(--color-focus); outline-offset: var(--space-1); }
.interview textarea { display: block; width: 100%; margin-bottom: var(--space-4); padding: var(--space-4); font: inherit; color: var(--color-ink); background: var(--color-paper-raised); border: var(--rule) solid var(--color-green); }
.interview progress { width: 100%; accent-color: var(--color-green); }
.interview nav { margin-block: var(--space-6); }
.interview [role="alert"] { border-left: var(--space-1) solid var(--color-focus); padding: var(--space-4); }
.interview .response { white-space: pre-wrap; }
.interview h2, .interview legend { text-wrap: balance; word-break: normal; overflow-wrap: break-word; }
`

function answerText(submission: AnswerSubmission, language: InterviewLanguage) {
  const { answer, question } = submission
  const copy = interviewCopy[language]
  switch (answer.kind) {
    case "custom":
      return answer.text
    case "unsure":
      return copy.unsure
    case "skipped":
      return copy.skipped
    case "choice":
      return question.options
        .filter((option) => answer.optionIds.includes(option.id))
        .map((option) => option.label[language])
        .join(" · ")
    default:
      return assertNever(answer)
  }
}

export function interviewPage(input: {
  readonly definition: InterviewDefinition
  readonly answers: readonly AnswerSubmission[]
  readonly stepId: string | undefined
  readonly language: InterviewLanguage
  readonly state: "view" | "saved" | "error"
}) {
  const { definition, answers, language, state } = input
  const copy = interviewCopy[language]
  const base = `/interviews/${definition.studyId}`
  const link = (step: string, lang = language) => `${base}?step=${step}&lang=${lang}`
  const sequence = [
    ...definition.shortlist.flatMap((id) =>
      definition.steps.filter((step) => step.question.id === id),
    ),
    ...definition.steps.filter(
      (step) => step.purpose === "approval" && !definition.shortlist.includes(step.question.id),
    ),
  ]
  const step = definition.steps.find((step) => step.question.id === input.stepId) ?? sequence[0]
  if (!step) throw new TypeError("Interview requires a shortlist")
  const current = answers.find((answer) => answer.question.id === step.question.id)
  const savedCount = sequence.filter((step) =>
    answers.some((answer) => answer.question.id === step.question.id),
  ).length
  const position = sequence.findIndex((item) => item.question.id === step.question.id)
  const back = sequence[position - 1]
  const next = sequence[position + 1]
  const review = input.stepId === "~review"
  const requiredPending = definition.steps.some(
    (step) =>
      step.purpose === "approval" &&
      !answers.some((answer) => answer.question.id === step.question.id),
  )
  return sourcePage(
    copy.title,
    html`<style>${raw(styles)}</style><section class="setup interview" lang="${language}">
    <p class="eyebrow"><span lang="en">READING</span> / ${language === "en" ? "YOUR PERSPECTIVE" : "あなたの視点"}</p>
    <h1>${copy.title}</h1><p>${copy.intro}</p>
    <nav aria-label="${language === "en" ? "Language" : "言語"}"><a href="${link(review ? "~review" : step.question.id, "en")}" lang="en" aria-current="${language === "en" ? "true" : "false"}">English</a> / <a href="${link(review ? "~review" : step.question.id, "ja")}" lang="ja" aria-current="${language === "ja" ? "true" : "false"}">日本語</a></nav>
    <label for="progress">${copy.progress} ${savedCount} ${copy.of} ${sequence.length} ${copy.suggested}</label><progress id="progress" value="${savedCount}" max="${sequence.length}"></progress>
    <p>${copy.hint}</p>
    ${state === "error" ? html`<p role="alert" tabindex="-1" autofocus>${copy.error}</p>` : html``}
    ${state === "saved" ? html`<p role="status" tabindex="-1" autofocus>${copy.saved}</p>` : html``}
    ${
      review
        ? html`<h2>${copy.review}</h2>${requiredPending ? html`<p role="status">${copy.pending}</p>` : savedCount === sequence.length ? html`<p>${copy.complete}</p>` : html``}
      <ol>${definition.steps
        .filter(
          (item) =>
            sequence.includes(item) ||
            answers.some((answer) => answer.question.id === item.question.id),
        )
        .map((item) => {
          const saved = answers.find((answer) => answer.question.id === item.question.id)
          return html`<li><h2>${item.question.prompt[language]}</h2><p class="response">${
            saved ? answerText(saved, language) : copy.empty
          }</p><a href="${link(item.question.id)}">${copy.edit}: ${item.question.prompt[language]}</a></li>`
        })}</ol>`
        : html`<h2 tabindex="-1" ${state === "view" ? html`autofocus` : html``}>${step.question.prompt[language]}</h2>
      ${
        current
          ? html`<p class="response">${copy.progress}: ${answerText(current, language)}</p>`
          : html``
      }
      ${answerForms({ definition, step, answer: current?.answer, language })}
       <nav class="setup-actions" aria-label="${language === "en" ? "Interview steps" : "質問の移動"}">${back ? html`<a href="${link(back.question.id)}">${copy.back}</a>` : html``}${next ? html`<a href="${link(next.question.id)}">${copy.next}</a>` : html``}<a href="${link("~review")}">${copy.review}</a></nav>`
    }
    <h2>${copy.browse}</h2>${definition.groups.map((group) => html`<details><summary>${group.label[language]}</summary><ul>${definition.steps.filter((item) => item.groupId === group.id).map((item) => html`<li><a href="${link(item.question.id)}">${item.question.lens?.label[language] ?? item.question.prompt[language]}</a></li>`)}</ul></details>`)}
<p><a href="/briefs/${definition.studyId}">Reading brief / <span lang="ja">読書方針を確認</span></a></p>
<p><a href="/revisions/${definition.studyId}">Study revisions / <span lang="ja">読書の版</span></a></p>
  </section>`,
    language,
  )
}
