import { assertNever } from "@reading-studio/contracts/primitives"
import { useEffect, useRef, useState } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { sourceCommand, sourceRequest } from "../source-viewer/client.ts"
import { FullBookRun } from "./full-book-client.ts"

export function FullBookRunPanel({
  value,
  onChange,
  onNewPlan,
}: {
  readonly value: FullBookRun
  readonly onChange: (state: FullBookRun) => void
  readonly onNewPlan: () => void
}) {
  const { t } = useLanguage(),
    [busy, setBusy] = useState(false),
    [checked, setChecked] = useState(false),
    [error, setError] = useState("")
  const active = useRef<AbortController | null>(null),
    sequence = useRef(0),
    alert = useRef<HTMLParagraphElement>(null),
    heading = useRef<HTMLHeadingElement>(null)
  const base = `/api/full-book-test/${encodeURIComponent(value.setupId)}/runs/${encodeURIComponent(value.id)}`
  useEffect(() => () => active.current?.abort(), [])
  useEffect(() => {
    if (error) alert.current?.focus()
  }, [error])
  useEffect(() => {
    switch (value.state) {
      case "paused":
      case "running":
      case "received":
      case "unknown":
      case "failed":
      case "complete":
      case "cancelled":
        heading.current?.focus()
        break
      default:
        assertNever(value.state)
    }
  }, [value.state])
  async function command(action: "resume" | "cancel" | "decision", body: unknown = {}) {
    if (busy && action !== "cancel") return
    if (action === "cancel") active.current?.abort()
    const controller = new AbortController(),
      ticket = ++sequence.current
    active.current = controller
    setBusy(true)
    setError("")
    try {
      const state = await sourceCommand(`${base}/${action}`, body, FullBookRun, controller.signal)
      if (!controller.signal.aborted && ticket === sequence.current) {
        setChecked(false)
        onChange(state)
      }
    } catch (failure) {
      if (!(failure instanceof Error)) throw failure
      if (!controller.signal.aborted && ticket === sequence.current)
        setError(t("fullBook.runError"))
    } finally {
      if (active.current === controller) {
        active.current = null
        setBusy(false)
      }
    }
  }
  async function refresh() {
    try {
      const state = await sourceRequest(base, FullBookRun, AbortSignal.timeout(15000))
      setChecked(false)
      onChange(state)
    } catch (failure) {
      if (!(failure instanceof Error)) throw failure
      setError(t("fullBook.runError"))
    }
  }
  return (
    <section className="full-book-run-panel" aria-labelledby="full-book-run-state" aria-busy={busy}>
      <h2 id="full-book-run-state" ref={heading} tabIndex={-1}>
        {t(`fullBook.run.${value.state}`)}
      </h2>
      {value.runtime.kind === "fixture-not-live-evidence" && <p>{t("fullBook.fixtureRuntime")}</p>}
      <p>{t("fullBook.runScope")}</p>
      {value.usage && (
        <p>
          {t("fullBook.usageUnknown", {
            count: value.usage.filter((attempt) => attempt.usage.kind === "unknown").length,
          })}
        </p>
      )}
      {value.reviewRequired && <p role="status">{t("setup.stale")}</p>}
      <p>
        {t("fullBook.runCounts", {
          maximum: value.plannedMaxAttempts,
          used: value.usedAttempts,
          completed: value.completedNodes,
          jobs: value.plannedMaxJobs,
          unused: value.notNeededNodes,
        })}
      </p>
      <dl className="full-book-consent-details">
        <dt>{t("fullBook.spent")}</dt>
        <dd>{value.sourceBudget.spent}</dd>
        <dt>{t("fullBook.held")}</dt>
        <dd>{value.sourceBudget.held}</dd>
        <dt>{t("fullBook.unknown")}</dt>
        <dd>{value.sourceBudget.unknown}</dd>
        <dt>{t("fullBook.recipient")}</dt>
        <dd>
          {value.model}
          <br />
          {value.recipient?.observedAccount?.email ??
            value.recipient?.observedAccount?.accountId ??
            value.recipient?.accountId}
        </dd>
        <dt>{t("fullBook.runtimeIdentity")}</dt>
        <dd>
          {value.runtime.version}
          <code>{value.runtime.sha256}</code>
        </dd>
      </dl>
      {value.source && (
        <details>
          <summary>{t("fullBook.omissions")}</summary>
          <p>
            {t(
              value.source.coverage === "partial"
                ? "source.coverage.partial"
                : "source.coverage.complete",
            )}
          </p>
          <code>{value.source.hash}</code>
          <ul>
            {value.source.omissions.map((item) => (
              <li key={`${item.path}-${item.reason}`}>
                {item.path} · {item.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      {value.state === "unknown" && (
        <fieldset>
          <legend>{t("fullBook.run.unknown")}</legend>
          <label>
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            {t("fullBook.retryAck")}
          </label>
          {value.unknownAttempts.map((id) => (
            <div className="setup-actions" key={id}>
              <button
                type="button"
                disabled={
                  !checked ||
                  busy ||
                  value.reviewRequired ||
                  !value.retryableUnknownAttempts?.includes(id)
                }
                onClick={() =>
                  void command("decision", {
                    attemptId: id,
                    decision: "retry",
                    acknowledgeUnknownCharge: checked,
                  })
                }
              >
                {t("fullBook.approveRetry")}
              </button>
              <button type="button" onClick={() => void command("cancel")}>
                {t("fullBook.stopUnknown")}
              </button>
            </div>
          ))}
        </fieldset>
      )}
      <p>{t("fullBook.runWarning")}</p>
      {!value.native.enabled && <p>{t("fullBook.sendUnavailable")}</p>}
      <div className="setup-actions">
        <button
          type="button"
          disabled={!value.canResume || busy}
          onClick={() => void command("resume")}
        >
          {t("fullBook.resume")}
        </button>
        <button type="button" onClick={() => void refresh()}>
          {t("fullBook.refreshRun")}
        </button>
        <button type="button" disabled={value.revoked} onClick={() => void command("cancel")}>
          {t("fullBook.cancelRun")}
        </button>
        {value.canExport && (
          <a href={`${base}/export`} download>
            {t("fullBook.exportHistory")}
          </a>
        )}
      </div>
      {value.canExport && (
        <button type="button" onClick={onNewPlan}>
          {t("fullBook.newPlan")}
        </button>
      )}
      {error && (
        <p role="alert" ref={alert} tabIndex={-1}>
          {error}
        </p>
      )}
    </section>
  )
}
