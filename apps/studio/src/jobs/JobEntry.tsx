import type { ReactElement } from "react"
import { useState } from "react"
import type { JobStatus } from "./client.ts"

type Decision = "stop-approved" | "retry-approved"
type Props = {
  readonly job: JobStatus
  readonly busy: boolean
  readonly onAction: (
    job: JobStatus,
    action: "cancel" | "retry" | "resolve",
    choice?: Decision,
    reason?: string,
  ) => void
}

function UnknownDecision({
  job,
  busy,
  onAction,
  choice,
  action = "resolve",
}: Props & { readonly choice: Decision; readonly action?: "resolve" | "cancel" }): ReactElement {
  const [reason, setReason] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const retry = choice === "retry-approved"
  return (
    <form
      className="job-decision"
      onSubmit={(event) => {
        event.preventDefault()
        if (confirmed) onAction(job, action, choice, reason)
      }}
    >
      <h4>{retry ? "Approve another attempt / 再試行を承認" : "Stop this work / 作業を停止"}</h4>
      <label htmlFor={`${job.id}-${choice}-reason`}>
        Reason for this decision / <span lang="ja">判断の理由</span>
      </label>
      <textarea
        id={`${job.id}-${choice}-reason`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        required
        minLength={8}
        maxLength={500}
      />
      <label className="job-check">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          required
        />
        <span>
          {retry
            ? "I approve a new provider call that may incur another charge."
            : "I understand stopping cannot retract an accepted call or its charge."}
          <br />
          <span lang="ja">
            {retry
              ? "新たな呼び出しで再び料金が発生する可能性を承認します。"
              : "停止しても受理済みの呼び出しや料金は取り消せません。"}
          </span>
        </span>
      </label>
      <button type="submit" disabled={busy || !confirmed || reason.trim().length < 8}>
        {retry ? "Approve retry / 再試行を承認" : "Confirm stop / 停止を確定"}
      </button>
    </form>
  )
}

export function JobEntry({ job, busy, onAction }: Props): ReactElement {
  const active = job.state === "queued" || job.state === "running" || job.state === "paused"
  return (
    <li className="job-entry">
      <article aria-labelledby={`job-${job.id}`}>
        <p className="eyebrow">
          {job.stage.toUpperCase()} / {job.state.toUpperCase()}
        </p>
        <h3 id={`job-${job.id}`}>
          {job.stage} · {job.state}{" "}
          <span lang="ja">
            {job.state === "paused"
              ? "一時停止"
              : job.state === "failed"
                ? "失敗"
                : job.state === "completed"
                  ? "完了"
                  : job.state === "cancelled"
                    ? "中止"
                    : job.state === "running"
                      ? "処理中"
                      : "待機中"}
          </span>
        </h3>
        <p className="metadata">
          Study / 読書: <code>{job.studyId}</code>
          <br />
          Setup / 設定: <code>{job.setupRevisionId}</code>
          <br />
          Input revision / 入力版: <code>{job.inputRevisionId}</code>
          <br />
          Job / 作業: <code>{job.id}</code>
        </p>
        {job.section && (
          <p>
            Outline section {job.section.index + 1} /{" "}
            <span lang="ja">構成の節 {job.section.index + 1}</span>: <code>{job.section.id}</code>
          </p>
        )}
        <p>
          Checkpoint / <span lang="ja">保存地点</span>:{" "}
          {job.checkpoint ? "Saved / 保存済み" : "Not yet saved / 未保存"} · Attempts /{" "}
          <span lang="ja">試行</span>: {job.attempts}
        </p>
        <p>
          Usage / <span lang="ja">使用量</span>:{" "}
          {job.usage.kind === "unknown"
            ? "Unknown tokens / トークン数不明"
            : `${job.usage.inputTokens} input + ${job.usage.outputTokens} output tokens / 入力・出力トークン`}
        </p>
        <p>
          Calls remaining in setup / <span lang="ja">設定全体の残り呼び出し</span>:{" "}
          {job.callBudgetRemaining} of 64 · Run / <span lang="ja">この実行</span>:{" "}
          {job.runBudgetRemaining} · Explicit retries remaining /{" "}
          <span lang="ja">明示的な再試行の残り</span>: {job.retryRemaining}
        </p>
        <p className="metadata">
          Provider / プロバイダー: {job.provider} · {job.model}. Provider charges not returned;
          token counts are not currency.{" "}
          <span lang="ja">料金情報は返されません。トークン数は金額ではありません。</span>
        </p>
        {job.failureCode && (
          <p role="status">
            Failure code / <span lang="ja">失敗コード</span>: <code>{job.failureCode}</code>
          </p>
        )}
        {job.reason && (
          <p role="status">
            Pause reason / <span lang="ja">停止理由</span>: {job.reason}
          </p>
        )}
        {job.cancellationRequested && job.state === "running" && (
          <p role="status">
            Cancellation requested; an accepted call may still finish or incur a charge. /{" "}
            <span lang="ja">
              中止を依頼しました。受理済みの呼び出しが完了し料金が発生する場合があります。
            </span>
          </p>
        )}
        {job.unknownAttemptId ? (
          <div className="job-unknown">
            <h4>
              Outcome unknown / <span lang="ja">結果を確認できません</span>
            </h4>
            <p lang="en">
              The provider may have accepted this call and charged for it. Do not treat its usage as
              zero. Stopping will not undo a charge; retrying may spend again. Choose and confirm a
              decision.
            </p>
            <p lang="ja">
              呼び出しが受理され料金が発生した可能性があります。使用量はゼロとは限りません。停止しても料金は取り消せず、再試行で再び料金がかかる場合があります。
            </p>
            <div className="job-decisions">
              <UnknownDecision job={job} busy={busy} onAction={onAction} choice="stop-approved" />
              <UnknownDecision
                job={job}
                busy={busy || job.callBudgetRemaining === 0 || job.runBudgetRemaining === 0}
                onAction={onAction}
                choice="retry-approved"
              />
            </div>
          </div>
        ) : (
          <div className="job-actions">
            {job.state === "running" && !job.cancellationRequested ? (
              <UnknownDecision
                job={job}
                busy={busy}
                onAction={onAction}
                choice="stop-approved"
                action="cancel"
              />
            ) : (
              active &&
              !job.cancellationRequested && (
                <button type="button" disabled={busy} onClick={() => onAction(job, "cancel")}>
                  Cancel work / <span lang="ja">作業を中止</span>
                </button>
              )
            )}
            {job.state === "failed" && (
              <>
                <button
                  type="button"
                  disabled={busy || !job.canRetry}
                  onClick={() => onAction(job, "retry")}
                >
                  Approve retry / <span lang="ja">再試行を承認</span>
                </button>
                <p>
                  Another provider call may incur a charge.{" "}
                  {job.canRetry
                    ? "No automatic retry or model change."
                    : "Retry unavailable: inspect the current approval, call budget or retry limit."}{" "}
                  /{" "}
                  <span lang="ja">
                    再試行で料金が発生する場合があります。自動再試行やモデル変更はありません。
                  </span>
                </p>
              </>
            )}
            {job.state === "paused" && (
              <p>
                Pause requires review of the current setup or budget. No automatic provider change.
                /{" "}
                <span lang="ja">
                  現在の設定と上限を確認してください。プロバイダーは自動変更されません。
                </span>
              </p>
            )}
          </div>
        )}
        <nav className="job-links" aria-label="Study lineage / 読書の経路">
          <a href={`/revisions/${job.studyId}`}>Study / 読書</a>
          <a href={`/sources/${job.sourceRevisionId}`}>Source / 資料</a>
          <a href={`/sources/${job.sourceRevisionId}/setup`}>New setup / 新しい設定</a>
          <a href={`/briefs/${job.studyId}`}>Brief / 目的</a>
          <a href={`/outlines/${job.studyId}`}>Outline / 構成</a>
          <a href={`/publications/${job.studyId}`}>Lesson and output / 教材と出力</a>
        </nav>
      </article>
    </li>
  )
}
