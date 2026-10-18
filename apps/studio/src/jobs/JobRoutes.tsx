import type { ReactElement } from "react"
import { useContext, useEffect, useRef, useState } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { SelectedLibraryStudy } from "../library/client.ts"
import { SourceRequestError, sourceCommand, sourceRequest } from "../source-viewer/client.ts"
import { SourceFrame } from "../source-viewer/SourceRoutes.tsx"
import { type JobStatus as Job, JobList, JobStatus } from "./client.ts"
import { JobEntry } from "./JobEntry.tsx"

export function JobRoutes(): ReactElement {
  const { t } = useLanguage()
  const selected = useContext(SelectedLibraryStudy)
  const studyId = selected === undefined ? undefined : (selected?.id ?? null)
  const [jobs, setJobs] = useState<readonly Job[] | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const alert = useRef<HTMLParagraphElement>(null)
  const initiatingControl = useRef<HTMLElement>(null)
  const refreshControl = useRef<HTMLButtonElement>(null)
  const [observation, setObservation] = useState(0)
  const requestGeneration = useRef("")
  useEffect(() => {
    if (busy) return
    const control = initiatingControl.current
    initiatingControl.current = null
    if (control && document.activeElement === document.body) {
      if (control.isConnected) control.focus()
      else refreshControl.current?.focus()
    }
  }, [busy])
  useEffect(() => {
    const generation = `${studyId}:${observation}`
    requestGeneration.current = generation
    let active = true
    let controller: AbortController | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    setJobs(null)
    const observe = async () => {
      if (!active || document.hidden || controller) return
      controller = new AbortController()
      const request = controller
      try {
        const value = await sourceRequest("/api/study-jobs", JobList, request.signal)
        if (!active || request.signal.aborted || requestGeneration.current !== generation) return
        setJobs(value.jobs.filter((job) => studyId === undefined || job.studyId === studyId))
        setError("")
        failures = 0
      } catch (failure) {
        if (!active || request.signal.aborted) return
        if (!(failure instanceof Error)) throw failure
        failures += 1
        setError(
          failure instanceof SourceRequestError && failure.status === 503
            ? t("jobs.error.maintenance")
            : t("jobs.error.unavailable"),
        )
      } finally {
        if (controller === request) controller = null
        if (active && !request.signal.aborted && !document.hidden)
          timer = setTimeout(
            () => {
              void observe()
            },
            failures === 0 ? 2000 : failures === 1 ? 5000 : 15000,
          )
      }
    }
    const visibility = () => {
      clearTimeout(timer)
      controller?.abort()
      if (!document.hidden) {
        controller = null
        void observe()
      }
    }
    void observe()
    document.addEventListener("visibilitychange", visibility)
    return () => {
      active = false
      clearTimeout(timer)
      controller?.abort()
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [studyId, observation, t])
  async function refresh(): Promise<void> {
    setObservation((value) => value + 1)
  }
  async function act(
    job: Job,
    action: "cancel" | "retry" | "resolve",
    choice?: "stop-approved" | "retry-approved",
    reason?: string,
  ): Promise<void> {
    initiatingControl.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setBusy(true)
    setError("")
    try {
      const updated = await sourceCommand(
        `/api/study-jobs/${encodeURIComponent(job.id)}/${action}`,
        {
          expectedSetupRevisionId: job.setupRevisionId,
          ...(choice ? { choice, confirmation: choice, reason } : {}),
        },
        JobStatus,
      )
      setJobs(
        (current) => current?.map((entry) => (entry.id === updated.id ? updated : entry)) ?? null,
      )
      setObservation((value) => value + 1)
    } catch (failure) {
      setError(
        failure instanceof SourceRequestError && failure.status === 409
          ? t("jobs.error.changed")
          : t("jobs.error.decision"),
      )
      requestAnimationFrame(() => alert.current?.focus())
    } finally {
      setBusy(false)
    }
  }
  return (
    <SourceFrame>
      <section className="job-ledger">
        <p className="eyebrow">{t("jobs.eyebrow")}</p>
        <h1>{t("jobs.title")}</h1>
        <p>{t("jobs.intro")}</p>
        <p>{t("jobs.charges")}</p>
        {error && (
          <p role="alert" ref={alert} tabIndex={-1}>
            {error}
          </p>
        )}
        <button
          type="button"
          className="job-refresh"
          ref={refreshControl}
          disabled={busy}
          onClick={() => {
            void refresh()
          }}
        >
          {t("jobs.refresh")}
        </button>
        {jobs === null && !error && (
          <p className="workspace-loading" role="status">
            {t("jobs.loading")}
          </p>
        )}
        {jobs?.length === 0 && (
          <p className="workspace-empty" role="status">
            {t("jobs.empty")} <a href="/sources">{t("jobs.sourcesLink")}</a>
          </p>
        )}
        {jobs && jobs.length > 0 && (
          <ol className="job-list">
            {jobs.map((job) => (
              <JobEntry
                key={job.id}
                job={job}
                busy={busy}
                onAction={(entry, action, choice, reason) => {
                  void act(entry, action, choice, reason)
                }}
              />
            ))}
          </ol>
        )}
      </section>
    </SourceFrame>
  )
}
