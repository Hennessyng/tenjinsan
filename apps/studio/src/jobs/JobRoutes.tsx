import type { ReactElement } from "react"
import { useContext, useEffect, useRef, useState } from "react"
import { SelectedLibraryStudy } from "../library/client.ts"
import { SourceRequestError, sourceCommand, sourceRequest } from "../source-viewer/client.ts"
import { SourceFrame } from "../source-viewer/SourceRoutes.tsx"
import { type JobStatus as Job, JobList, JobStatus } from "./client.ts"
import { JobEntry } from "./JobEntry.tsx"

export function JobRoutes(): ReactElement {
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
        if (failure instanceof SourceRequestError && failure.status === 401) {
          active = false
          setJobs(null)
        }
        failures += 1
        setError(
          failure instanceof SourceRequestError && failure.status === 503
            ? "Library maintenance in progress / メンテナンス中"
            : "Jobs unavailable; showing last recorded state. / 作業を取得できません。最後の記録を表示しています。",
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
  }, [studyId, observation])
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
          ? "This job changed. Refresh before deciding. / 状態が変わりました。更新してから選び直してください。"
          : "Decision unavailable. Review the current setup. / 操作できません。現在の設定を確認してください。",
      )
      requestAnimationFrame(() => alert.current?.focus())
    } finally {
      setBusy(false)
    }
  }
  return (
    <SourceFrame>
      <section className="job-ledger">
        <p className="eyebrow">PRIVATE STUDIO / WORK LEDGER</p>
        <h1>
          Study progress <span lang="ja">学習の進行状況</span>
        </h1>
        <p lang="en">
          Follow each approved step without showing private source passages or provider responses.
        </p>
        <p lang="ja">本文やプロバイダーの回答を表示せず、承認済みの工程を確認します。</p>
        <p lang="en">
          Accepted calls can incur charges even when their outcome is unknown. No provider or model
          changes here.
        </p>
        <p lang="ja">
          結果が不明な呼び出しにも料金が発生する場合があります。ここではモデルを変更できません。
        </p>
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
          Refresh status / <span lang="ja">状態を更新</span>
        </button>
        {jobs === null && !error && (
          <p className="workspace-loading" role="status">
            Loading jobs / <span lang="ja">作業を読み込み中</span>
          </p>
        )}
        {jobs?.length === 0 && (
          <p className="workspace-empty" role="status">
            No jobs on a current approved setup. Begin from your sources. /{" "}
            <span lang="ja">現在の承認済み設定には作業がありません。資料から始めてください。</span>{" "}
            <a href="/sources">Your sources / 資料一覧</a>
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
