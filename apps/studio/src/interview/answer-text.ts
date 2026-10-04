import type { Saved } from "./client.ts"
import type { InterviewLanguage } from "./copy.ts"
import { interviewCopy } from "./copy.ts"

export function answerText(saved: Saved, language: InterviewLanguage): string {
  const { answer, question } = saved
  switch (answer.kind) {
    case "choice": {
      const selected = new Set(answer.optionIds)
      return question.options
        .filter((option) => selected.has(option.id))
        .map((option) => option.label[language])
        .join(" · ")
    }
    case "custom":
      return answer.text
    case "unsure":
      return interviewCopy[language].unsure
    case "skipped":
      return interviewCopy[language].skipped
    default:
      return assertNever(answer)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected answer: ${String(value)}`)
}
