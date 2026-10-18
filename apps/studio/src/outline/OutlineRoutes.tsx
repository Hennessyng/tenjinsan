import type { ReactElement } from "react"
import { useEffect, useRef, useState } from "react"
import type { z } from "zod"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { captureEditSave } from "../library/useUnsavedEdits.ts"
import { SourceRequestError, sourceCommand, sourceRequest } from "../source-viewer/client.ts"
import { SourceFrame } from "../source-viewer/SourceRoutes.tsx"
import type { Outline } from "./client.ts"
import { type OutlineAction, OutlineState } from "./client.ts"
import { OutlineContent } from "./OutlineContent.tsx"

const statuses = {
  pending: "outline.status.pending",
  approved: "outline.status.approved",
  revise: "brief.status.revise",
  defer: "brief.status.defer",
  outdated: "outline.status.outdated",
} as const

export function OutlineRoutes(): ReactElement {
  const { t } = useLanguage()
  const study = window.location.pathname.split("/")[2] ?? ""
  const endpoint = `/api/outlines/${encodeURIComponent(study)}`
  const [state, setState] = useState<Outline | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [choice, setChoice] = useState<"reverse-order" | "simplify-visuals">("reverse-order")
  const [custom, setCustom] = useState("")
  const alert = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    sourceRequest(endpoint, OutlineState, controller.signal).then(setState, (failure: unknown) => {
      if (controller.signal.aborted) return
      if (failure instanceof SourceRequestError) setError(true)
      else throw failure
    })
    return () => controller.abort()
  }, [endpoint])
  useEffect(() => {
    if (error) alert.current?.focus()
  }, [error])
  async function submit(action: z.infer<typeof OutlineAction>): Promise<void> {
    const committed = captureEditSave()
    setBusy(true)
    setError(false)
    try {
      setState(await sourceCommand(endpoint, action, OutlineState))
      committed()
    } catch (failure) {
      if (failure instanceof SourceRequestError) {
        setState(await sourceRequest(endpoint, OutlineState, new AbortController().signal))
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
          <p role="alert">{t("revision.unavailable")}</p>
        ) : (
          <p className="workspace-loading" role="status">
            {t("outline.loading")}
          </p>
        )}
      </SourceFrame>
    )
  const { view, brief, fixture, providerReady } = state
  const current = view && view.status !== "outdated"
  return (
    <SourceFrame>
      <section className="setup outline">
        <p className="eyebrow">{t("outline.eyebrow")}</p>
        <h1>{t("outline.title")}</h1>
        <nav>
          <a href={`/briefs/${study}`}>{t("brief.title")}</a>
        </nav>
        <p>
          {fixture
            ? t("outline.fixture")
            : providerReady
              ? t("outline.provider")
              : t("outline.blocked")}
        </p>
        {error && (
          <p ref={alert} role="alert" tabIndex={-1}>
            {t("outline.error")}
          </p>
        )}
        {!brief && <p className="workspace-empty">{t("outline.briefRequired")}</p>}
        {view && (
          <>
            <p role="status">{t(statuses[view.status])}</p>
            <p className="metadata" data-outline-revision={view.draft.id}>
              {t("brief.revision")} {view.draft.id}
            </p>
          </>
        )}
        <OutlineContent value={state} />
        {brief && (fixture || providerReady) && (!view || view.status === "outdated") && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void submit({
                action: "generate",
                briefRevisionId: brief.id,
                expectedRevisionId: view?.draft.id ?? "",
              })
            }}
          >
            {fixture ? t("outline.generateFixture") : t("outline.generate")}
          </button>
        )}
        {current && (
          <>
            <div className="setup-actions">
              <button
                type="button"
                disabled={
                  busy ||
                  view.status === "revise" ||
                  view.draft.content.sections.some((section) => section.flags.length > 0)
                }
                onClick={() => {
                  void submit({ action: "approve", revisionId: view.draft.id })
                }}
              >
                {t("outline.approve")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void submit({ action: "defer", revisionId: view.draft.id })
                }}
              >
                {t("brief.defer")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void submit({ action: "revise", revisionId: view.draft.id })
                }}
              >
                {t("outline.revise")}
              </button>
            </div>
            {(fixture || providerReady) && (
              <>
                <h2>{t("outline.change")}</h2>
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void submit({ action: "choice", revisionId: view.draft.id, value: choice })
                  }}
                >
                  <label htmlFor="revision-choice">{t("outline.choice")}</label>
                  <select
                    id="revision-choice"
                    value={choice}
                    onChange={(event) =>
                      setChoice(
                        event.target.value === "reverse-order"
                          ? "reverse-order"
                          : "simplify-visuals",
                      )
                    }
                  >
                    <option value="reverse-order">{t("outline.reverse")}</option>
                    <option value="simplify-visuals">{t("outline.simplify")}</option>
                  </select>
                  <button type="submit" disabled={busy}>
                    {t("outline.apply")}
                  </button>
                </form>
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void submit({ action: "custom", revisionId: view.draft.id, text: custom })
                  }}
                >
                  <label htmlFor="custom">{t("outline.custom")}</label>
                  <input
                    id="custom"
                    required
                    maxLength={2000}
                    value={custom}
                    onChange={(event) => setCustom(event.target.value)}
                  />
                  <button type="submit" disabled={busy}>
                    {t("outline.applyCustom")}
                  </button>
                </form>
              </>
            )}
          </>
        )}
        <p>
          {view?.status === "approved" && providerReady
            ? t("outline.lessonQueued")
            : view?.status === "approved"
              ? t("outline.fixtureApproved")
              : t("outline.sectionsBlocked")}
        </p>
        {!providerReady && (
          <button disabled type="button">
            {t("outline.sections")}
          </button>
        )}
        <p>
          <a href={`/evidence/${study}`}>{t("outline.evidenceLink")}</a>
        </p>
      </section>
    </SourceFrame>
  )
}
