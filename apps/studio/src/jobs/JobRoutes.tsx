import type { ReactElement } from "react"
import { useEffect, useRef, useState } from "react"
import { SourceRequestError, sourceCommand, sourceRequest } from "../source-viewer/client.ts"
import { SourceFrame } from "../source-viewer/SourceRoutes.tsx"
import { type JobStatus as Job, JobList, JobStatus } from "./client.ts"
import { JobEntry } from "./JobEntry.tsx"

export function JobRoutes(): ReactElement {
  const [jobs, setJobs] = useState<readonly Job[] | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const alert = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    sourceRequest("/api/study-jobs", JobList, controller.signal).then(
      (value) => setJobs(value.jobs),
      (failure: unknown) => {
        if (controller.signal.aborted) return
        setError(
          failure instanceof SourceRequestError && failure.status === 503
            ? "Library maintenance in progress / メンテナンス中"
            : "Jobs unavailable. Try again later. / 作業を表示できません。後でもう一度お試しください。",
        )
      },
    )
    return () => controller.abort()
  }, [])
  useEffect(() => {
    if (error) alert.current?.focus()
  }, [error])
  async function refresh(): Promise<void> {
    setBusy(true)
    setError("")
    try {
      setJobs((await sourceRequest("/api/study-jobs", JobList, new AbortController().signal)).jobs)
    } catch (failure) {
      setError(
        failure instanceof SourceRequestError && failure.status === 503
          ? "Library maintenance in progress / メンテナンス中"
          : "Jobs unavailable. Try again later. / 作業を表示できません。後でもう一度お試しください。",
      )
    } finally {
      setBusy(false)
    }
  }
  async function act(
    job: Job,
    action: "cancel" | "retry" | "resolve",
    choice?: "stop-approved" | "retry-approved",
    reason?: string,
  ): Promise<void> {
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
    } catch (failure) {
      setError(
        failure instanceof SourceRequestError && failure.status === 409
          ? "This job changed. Refresh before deciding. / 状態が変わりました。更新してから選び直してください。"
          : "Decision unavailable. Review the current setup. / 操作できません。現在の設定を確認してください。",
      )
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
          disabled={busy}
          onClick={() => {
            void refresh()
          }}
        >
          Refresh status / <span lang="ja">状態を更新</span>
        </button>
        {jobs === null && !error && (
          <p role="status">
            Loading jobs / <span lang="ja">作業を読み込み中</span>
          </p>
        )}
        {jobs?.length === 0 && (
          <p role="status">
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
