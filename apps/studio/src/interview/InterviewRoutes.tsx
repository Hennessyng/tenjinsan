import type { Answer } from "@reading-studio/contracts/choices"
import type { ReactElement } from "react"
import { useEffect, useState } from "react"
import type { z } from "zod"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { captureEditSave, requestDeparture } from "../library/useUnsavedEdits.ts"
import { SourceRequestError, sourceCommand, sourceRequest } from "../source-viewer/client.ts"
import { SourceFrame } from "../source-viewer/SourceRoutes.tsx"
import type { Interview } from "./client.ts"
import { InterviewList, InterviewState, SavedAnswer } from "./client.ts"
import { interviewCopy } from "./copy.ts"
import { InterviewGroups } from "./InterviewGroups.tsx"
import { InterviewQuestion } from "./InterviewQuestion.tsx"
import { InterviewReview } from "./InterviewReview.tsx"

type Page =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "list"; readonly definitions: z.infer<typeof InterviewList>["definitions"] }
  | { readonly kind: "interview"; readonly value: Interview }

export function InterviewRoutes(): ReactElement {
  const [, , study] = window.location.pathname.split("/")
  const params = new URLSearchParams(window.location.search)
  const { locale: language, t } = useLanguage()
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
      <SourceFrame>
        <p className="workspace-loading" role="status">
          {t("interview.loading")}
        </p>
      </SourceFrame>
    )
  if (page.kind === "error")
    return (
      <SourceFrame>
        <section className="setup workspace-error">
          <h1>{t("interview.unavailable.title")}</h1>
          <p>{t("interview.unavailable.body")}</p>
          <a href="/sources">{t("interview.unavailable.back")}</a>
        </section>
      </SourceFrame>
    )
  if (page.kind === "list")
    return (
      <SourceFrame>
        <section className="setup">
          <h1>{t("interview.list.title")}</h1>
          {page.definitions.length === 0 ? (
            <p className="workspace-empty">{t("interview.list.empty")}</p>
          ) : (
            <ul>
              {page.definitions.map((definition) => (
                <li key={definition.id}>
                  <a href={`/interviews/${definition.studyId}`}>
                    {definition.steps[0]?.question.prompt[language]}
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
      <SourceFrame>
        <p role="alert">{t("interview.unavailable.title")}</p>
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
    const committed = captureEditSave()
    setBusy(true)
    setError(false)
    try {
      await sourceCommand(
        `/api/interviews/${encodeURIComponent(study ?? "")}`,
        { interviewId: definition.id, ...answer },
        SavedAnswer,
      )
      committed()
      requestDeparture(() => window.location.assign(`${link(answer.questionId)}&saved=1`))
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
    <SourceFrame>
      <section className="setup interview" lang={language}>
        <p className="eyebrow">{t("interview.eyebrow")}</p>
        <h1>{copy.title}</h1>
        <p>{copy.intro}</p>
        <nav aria-label={t("interview.nav.language")}>
          <a
            href={link(review ? "~review" : step.question.id, "en")}
            lang="en"
            aria-current={language === "en" ? "true" : undefined}
          >
            {t("language.name.en")}
          </a>{" "}
          /{" "}
          <a
            href={link(review ? "~review" : step.question.id, "ja")}
            lang="ja"
            aria-current={language === "ja" ? "true" : undefined}
          >
            {t("language.name.ja")}
          </a>
        </nav>
        {review && (
          <>
            <label htmlFor="progress">
              {copy.progress} {savedCount} {copy.of} {sequence.length} {copy.suggested}
            </label>
            <progress id="progress" value={savedCount} max={sequence.length} />
          </>
        )}
        {params.get("saved") === "1" && (
          <p role="status" tabIndex={-1}>
            {copy.saved}
          </p>
        )}
        {review ? (
          <InterviewReview
            steps={definition.steps}
            sequence={sequence}
            answers={answers}
            language={language}
            requiredPending={requiredPending}
            savedCount={savedCount}
            link={link}
          />
        ) : (
          <>
            <div className="question-desk">
              <section className="question-paper" aria-labelledby="interview-question">
                <label htmlFor="progress">
                  {copy.progress} {savedCount} {copy.of} {sequence.length} {copy.suggested}
                </label>
                <progress id="progress" value={savedCount} max={sequence.length} />
                <InterviewQuestion
                  key={step.question.id}
                  step={step}
                  saved={current}
                  language={language}
                  submit={save}
                  busy={busy}
                  error={error}
                />
              </section>
              <aside className="question-guidance" aria-label={copy.hint}>
                <p>{copy.hint}</p>
              </aside>
            </div>
            <nav className="setup-actions" aria-label={t("interview.nav.steps")}>
              {back && <a href={link(back.question.id)}>{copy.back}</a>}
              {next && <a href={link(next.question.id)}>{copy.next}</a>}
              <a href={link("~review")}>{copy.review}</a>
            </nav>
          </>
        )}
        <InterviewGroups definition={definition} language={language} link={link} />
        <p>
          <a href={`/briefs/${definition.studyId}`}>{t("interview.link.brief")}</a>
        </p>
        <p>
          <a href={`/revisions/${definition.studyId}`}>{t("interview.link.revisions")}</a>
        </p>
      </section>
    </SourceFrame>
  )
}
