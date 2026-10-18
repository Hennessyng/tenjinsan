import type { ReactElement } from "react"
import { useEffect, useRef, useState } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { captureEditSave } from "../library/useUnsavedEdits.ts"
import { SourceRequestError, sourceCommand, sourceRequest } from "../source-viewer/client.ts"
import { SourceFrame } from "../source-viewer/SourceRoutes.tsx"
import type { Evidence, EvidenceAction } from "./client.ts"
import { EvidenceState, LatestLesson } from "./client.ts"
import { evidenceStatus } from "./copy.ts"
import { EvidenceReviewControls } from "./EvidenceReviewControls.tsx"
import { EvidenceSources } from "./EvidenceSources.tsx"
import { EvidenceValues } from "./EvidenceValues.tsx"
import "./review-room.css"

export function EvidenceRoutes(): ReactElement {
  const { t } = useLanguage()
  const [, , study, lesson] = window.location.pathname.split("/")
  const endpoint = `/api/evidence/${encodeURIComponent(study ?? "")}/${encodeURIComponent(lesson ?? "")}`
  const [state, setState] = useState<Evidence | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState("")
  const alert = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    if (!lesson) {
      sourceRequest(
        `/api/evidence/${encodeURIComponent(study ?? "")}`,
        LatestLesson,
        controller.signal,
      ).then(
        ({ lessonId }) => window.location.assign(`/evidence/${study}/${lessonId}`),
        () => {
          if (!controller.signal.aborted) setError(true)
        },
      )
    } else {
      sourceRequest(endpoint, EvidenceState, controller.signal).then(
        setState,
        (failure: unknown) => {
          if (controller.signal.aborted) return
          if (failure instanceof SourceRequestError) setError(true)
          else throw failure
        },
      )
    }
    return () => controller.abort()
  }, [endpoint, lesson, study])
  useEffect(() => {
    if (error) alert.current?.focus()
  }, [error])
  async function act(action: EvidenceAction): Promise<void> {
    const committed = captureEditSave()
    if (!state) return
    setBusy(true)
    setError(false)
    try {
      setState(
        await sourceCommand(
          endpoint,
          { expectedId: state.view.draft.id, ...action },
          EvidenceState,
        ),
      )
      if (action.action === "private-detail") {
        setDetail("")
        committed(true)
      } else committed()
    } catch (failure) {
      if (failure instanceof SourceRequestError) {
        setState(await sourceRequest(endpoint, EvidenceState, new AbortController().signal))
        setError(true)
      } else throw failure
    } finally {
      setBusy(false)
    }
  }
  if (!state)
    return (
      <SourceFrame>
        {error ? (
          <p role="alert">{t("evidence.unavailable")}</p>
        ) : (
          <p className="workspace-loading" role="status">
            {t("evidence.loading")}
          </p>
        )}
      </SourceFrame>
    )
  const { view } = state
  const { draft, privacy } = view
  return (
    <SourceFrame>
      <section className="setup evidence evidence-review">
        <p className="eyebrow">{t("evidence.eyebrow")}</p>
        <h1>{t("evidence.title")}</h1>
        <nav>
          <a href={`/outlines/${draft.studyId}`}>{t("outline.title")}</a>
        </nav>
        {error && (
          <p ref={alert} role="alert" tabIndex={-1}>
            {t("evidence.error")}
          </p>
        )}
        <p className="review-stamp" role="status">
          {draft.keepPrivate
            ? t("evidence.state.private")
            : view.ready
              ? t("evidence.state.ready")
              : t("evidence.state.review")}
        </p>
        <p className="metadata">
          {t("evidence.lesson")} {draft.lessonRevisionId}
          <br />
          {t("evidence.projection")} {draft.projectionHash}
          <br />
          {t("evidence.report")} {view.reportHash}
        </p>
        <section className="review-paper" aria-label={t("evidence.sourceAria")}>
          <EvidenceSources value={state} />
        </section>
        <section className="review-paper" aria-labelledby="meaning-review-title">
          <h2 id="meaning-review-title">{t("evidence.meaning")}</h2>
          <div className="meaning-review">
            <p className="review-caution">{t("evidence.meaningNote")}</p>
            <EvidenceReviewControls semantic={draft.semantic} busy={busy} onAction={act} />
          </div>
        </section>
        <section className="review-paper" aria-labelledby="privacy-review-title">
          <h2 id="privacy-review-title">{t("evidence.privacy")}</h2>
          <p>{t("evidence.privacyNote", { count: privacy.reviewedPaths.length })}</p>
          <ul>
            {privacy.findings.map((finding) => (
              <li role="alert" key={`${finding.path}-${finding.category}`}>
                {finding.category}:{" "}
                <a href="#projected-content">
                  <code>{finding.path}</code>
                </a>{" "}
                — {t("evidence.removeGeneralize")}
              </li>
            ))}
          </ul>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void act({ action: "private-detail", text: detail })
            }}
          >
            <label htmlFor="private-detail">{t("evidence.privateDetail")}</label>
            <input
              id="private-detail"
              required
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
            />
            <button type="submit" disabled={busy}>
              {t("evidence.screen")}
            </button>
          </form>
          <div className="setup-actions">
            <button
              type="button"
              disabled={busy || privacy.findings.length > 0}
              onClick={() => {
                void act({ action: "privacy-reviewed" })
              }}
            >
              {t("evidence.confirmPrivacy")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void act({ action: "keep-private" })
              }}
            >
              {t("evidence.keepPrivate")}
            </button>
          </div>
          <p>{t("evidence.privacyStatus", { status: evidenceStatus(privacy.status, t) })}</p>
        </section>
        <EvidenceValues
          value={state}
          onAction={(action) => {
            void act(action)
          }}
          busy={busy}
        />
      </section>
    </SourceFrame>
  )
}
