import type { FormEvent, ReactElement } from "react"
import { useEffect, useRef, useState } from "react"
import { answerText } from "./answer-text.ts"
import type { Saved, Step } from "./client.ts"
import type { InterviewLanguage } from "./copy.ts"
import { interviewCopy } from "./copy.ts"

type Answer = Saved["answer"]

export function InterviewQuestion({
  step,
  saved,
  language,
  submit,
  busy,
  error,
}: {
  readonly step: Step
  readonly saved: Saved | undefined
  readonly language: InterviewLanguage
  readonly submit: (answer: Answer) => void
  readonly busy: boolean
  readonly error: boolean
}): ReactElement {
  const { question } = step
  const copy = interviewCopy[language]
  const [selected, setSelected] = useState<readonly string[]>(
    saved?.answer.kind === "choice" ? saved.answer.optionIds : [],
  )
  const [custom, setCustom] = useState(saved?.answer.kind === "custom" ? saved.answer.text : "")
  const alert = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (error) alert.current?.focus()
  }, [error])
  const reference = { questionId: question.id, questionRevisionId: question.revisionId }
  function saveChoices(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    submit({
      ...reference,
      kind: "choice",
      optionIds: question.options
        .filter((option) => selected.includes(option.id))
        .map((option) => option.id),
    })
  }
  function saveCustom(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    submit({ ...reference, kind: "custom", text: custom })
  }
  return (
    <>
      <h2 id="interview-question" tabIndex={-1}>
        {question.prompt[language]}
      </h2>
      {saved && (
        <p className="response">
          {copy.progress}: {answerText(saved, language)}
        </p>
      )}
      {error && (
        <p ref={alert} role="alert" tabIndex={-1}>
          {copy.error}
        </p>
      )}
      <p id="selection-limit">
        {copy.range} {question.minSelections} {copy.to} {question.maxSelections} {copy.choices}.
      </p>
      {step.purpose === "approval" && <p>{copy.required}</p>}
      <form onSubmit={saveChoices}>
        <fieldset aria-describedby="selection-limit">
          <legend>{question.prompt[language]}</legend>
          {question.options.map((option) => (
            <label className="answer-card" key={option.id}>
              <input
                type={question.mode === "single" ? "radio" : "checkbox"}
                name="optionIds"
                value={option.id}
                checked={selected.includes(option.id)}
                onChange={(event) =>
                  setSelected(
                    question.mode === "single"
                      ? [option.id]
                      : event.target.checked
                        ? [...selected, option.id]
                        : selected.filter((id) => id !== option.id),
                  )
                }
              />
              <span>{option.label[language]}</span>
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={busy}>
          {copy.save}
        </button>
      </form>
      {question.policy.custom && (
        <form onSubmit={saveCustom}>
          <label htmlFor="custom">{copy.custom}</label>
          <textarea
            id="custom"
            rows={4}
            maxLength={12000}
            required
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
          />
          <button type="submit" disabled={busy}>
            {copy.saveCustom}
          </button>
        </form>
      )}
      <div className="setup-actions">
        {question.policy.unsure && (
          <button
            type="button"
            disabled={busy}
            onClick={() => submit({ ...reference, kind: "unsure" })}
          >
            {copy.unsure}
          </button>
        )}
        {question.policy.skip && (
          <button
            type="button"
            disabled={busy}
            onClick={() => submit({ ...reference, kind: "skipped" })}
          >
            {copy.skip}
          </button>
        )}
      </div>
    </>
  )
}
