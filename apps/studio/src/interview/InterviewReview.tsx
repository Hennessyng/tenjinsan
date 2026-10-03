import type { ReactElement } from "react"
import { answerText } from "./answer-text.ts"
import type { Saved, Step } from "./client.ts"
import type { InterviewLanguage } from "./copy.ts"
import { interviewCopy } from "./copy.ts"

export function InterviewReview({
  steps,
  sequence,
  answers,
  language,
  requiredPending,
  savedCount,
  link,
}: {
  readonly steps: readonly Step[]
  readonly sequence: readonly Step[]
  readonly answers: readonly Saved[]
  readonly language: InterviewLanguage
  readonly requiredPending: boolean
  readonly savedCount: number
  readonly link: (id: string) => string
}): ReactElement {
  const copy = interviewCopy[language]
  return (
    <>
      <h2>{copy.review}</h2>
      {requiredPending ? (
        <p role="status">{copy.pending}</p>
      ) : savedCount === sequence.length ? (
        <p>{copy.complete}</p>
      ) : null}
      <ol className="review-cards">
        {steps
          .filter(
            (item) =>
              sequence.includes(item) ||
              answers.some((saved) => saved.question.id === item.question.id),
          )
          .map((item) => {
            const saved = answers.find((answer) => answer.question.id === item.question.id)
            return (
              <li
                className={saved ? "answer-index-card" : "review-question-paper"}
                key={item.question.id}
              >
                <h2>{item.question.prompt[language]}</h2>
                <p className="response">{saved ? answerText(saved, language) : copy.empty}</p>
                <a href={link(item.question.id)}>
                  {copy.edit}: {item.question.prompt[language]}
                </a>
              </li>
            )
          })}
      </ol>
    </>
  )
}
