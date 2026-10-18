import type { SourcePreparationFailure } from "@reading-studio/contracts/source"
import type { ReactElement } from "react"
import { useEffect, useRef, useState } from "react"
import type { z } from "zod"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { captureEditSave, requestDeparture } from "../library/useUnsavedEdits.ts"
import {
  SourcePreparationError,
  SourceRequestError,
  sourceCommand,
  sourceRequest,
} from "../source-viewer/client.ts"
import { SourceFrame } from "../source-viewer/SourceRoutes.tsx"
import type { SetupSelection } from "./client.ts"
import { SetupChoices, SetupCreated, SetupDecision, SetupReview } from "./client.ts"
import { PreparationRefusal } from "./PreparationRefusal.tsx"
import { SetupChoices as ChoicesView } from "./SetupChoices.tsx"
import { SetupReview as ReviewView } from "./SetupReview.tsx"

type Page =
  | { readonly kind: "loading" }
  | { readonly kind: "choices"; readonly value: z.infer<typeof SetupChoices> }
  | { readonly kind: "review"; readonly value: z.infer<typeof SetupReview> }
  | { readonly kind: "result"; readonly decision: "cancel" | "send"; readonly grantId?: string }
  | { readonly kind: "error"; readonly status: number }

export function SetupRoutes(): ReactElement {
  const { t } = useLanguage()
  const [, , revision, , setupId] = window.location.pathname.split("/")
  const base = `/api/study-setup/${encodeURIComponent(revision ?? "")}`
  const [page, setPage] = useState<Page>({ kind: "loading" })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [refusal, setRefusal] = useState<SourcePreparationFailure | null>(null)
  const alert = useRef<HTMLParagraphElement>(null)
  const result = useRef<HTMLHeadingElement>(null)
  const resultReady = page.kind === "result"
  useEffect(() => {
    if (message) alert.current?.focus()
  }, [message])
  useEffect(() => {
    if (resultReady) result.current?.focus()
  }, [resultReady])
  useEffect(() => {
    const controller = new AbortController()
    const endpoint = setupId ? `${base}/${encodeURIComponent(setupId)}` : base
    const load = setupId
      ? sourceRequest(endpoint, SetupReview, controller.signal).then(
          (value) => ({ kind: "review", value }) as const,
        )
      : sourceRequest(endpoint, SetupChoices, controller.signal).then(
          (value) => ({ kind: "choices", value }) as const,
        )
    load.then(setPage, (error: unknown) => {
      if (controller.signal.aborted) return
      setPage({ kind: "error", status: error instanceof SourceRequestError ? error.status : 500 })
    })
    return () => controller.abort()
  }, [base, setupId])
  async function create(selection: SetupSelection): Promise<void> {
    const committed = captureEditSave()
    setBusy(true)
    setMessage("")
    try {
      const created = await sourceCommand(base, selection, SetupCreated)
      committed()
      requestDeparture(() =>
        window.location.assign(`/sources/${revision}/setup/${created.setupId}`),
      )
    } catch (error) {
      setMessage(
        error instanceof SourceRequestError && error.status === 400
          ? t("setup.selectChapters")
          : t("setup.saveError"),
      )
      setBusy(false)
    }
  }
  async function decide(decision: "send" | "revise" | "cancel"): Promise<void> {
    setBusy(true)
    setMessage("")
    setRefusal(null)
    try {
      const result = await sourceCommand(
        `${base}/${encodeURIComponent(setupId ?? "")}`,
        { decision },
        SetupDecision,
      )
      if (result.decision === "revise") window.location.assign(`/sources/${revision}/setup`)
      else
        setPage({
          kind: "result",
          decision: result.decision,
          ...(result.decision === "send" ? { grantId: result.grantId } : {}),
        })
    } catch (error) {
      if (error instanceof SourcePreparationError) {
        setRefusal(error.failure)
        return
      }
      setMessage(
        error instanceof SourceRequestError && error.status === 409
          ? t("setup.stale")
          : t("setup.decisionError"),
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <SourceFrame>
      <div>
        {refusal && <PreparationRefusal failure={refusal} />}
        {message && (
          <p role="alert" ref={alert} tabIndex={-1}>
            {message}
          </p>
        )}
        {page.kind === "loading" && (
          <p className="workspace-loading" role="status">
            {t("setup.loading")}
          </p>
        )}
        {page.kind === "error" && (
          <section className="setup workspace-error">
            <h1>{t("setup.unavailable")}</h1>
            <p>{t("setup.stale")}</p>
            <a href={`/sources/${revision}/setup`}>{t("setup.back")}</a>
          </section>
        )}
        {page.kind === "choices" && (
          <ChoicesView value={page.value} onSubmit={create} busy={busy} />
        )}
        {page.kind === "review" && (
          <ReviewView value={page.value} onDecision={decide} busy={busy} />
        )}
        {page.kind === "result" && (
          <section className="setup">
            <h1 ref={result} tabIndex={-1}>
              {page.decision === "send" ? t("setup.approved") : t("setup.cancelled")}
            </h1>
            <p>{page.decision === "send" ? t("setup.approvedNote") : t("setup.cancelledNote")}</p>
            {page.grantId && <p data-grant={page.grantId}>{t("setup.consentSaved")}</p>}
            <p>
              <a href={`/sources/${revision}/setup`}>{t("setup.back")}</a>
            </p>
          </section>
        )}
      </div>
    </SourceFrame>
  )
}
