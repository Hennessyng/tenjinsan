import type { CatalogKey } from "@reading-studio/contracts/i18n"
import type { ReactElement } from "react"
import { useState } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import type { JobStatus } from "./client.ts"
import { InputCoverage } from "./InputCoverage.tsx"

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

const stateLabels: Readonly<Record<string, CatalogKey>> = {
  queued: "jobs.state.queued",
  running: "jobs.state.running",
  paused: "jobs.state.paused",
  failed: "jobs.state.failed",
  completed: "jobs.state.completed",
  cancelled: "jobs.state.cancelled",
}
const stageLabels: Readonly<Record<string, CatalogKey>> = {
  analysis: "jobs.stage.analysis",
  outline: "jobs.stage.outline",
  lesson: "jobs.stage.lesson",
  synthesis: "jobs.stage.synthesis",
  questions: "jobs.stage.questions",
  brief: "jobs.stage.brief",
  evidence: "jobs.stage.evidence",
  publication: "jobs.stage.publication",
  artifact: "jobs.stage.artifact",
}

function UnknownDecision({
  job,
  busy,
  onAction,
  choice,
  action = "resolve",
}: Props & { readonly choice: Decision; readonly action?: "resolve" | "cancel" }): ReactElement {
  const { t } = useLanguage()
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
      <h4>{retry ? t("jobs.decision.retryTitle") : t("jobs.decision.stopTitle")}</h4>
      <label htmlFor={`${job.id}-${choice}-reason`}>{t("jobs.decision.reason")}</label>
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
        <span>{retry ? t("jobs.decision.retryConfirm") : t("jobs.decision.stopConfirm")}</span>
      </label>
      <button type="submit" disabled={busy || !confirmed || reason.trim().length < 8}>
        {retry ? t("jobs.decision.retrySubmit") : t("jobs.decision.stopSubmit")}
      </button>
    </form>
  )
}

export function JobEntry({ job, busy, onAction }: Props): ReactElement {
  const { t } = useLanguage()
  const active = job.state === "queued" || job.state === "running" || job.state === "paused"
  const stateKey = stateLabels[job.state]
  const stageKey = stageLabels[job.stage]
  const state = stateKey ? t(stateKey) : job.state
  const stage = stageKey ? t(stageKey) : job.stage
  return (
    <li className="job-entry">
      <article aria-labelledby={`job-${job.id}`}>
        <p className="eyebrow">
          {stage} / {state}
        </p>
        <h3 id={`job-${job.id}`}>
          {stage} · {state}
        </h3>
        <p className="metadata">
          {t("jobs.meta.study")} <code>{job.studyId}</code>
          <br />
          {t("jobs.meta.setup")} <code>{job.setupRevisionId}</code>
          <br />
          {t("jobs.meta.input")} <code>{job.inputRevisionId}</code>
          <br />
          {t("jobs.meta.job")} <code>{job.id}</code>
        </p>
        {job.section && (
          <p>
            {t("jobs.section", { n: job.section.index + 1 })} <code>{job.section.id}</code>
          </p>
        )}
        <p>
          {t("jobs.checkpoint", {
            status: job.checkpoint ? t("jobs.checkpoint.saved") : t("jobs.checkpoint.unsaved"),
            attempts: job.attempts,
          })}
        </p>
        <p>
          {job.usage.kind === "unknown"
            ? t("jobs.usage.unknown")
            : t("jobs.usage.known", {
                input: job.usage.inputTokens,
                output: job.usage.outputTokens,
              })}
        </p>
        <p>
          {t("jobs.budget", {
            setup: job.callBudgetRemaining,
            run: job.runBudgetRemaining,
            retries: job.retryRemaining,
          })}
        </p>
        <p className="metadata">
          {t("jobs.provider", { provider: job.provider, model: job.model })}
        </p>
        {job.failureCode && (
          <p role="status">
            {t("jobs.failureCode")} <code>{job.failureCode}</code>
          </p>
        )}
        <InputCoverage job={job} />
        {job.reason && (
          <p role="status">
            {t("jobs.pauseReason")} {job.reason}
          </p>
        )}
        {job.explanation && (
          <p role="status">
            {job.explanation} {t("jobs.trace")} <code>{job.trace_id}</code>
          </p>
        )}
        {job.cancellationRequested && job.state === "running" && (
          <p role="status">{t("jobs.cancelRequested")}</p>
        )}
        {job.unknownAttemptId ? (
          <div className="job-unknown">
            <h4>{t("jobs.unknown.title")}</h4>
            <p>{t("jobs.unknown.body")}</p>
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
                  {t("jobs.cancel")}
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
                  {t("jobs.retry")}
                </button>
                <p>
                  {t("jobs.retry.charge")}{" "}
                  {job.canRetry ? t("jobs.retry.auto") : t("jobs.retry.unavailable")}
                </p>
              </>
            )}
            {job.state === "paused" && <p>{t("jobs.paused")}</p>}
          </div>
        )}
        <nav className="job-links" aria-label={t("jobs.links.aria")}>
          <a href={`/revisions/${job.studyId}`}>{t("jobs.links.study")}</a>
          <a href={`/sources/${job.sourceRevisionId}`}>{t("jobs.links.source")}</a>
          <a href={`/sources/${job.sourceRevisionId}/setup`}>{t("jobs.links.setup")}</a>
          <a href={`/briefs/${job.studyId}`}>{t("jobs.links.brief")}</a>
          <a href={`/outlines/${job.studyId}`}>{t("jobs.links.outline")}</a>
          <a href={`/publications/${job.studyId}`}>{t("jobs.links.publication")}</a>
        </nav>
      </article>
    </li>
  )
}
