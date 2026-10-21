import type { ReactElement } from "react"
import { useEffect, useRef, useState } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { captureEditSave, requestDeparture } from "../library/useUnsavedEdits.ts"
import { SourceRequestError, sourceCommand, sourceRequest } from "../source-viewer/client.ts"
import { SourceFrame } from "../source-viewer/SourceRoutes.tsx"
import type { Revision } from "./client.ts"
import { ForkedRevision, RevisionState } from "./client.ts"
import { revisionScopeLabel } from "./copy.ts"
import { RevisionForkControls } from "./RevisionControls.tsx"
import { RevisionHistory } from "./RevisionHistory.tsx"

export function RevisionRoutes(): ReactElement {
  const { t } = useLanguage()
  const study = window.location.pathname.split("/")[2] ?? ""
  const endpoint = `/api/revision-page/${encodeURIComponent(study)}`
  const [state, setState] = useState<Revision | null>(null)
  const [provider, setProvider] = useState("0")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const alert = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    sourceRequest(endpoint, RevisionState, controller.signal).then(
      (value) => {
        setState(value)
        setProvider("0")
      },
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
  async function decide(action: "fork" | "provider" | "consent"): Promise<void> {
    const committed = captureEditSave()
    if (!state) return
    const reviewUrl = state.reviewUrl
    if (action === "consent" && reviewUrl) {
      requestDeparture(() => window.location.assign(reviewUrl))
      return
    }
    setBusy(true)
    setError(false)
    const input = {
      action,
      expectedSetupRevisionId: state.view.setup.id,
      ...(action === "provider"
        ? {
            provider: state.choices[Number(provider)]?.provider,
            model: state.choices[Number(provider)]?.model,
          }
        : {}),
    }
    try {
      if (action === "fork") {
        const fork = await sourceCommand(endpoint, input, ForkedRevision)
        requestDeparture(() => window.location.assign(`/revisions/${fork.forkStudyId}`))
      } else {
        const updated = await sourceCommand(endpoint, input, RevisionState)
        setState(updated)
        setProvider("0")
        committed(true)
      }
    } catch (failure) {
      if (failure instanceof SourceRequestError) {
        setState(await sourceRequest(endpoint, RevisionState, new AbortController().signal))
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
          <section className="setup workspace-error">
            <h1>{t("revision.unavailable")}</h1>
            <a href="/interviews">{t("revision.back")}</a>
          </section>
        ) : (
          <p className="workspace-loading" role="status">
            {t("revision.loading")}
          </p>
        )}
      </SourceFrame>
    )
  const { view, available, canEdit, choices } = state
  const { setup, parent, grant, analysis, history } = view
  const approved = grant?.kind === "active"
  return (
    <SourceFrame>
      <section className="setup evidence revision-studio">
        <p className="eyebrow">{t("revision.eyebrow")}</p>
        <h1>{t(parent ? "revision.forkedTitle" : "revision.title")}</h1>
        <p>{t("revision.intro")}</p>
        {error && (
          <p ref={alert} role="alert" tabIndex={-1}>
            {t("revision.error")}
          </p>
        )}
        {parent && (
          <>
            <p>
              <a href={`/revisions/${parent.studyId}`}>{t("revision.original")}</a>
            </p>
            <p className="metadata">
              {t("revision.parent")} <code>{parent.setupRevisionId}</code>
            </p>
          </>
        )}
        <nav className="setup-actions" aria-label={t("revision.workflow")}>
          {canEdit && (
            <>
              <a href={`/interviews/${setup.studyId}`}>{t("revision.editAnswers")}</a>
              <a href={`/briefs/${setup.studyId}?edit=1`}>{t("revision.editGoal")}</a>
            </>
          )}
          <a href={`/publications/${setup.studyId}`}>{t("revision.outputs")}</a>
        </nav>
        <h2>{t("revision.current")}</h2>
        <p>
          {setup.analysis.provider} · {setup.analysis.model}
        </p>
        <p className="metadata">
          {t("jobs.meta.study")} <code>{setup.studyId}</code>
          <br />
          {t("jobs.meta.setup")} <code>{setup.id}</code>
          <br />
          {t("revision.edition")} <code>{setup.editionId}</code>
        </p>
        <p>{analysis ? t("revision.analysis.available") : t("revision.analysis.required")}</p>
        <RevisionForkControls
          busy={busy}
          onFork={() => {
            void decide("fork")
          }}
        />
        <h2>{t("revision.provider.title")}</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void decide("provider")
          }}
        >
          <label htmlFor="revision-provider">{t("revision.provider.label")}</label>
          <select
            id="revision-provider"
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
          >
            {choices.map((choice, index) => (
              <option value={index} key={`${choice.provider}/${choice.model}`}>
                {choice.label}
              </option>
            ))}
          </select>
          <p>{t("revision.provider.note")}</p>
          <button type="submit" disabled={busy}>
            {t("revision.provider.review")}
          </button>
        </form>
        <h2>{t("revision.consent.title")}</h2>
        <p role="status">
          {approved ? t("revision.consent.approved") : t("revision.consent.required")}
        </p>
        <p>
          {t("revision.destination", {
            provider: setup.analysis.provider,
            model: setup.analysis.model,
          })}
        </p>
        <details>
          <summary>{t("revision.scope")}</summary>
          <p>{revisionScopeLabel(setup.analysis.scope.kind, t)}</p>
          <ul>
            {setup.analysis.scope.selected.map((resource) => (
              <li key={resource.resourcePath}>
                {t("revision.blocks", {
                  path: resource.resourcePath,
                  count: resource.blockIds.length,
                })}
              </li>
            ))}
          </ul>
          <p>
            {t("revision.excluded")}{" "}
            {setup.analysis.scope.exclusions.map((resource) => resource.resourcePath).join(", ") ||
              t("brief.none")}
          </p>
        </details>
        <p>{t("revision.charges")}</p>
        {!approved && (
          <div>
            {!available && <p>{t("revision.credentials")}</p>}
            <button
              type="button"
              disabled={busy || !available || grant !== null}
              onClick={() => {
                void decide("consent")
              }}
            >
              {t("revision.approve")}
            </button>
          </div>
        )}
        <RevisionHistory history={history} currentId={setup.id} />
      </section>
    </SourceFrame>
  )
}
