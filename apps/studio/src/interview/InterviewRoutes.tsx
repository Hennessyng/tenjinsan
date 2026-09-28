import type { Answer } from "@reading-studio/contracts/choices"
import type { ReactElement } from "react"
import { useEffect, useState } from "react"
import type { z } from "zod"
import { SourceRequestError, sourceCommand, sourceRequest } from "../source-viewer/client.ts"
import { SourceFrame } from "../source-viewer/SourceRoutes.tsx"
import { answerText } from "./answer-text.ts"
import type { Interview } from "./client.ts"
import { InterviewList, InterviewState, SavedAnswer } from "./client.ts"
import type { InterviewLanguage } from "./copy.ts"
import { interviewCopy } from "./copy.ts"
import { InterviewQuestion } from "./InterviewQuestion.tsx"

type Page =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "list"; readonly definitions: z.infer<typeof InterviewList>["definitions"] }
  | { readonly kind: "interview"; readonly value: Interview }

export function InterviewRoutes(): ReactElement {
  const [, , study] = window.location.pathname.split("/")
  const params = new URLSearchParams(window.location.search)
  const language: InterviewLanguage = params.get("lang") === "ja" ? "ja" : "en"
  const stepId = params.get("step")
  const copy = interviewCopy[language]
  const base = `/interviews/${study ?? ""}`
  const [page, setPage] = useState<Page>({ kind: "loading" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    document.documentElement.lang = language
    const controller = new AbortController()
    const load = study
      ? sourceRequest(
          `/api/interviews/${encodeURIComponent(study)}`,
          InterviewState,
          controller.signal,
        ).then((value) => ({ kind: "interview", value }) as const)
      : sourceRequest("/api/interviews", InterviewList, controller.signal).then(
          ({ definitions }) => ({ kind: "list", definitions }) as const,
        )
    load.then(setPage, () => {
      if (controller.signal.aborted) return
      setPage({ kind: "error" })
    })
    return () => controller.abort()
  }, [language, study])
  if (page.kind === "loading")
    return (
      <SourceFrame language={language}>
        <p role="status">Loading interview</p>
      </SourceFrame>
    )
  if (page.kind === "error")
    return (
      <SourceFrame language={language}>
        <section className="setup">
          <h1>Interview unavailable / 質問は未準備です</h1>
          <p>No saved question bank is available for this study.</p>
          <a href="/sources">Return to sources</a>
        </section>
      </SourceFrame>
    )
  if (page.kind === "list")
    return (
      <SourceFrame language={language}>
        <section className="setup">
          <h1>Reading interviews / 読書の質問</h1>
          {page.definitions.length === 0 ? (
            <p>No question bank is ready yet. / 質問はまだ準備されていません。</p>
          ) : (
            <ul>
              {page.definitions.map((definition) => (
                <li key={definition.id}>
                  <a href={`/interviews/${definition.studyId}`}>
                    {definition.steps[0]?.question.prompt.en} /{" "}
                    {definition.steps[0]?.question.prompt.ja}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </SourceFrame>
    )

  const { definition, answers } = page.value
  const sequence = [
    ...definition.shortlist.flatMap((id) =>
      definition.steps.filter((item) => item.question.id === id),
    ),
    ...definition.steps.filter(
      (item) => item.purpose === "approval" && !definition.shortlist.includes(item.question.id),
    ),
  ]
  const step = definition.steps.find((item) => item.question.id === stepId) ?? sequence[0]
  if (!step)
    return (
      <SourceFrame language={language}>
        <p role="alert">Interview unavailable</p>
      </SourceFrame>
    )
  const review = stepId === "~review"
  const current = answers.find((answer) => answer.question.id === step.question.id)
  const savedCount = sequence.filter((item) =>
    answers.some((answer) => answer.question.id === item.question.id),
  ).length
  const position = sequence.findIndex((item) => item.question.id === step.question.id)
  const back = sequence[position - 1]
  const next = sequence[position + 1]
  const link = (id: string, lang = language) =>
    `${base}?step=${encodeURIComponent(id)}&lang=${lang}`
  const requiredPending = definition.steps.some(
    (item) =>
      item.purpose === "approval" &&
      !answers.some((answer) => answer.question.id === item.question.id),
  )
  async function save(answer: Answer): Promise<void> {
    setBusy(true)
    setError(false)
    try {
      await sourceCommand(
        `/api/interviews/${encodeURIComponent(study ?? "")}`,
        { interviewId: definition.id, ...answer },
        SavedAnswer,
      )
      window.location.assign(`${link(answer.questionId)}&saved=1`)
    } catch (failure) {
      if (failure instanceof SourceRequestError) {
        setError(true)
        return
      }
      throw failure
    } finally {
      setBusy(false)
    }
  }
  return (
    <SourceFrame language={language}>
      <section className="setup interview" lang={language}>
        <p className="eyebrow">
          <span lang="en">READING</span> / {language === "en" ? "YOUR PERSPECTIVE" : "あなたの視点"}
        </p>
        <h1>{copy.title}</h1>
        <p>{copy.intro}</p>
        <nav aria-label={language === "en" ? "Language" : "言語"}>
          <a
            href={link(review ? "~review" : step.question.id, "en")}
            lang="en"
            aria-current={language === "en" ? "true" : undefined}
          >
            English
          </a>{" "}
          /{" "}
          <a
            href={link(review ? "~review" : step.question.id, "ja")}
            lang="ja"
            aria-current={language === "ja" ? "true" : undefined}
          >
            日本語
          </a>
        </nav>
        <label htmlFor="progress">
          {copy.progress} {savedCount} {copy.of} {sequence.length} {copy.suggested}
        </label>
        <progress id="progress" value={savedCount} max={sequence.length} />
        <p>{copy.hint}</p>
        {params.get("saved") === "1" && (
          <p role="status" tabIndex={-1}>
            {copy.saved}
          </p>
        )}
        {review ? (
          <>
            <h2>{copy.review}</h2>
            {requiredPending ? (
              <p role="status">{copy.pending}</p>
            ) : savedCount === sequence.length ? (
              <p>{copy.complete}</p>
            ) : null}
            <ol>
              {definition.steps
                .filter(
                  (item) =>
                    sequence.includes(item) ||
                    answers.some((saved) => saved.question.id === item.question.id),
                )
                .map((item) => {
                  const saved = answers.find((answer) => answer.question.id === item.question.id)
                  return (
                    <li key={item.question.id}>
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
        ) : (
          <>
            <InterviewQuestion
              key={step.question.id}
              step={step}
              saved={current}
              language={language}
              submit={save}
              busy={busy}
              error={error}
            />
            <nav
              className="setup-actions"
              aria-label={language === "en" ? "Interview steps" : "質問の移動"}
            >
              {back && <a href={link(back.question.id)}>{copy.back}</a>}
              {next && <a href={link(next.question.id)}>{copy.next}</a>}
              <a href={link("~review")}>{copy.review}</a>
            </nav>
          </>
        )}
        <h2>{copy.browse}</h2>
        {definition.groups.map((group) => (
          <details key={group.id}>
            <summary>{group.label[language]}</summary>
            <ul>
              {definition.steps
                .filter((item) => item.groupId === group.id)
                .map((item) => (
                  <li key={item.question.id}>
                    <a href={link(item.question.id)}>
                      {item.question.lens?.label[language] ?? item.question.prompt[language]}
                    </a>
                  </li>
                ))}
            </ul>
          </details>
        ))}
        <p>
          <a href={`/briefs/${definition.studyId}`}>
            Reading brief / <span lang="ja">読書方針を確認</span>
          </a>
        </p>
        <p>
          <a href={`/revisions/${definition.studyId}`}>
            Study revisions / <span lang="ja">読書の版</span>
          </a>
        </p>
      </section>
    </SourceFrame>
  )
}
