import type { ReactElement } from "react"
import { useEffect, useRef, useState } from "react"
import type { z } from "zod"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { SourceRequestError, sourceCommand, sourceRequest } from "../source-viewer/client.ts"
import { SourceFrame } from "../source-viewer/SourceRoutes.tsx"
import { BriefEditor } from "./BriefEditor.tsx"
import { BriefReview } from "./BriefReview.tsx"
import type { Brief } from "./client.ts"
import { type BriefDecision, type BriefSave, BriefState } from "./client.ts"

const statuses = {
  pending: "brief.status.pending",
  approved: "brief.status.approved",
  revise: "brief.status.revise",
  defer: "brief.status.defer",
  outdated: "brief.status.outdated",
} as const

export function BriefRoutes(): ReactElement {
  const { t } = useLanguage()
  const study = window.location.pathname.split("/")[2] ?? ""
  const endpoint = `/api/briefs/${encodeURIComponent(study)}`
  const [state, setState] = useState<Brief | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(
    new URLSearchParams(window.location.search).get("edit") === "1",
  )
  const alert = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    sourceRequest(endpoint, BriefState, controller.signal).then(setState, (failure: unknown) => {
      if (controller.signal.aborted) return
      if (failure instanceof SourceRequestError) setError(true)
      else throw failure
    })
    return () => controller.abort()
  }, [endpoint])
  useEffect(() => {
    if (error) alert.current?.focus()
  }, [error])
  async function submit(
    value: z.infer<typeof BriefSave> | z.infer<typeof BriefDecision>,
  ): Promise<void> {
    setBusy(true)
    setError(false)
    try {
      setState(await sourceCommand(endpoint, value, BriefState))
      setEditing(false)
    } catch (failure) {
      if (failure instanceof SourceRequestError) {
        setState(await sourceRequest(endpoint, BriefState, new AbortController().signal))
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
            <h1>{t("brief.unavailable.title")}</h1>
            <p>{t("brief.unavailable.body")}</p>
            <a href="/interviews">{t("brief.unavailable.back")}</a>
          </section>
        ) : (
          <p className="workspace-loading" role="status">
            {t("brief.loading")}
          </p>
        )}
      </SourceFrame>
    )
  const { view, setup, descendants } = state
  const scope = view?.draft.scope ?? setup.analysis.scope
  const editor = !view || editing || view.status === "revise" || view.status === "outdated"
  return (
    <SourceFrame>
      <section className="setup brief">
        <p className="eyebrow">{t("brief.eyebrow")}</p>
        <h1>{t("brief.title")}</h1>
        <p>{t("brief.intro")}</p>
        <nav>
          <a href={`/interviews/${study}?step=~review`}>{t("brief.answers")}</a>
        </nav>
        <p>
          <a href={`/revisions/${study}`}>{t("brief.revisions")}</a>
        </p>
        {error && (
          <p ref={alert} role="alert" tabIndex={-1}>
            {t("brief.saveError")}
          </p>
        )}
        {view && (
          <>
            <p role="status">{t(statuses[view.status])}</p>
            <p className="metadata">
              {t("brief.revision")} <code>{view.draft.id}</code>
            </p>
          </>
        )}
        {view?.status === "approved" && (
          <p>
            <a href={`/outlines/${study}`}>{t("brief.outline")}</a>
          </p>
        )}
        <details open>
          <summary>{t("brief.scope")}</summary>
          <p>
            {scope.kind === "partial"
              ? t("brief.scope.partial")
              : scope.kind === "whole-document"
                ? t("brief.scope.whole")
                : t("brief.scope.main")}
          </p>
          <h2>{t("brief.included")}</h2>
          <ul>
            {scope.selected.map((item) => (
              <li key={item.resourcePath}>
                {item.resourcePath}
                <small>{item.blockIds.join(", ")}</small>
              </li>
            ))}
          </ul>
          <h2>{t("brief.excluded")}</h2>
          {scope.exclusions.length ? (
            <ul>
              {scope.exclusions.map((item) => (
                <li key={item.resourcePath}>
                  {item.resourcePath}
                  <small>{item.blockIds.join(", ")}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="workspace-empty">{t("brief.none")}</p>
          )}
          <p>{t("brief.scope.note")}</p>
        </details>
        {editor ? (
          <BriefEditor
            view={view}
            onSave={(value) => {
              void submit(value)
            }}
            busy={busy}
          />
        ) : (
          view && (
            <BriefReview
              view={view}
              onDecision={(action) => {
                void submit({ action, revisionId: view.draft.id })
              }}
              busy={busy}
            />
          )
        )}
        {descendants.length > 0 && (
          <>
            <h2>{t("brief.descendants")}</h2>
            <ul>
              {descendants.map((item) => (
                <li key={item.id}>
                  {item.kind}: {item.id} — {item.status}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </SourceFrame>
  )
}
