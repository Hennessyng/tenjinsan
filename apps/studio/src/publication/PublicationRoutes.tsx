import { DEFAULT_EXPORT_UI, ExportUi } from "@reading-studio/contracts"
import type { ReactElement } from "react"
import { useEffect, useRef, useState } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { captureEditSave } from "../library/useUnsavedEdits.ts"
import { SourceRequestError, sourceCommand, sourceRequest } from "../source-viewer/client.ts"
import { SourceFrame } from "../source-viewer/SourceRoutes.tsx"
import type { Publication } from "./client.ts"
import { Generated, PublicationState, RevisionRedirect } from "./client.ts"
import { PublicationHistory } from "./PublicationHistory.tsx"

export function PublicationRoutes(): ReactElement {
  const { t } = useLanguage()
  const [exportUi, setExportUi] = useState<ExportUi>(DEFAULT_EXPORT_UI)
  const study = window.location.pathname.split("/")[2] ?? ""
  const endpoint = `/api/publications/${encodeURIComponent(study)}`
  const [state, setState] = useState<Publication | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const alert = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    sourceRequest(endpoint, PublicationState, controller.signal).then(
      setState,
      (failure: unknown) => {
        if (controller.signal.aborted) return
        if (failure instanceof SourceRequestError) setError(true)
        else throw failure
      },
    )
    return () => controller.abort()
  }, [endpoint])
  useEffect(() => {
    if (error) alert.current?.focus()
  }, [error])
  async function decide(action: "publish" | "revise" | "keep-private"): Promise<void> {
    if (!state?.view) return
    const committed = captureEditSave()
    setBusy(true)
    setError(false)
    try {
      if (action === "revise") {
        const result = await sourceCommand(
          endpoint,
          { expectedId: state.view.draft.id, action },
          RevisionRedirect,
        )
        window.location.assign(result.redirect)
      } else {
        setState(
          await sourceCommand(
            endpoint,
            {
              expectedId: state.view.draft.id,
              action,
              ...(action === "publish" ? { exportUi } : {}),
            },
            PublicationState,
          ),
        )
        if (action === "publish") committed()
      }
    } catch (failure) {
      if (failure instanceof SourceRequestError) {
        setState(await sourceRequest(endpoint, PublicationState, new AbortController().signal))
        setError(true)
      } else throw failure
    } finally {
      setBusy(false)
    }
  }
  async function generate(publicationId: string): Promise<void> {
    setBusy(true)
    setError(false)
    try {
      await sourceCommand(`${endpoint}/outputs/${encodeURIComponent(publicationId)}`, {}, Generated)
      setState(await sourceRequest(endpoint, PublicationState, new AbortController().signal))
    } catch (failure) {
      if (failure instanceof SourceRequestError) setError(true)
      else throw failure
    } finally {
      setBusy(false)
    }
  }
  if (!state)
    return (
      <SourceFrame>
        {error ? (
          <p role="alert">{t("publication.unavailable")}</p>
        ) : (
          <p className="workspace-loading" role="status">
            {t("publication.loading")}
          </p>
        )}
      </SourceFrame>
    )
  const { view, history, entries } = state
  const approved = history.find((item) => item.current)
  const studyId = view?.draft.studyId ?? history[0]?.snapshot.evidence.draft.studyId
  const status = view?.draft.keepPrivate
    ? t("publication.state.private")
    : approved?.outputs.some((output) => output.state === "failed")
      ? t("publication.state.failed")
      : approved?.outputs.every((output) => output.state === "released")
        ? t("publication.state.ready")
        : approved
          ? t("publication.state.pending")
          : view?.ready
            ? t("publication.state.approval")
            : t("publication.state.review")
  return (
    <SourceFrame>
      <section className="setup evidence publication-review">
        <p className="eyebrow">{t("publication.eyebrow")}</p>
        <h1>{t("publication.title")}</h1>
        <p>{t("publication.intro")}</p>
        <p role="status">{status}</p>
        {error && (
          <p ref={alert} role="alert" tabIndex={-1}>
            {t("publication.error")}
          </p>
        )}
        {studyId && (
          <p>
            <a href={`/revisions/${studyId}`}>{t("revision.title")}</a>
          </p>
        )}
        {view && (
          <>
            <nav>
              <a href={`/evidence/${view.draft.studyId}/${view.draft.lessonRevisionId}`}>
                {t("evidence.title")}
              </a>
            </nav>
            <h2>{t("publication.cleaned")}</h2>
            <h3>
              {view.draft.projection.title.en} /{" "}
              <span lang="ja">{view.draft.projection.title.ja}</span>
            </h3>
            {view.draft.projection.sections.map((section) => (
              <section key={section.id}>
                <h3>
                  {section.heading.en} / <span lang="ja">{section.heading.ja}</span>
                </h3>
                <p lang="en">{section.content.en}</p>
                <p lang="ja">{section.content.ja}</p>
              </section>
            ))}
            <details>
              <summary>{t("publication.inspect")}</summary>
              {entries.map((entry) => (
                <div key={entry.path}>
                  <p>
                    <code>{entry.path}</code>
                  </p>
                  <p lang={entry.path.endsWith("/ja") ? "ja" : "en"}>{entry.text}</p>
                </div>
              ))}
            </details>
            <p className="metadata">
              {t("publication.content")} {view.draft.projectionHash}
              <br />
              {t("publication.evidence")} {view.reportHash}
              <br />
              {t("publication.privacy")} {view.privacy.id}
            </p>
            <form onSubmit={(event) => event.preventDefault()}>
              <label htmlFor="export-ui">{t("publication.exportUi")}</label>
              <select
                id="export-ui"
                value={approved?.snapshot.exportUi ?? approved?.outputs[0]?.exportUi ?? exportUi}
                disabled={busy || Boolean(approved)}
                onChange={(event) => setExportUi(ExportUi.parse(event.currentTarget.value))}
              >
                <option value="en">{t("publication.exportUi.en")}</option>
                <option value="ja">{t("publication.exportUi.ja")}</option>
                <option value="en+ja">{t("publication.exportUi.paired")}</option>
              </select>
              <p>{t("publication.exportUi.note")}</p>
              <div className="setup-actions">
                <button
                  type="button"
                  disabled={busy || !view.ready || Boolean(approved)}
                  onClick={() => {
                    void decide("publish")
                  }}
                >
                  {t("publication.publish")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void decide("revise")
                  }}
                >
                  {t("brief.revise")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void decide("keep-private")
                  }}
                >
                  {t("evidence.keepPrivate")}
                </button>
              </div>
            </form>
            <p>{t("publication.note")}</p>
          </>
        )}
        <PublicationHistory
          value={state}
          busy={busy}
          onGenerate={(id) => {
            void generate(id)
          }}
        />
      </section>
    </SourceFrame>
  )
}
