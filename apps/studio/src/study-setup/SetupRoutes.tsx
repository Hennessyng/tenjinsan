import { setupDecisionHeading, setupProgressUrl } from "@reading-studio/contracts/setup-progress"
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
import type { SavedSetupDecision, SetupSelection } from "./client.ts"
import {
  SetupChoices,
  SetupCreated,
  SetupDecision,
  type SetupReview,
  SetupReviewResponse,
} from "./client.ts"
import { PreparationRefusal } from "./PreparationRefusal.tsx"
import { SetupChoices as ChoicesView } from "./SetupChoices.tsx"
import { SetupReview as ReviewView } from "./SetupReview.tsx"
import { SetupSavedStatus } from "./SetupSavedStatus.tsx"

type Page =
  | { readonly kind: "loading" }
  | { readonly kind: "choices"; readonly value: z.infer<typeof SetupChoices> }
  | { readonly kind: "review"; readonly value: z.infer<typeof SetupReview> }
  | { readonly kind: "result"; readonly decision: "cancel" }
  | (SavedSetupDecision & { readonly kind: "result"; readonly progressUrl: string })
  | { readonly kind: "error"; readonly status: number }

function reviewedPage(value: z.infer<typeof SetupReviewResponse>, setupId: string): Page {
  if (!("decision" in value)) return { kind: "review", value }
  switch (value.decision) {
    case "send":
      return {
        kind: "result",
        ...value,
        progressUrl: value.progressUrl ?? setupProgressUrl(setupId),
      }
    case "cancel":
      return { kind: "result", decision: "cancel" }
    case "revise":
      return { kind: "error", status: 409 }
    default:
      return assertNever(value)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unknown setup decision: ${value}`)
}

export function SetupRoutes(): ReactElement {
  const { t, locale } = useLanguage()
  const [, , revision, , setupId] = window.location.pathname.split("/")
  const base = `/api/study-setup/${encodeURIComponent(revision ?? "")}`
  const [page, setPage] = useState<Page>({ kind: "loading" })
  const [busy, setBusy] = useState(false)
  const deciding = useRef(false)
  const [message, setMessage] = useState("")
  const [connectionRecovery, setConnectionRecovery] = useState(false)
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
      ? sourceRequest(endpoint, SetupReviewResponse, controller.signal).then((value) =>
          reviewedPage(value, setupId ?? ""),
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
        error instanceof SourceRequestError && error.status === 422
          ? t("setup.coverage.empty")
          : t("setup.saveError"),
      )
      setBusy(false)
    }
  }
  async function decide(decision: "send" | "resume" | "revise" | "cancel"): Promise<void> {
    if (deciding.current) return
    deciding.current = true
    setBusy(true)
    setMessage("")
    setConnectionRecovery(false)
    setRefusal(null)
    try {
      const result = await sourceCommand(
        `${base}/${encodeURIComponent(setupId ?? "")}`,
        { decision },
        SetupDecision,
      )
      if (result.decision === "revise") window.location.assign(`/sources/${revision}/setup`)
      else if (result.decision === "send") setPage(reviewedPage(result, setupId ?? ""))
      else setPage({ kind: "result", decision: "cancel" })
    } catch (error) {
      if (error instanceof SourcePreparationError) {
        setRefusal(error.failure)
        return
      }
      if (decision === "send" || decision === "resume") {
        try {
          const persisted = await sourceRequest(
            `${base}/${encodeURIComponent(setupId ?? "")}`,
            SetupReviewResponse,
            AbortSignal.timeout(15000),
          )
          if ("decision" in persisted) {
            setPage(reviewedPage(persisted, setupId ?? ""))
            return
          }
        } catch (readError) {
          if (!(readError instanceof Error)) throw readError
        }
      }
      if (error instanceof SourceRequestError && error.refusal) {
        setConnectionRecovery(true)
        setMessage(t(`setup.refusal.${error.refusal}`))
        return
      }
      setMessage(
        error instanceof SourceRequestError && error.status === 409
          ? t("setup.stale")
          : t("setup.decisionError"),
      )
    } finally {
      deciding.current = false
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
        {connectionRecovery && (
          <p>
            <a href={`/sources/${revision}/setup?lang=${locale}`}>
              {t("setup.refusal.connections")}
            </a>
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
              {page.decision === "send"
                ? t(setupDecisionHeading(page.analysisProgress, page.schedulingFailure))
                : t("setup.cancelled")}
            </h1>
            {page.decision === "send" ? (
              <SetupSavedStatus value={page} onResume={() => decide("resume")} busy={busy} />
            ) : (
              <p>{t("setup.cancelledNote")}</p>
            )}
            <p>
              <a href={`/sources/${revision}/setup`}>{t("setup.back")}</a>
            </p>
          </section>
        )}
      </div>
    </SourceFrame>
  )
}
