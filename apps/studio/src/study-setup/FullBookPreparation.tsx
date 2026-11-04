import { useEffect, useRef, useState } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { sourceCommand } from "../source-viewer/client.ts"
import { FullBookConsentPanel } from "./FullBookConsentPanel.tsx"
import { FullBookRunPanel } from "./FullBookRunPanel.tsx"
import { FullBookSavedRuns } from "./FullBookSavedRuns.tsx"
import { FullBookSummary } from "./FullBookSummary.tsx"
import { FullBookReview, type FullBookRun, fullBookOptions } from "./full-book-client.ts"

export function FullBookPreparation({
  setupId,
  onCancel,
}: {
  readonly setupId: string
  readonly onCancel: () => void
}) {
  const { t } = useLanguage()
  const [ceiling, setCeiling] = useState("")
  const [findings, setFindings] = useState("120")
  const [review, setReview] = useState<FullBookReview | null>(null)
  const [run, setRun] = useState<FullBookRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const active = useRef<AbortController | null>(null)
  const result = useRef<HTMLParagraphElement>(null)
  useEffect(() => () => active.current?.abort(), [])
  useEffect(() => {
    if (message) result.current?.focus()
  }, [message])
  function revise() {
    active.current?.abort()
    active.current = null
    setBusy(false)
    setReview(null)
    setMessage("")
  }
  async function prepare(refresh: boolean) {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setMessage("")
    const options = fullBookOptions(Number(ceiling), Number(findings))
    const prior = review
    setReview(null)
    try {
      const current = await sourceCommand(
        `/api/full-book-test/${encodeURIComponent(setupId)}/${refresh ? "review" : "prepare"}`,
        refresh && prior ? { options, reviewBinding: prior.reviewBinding } : options,
        FullBookReview,
        controller.signal,
      )
      if (!controller.signal.aborted) {
        setReview(current)
        setMessage(t("fullBook.reviewed"))
      }
    } catch (error) {
      if (controller.signal.aborted) return
      if (error instanceof Error) setMessage(t("fullBook.error"))
      else throw error
    } finally {
      if (active.current === controller) {
        active.current = null
        setBusy(false)
      }
    }
  }
  if (run)
    return (
      <section className="setup">
        <h1>{t("fullBook.heading")}</h1>
        <FullBookRunPanel
          key={run.id}
          value={run}
          onChange={(state) => setRun((current) => (current?.id === state.id ? state : current))}
          onNewPlan={() => {
            setRun(null)
            setReview(null)
            setCeiling("")
            setMessage("")
          }}
        />
      </section>
    )
  return (
    <section className="setup" aria-busy={busy}>
      <p className="eyebrow">full-book-test-1</p>
      <h1>{t("fullBook.heading")}</h1>
      <p id="full-book-disabled" role="status">
        {t("fullBook.disabled")}
      </p>
      <p>{t("fullBook.scope")}</p>
      <p>{t("fullBook.route")}</p>
      <FullBookSavedRuns
        setupId={setupId}
        onSelect={(state) => {
          setReview(null)
          setRun(state)
        }}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void prepare(false)
        }}
      >
        <label>
          {t("fullBook.ceiling")}
          <input
            type="number"
            min="1"
            max="10000"
            step="1"
            required
            value={ceiling}
            onChange={(event) => {
              revise()
              setCeiling(event.target.value)
            }}
          />
        </label>
        <label>
          {t("fullBook.findings")}
          <input
            type="number"
            min="1"
            max="1024"
            step="1"
            required
            value={findings}
            onChange={(event) => {
              revise()
              setFindings(event.target.value)
            }}
          />
        </label>
        <details>
          <summary>{t("fullBook.limits")}</summary>
          <p>{t("fullBook.limitsNote")}</p>
        </details>
        <div className="setup-actions">
          <button type="submit" disabled={busy}>
            {t("fullBook.prepare")}
          </button>
        </div>
      </form>
      {busy && <p role="status">{t("fullBook.busy")}</p>}
      {message && (
        <p role={review ? "status" : "alert"} ref={result} tabIndex={-1}>
          {message}
        </p>
      )}
      {review && <FullBookSummary value={review} />}
      {review && (
        <FullBookConsentPanel
          key={review.reviewBinding}
          review={review}
          onSaved={(state) => {
            setReview(null)
            setRun(state)
          }}
        />
      )}
      <p id="full-book-send-reason">{t("fullBook.sendUnavailable")}</p>
      <div className="setup-actions">
        {review && (
          <button type="button" disabled={busy} onClick={() => void prepare(true)}>
            {t("fullBook.refresh")}
          </button>
        )}
        <button type="button" disabled aria-describedby="full-book-send-reason">
          {t("setup.send")}
        </button>
        <button
          type="button"
          onClick={() => {
            revise()
            onCancel()
          }}
        >
          {t("setup.cancel")}
        </button>
      </div>
      <p>{t("fullBook.noRun")}</p>
    </section>
  )
}
