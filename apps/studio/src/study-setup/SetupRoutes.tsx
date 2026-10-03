import type { ReactElement } from "react"
import { useEffect, useState } from "react"
import type { z } from "zod"
import { SourceRequestError, sourceCommand, sourceRequest } from "../source-viewer/client.ts"
import { SourceFrame } from "../source-viewer/SourceRoutes.tsx"
import type { SetupSelection } from "./client.ts"
import { SetupChoices, SetupCreated, SetupDecision, SetupReview } from "./client.ts"
import { SetupChoices as ChoicesView } from "./SetupChoices.tsx"
import { SetupReview as ReviewView } from "./SetupReview.tsx"

type Page =
  | { readonly kind: "loading" }
  | { readonly kind: "choices"; readonly value: z.infer<typeof SetupChoices> }
  | { readonly kind: "review"; readonly value: z.infer<typeof SetupReview> }
  | { readonly kind: "result"; readonly decision: "cancel" | "send"; readonly grantId?: string }
  | { readonly kind: "error"; readonly status: number }

export function SetupRoutes(): ReactElement {
  const [, , revision, , setupId] = window.location.pathname.split("/")
  const base = `/api/study-setup/${encodeURIComponent(revision ?? "")}`
  const [page, setPage] = useState<Page>({ kind: "loading" })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
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
    setBusy(true)
    setMessage("")
    try {
      const created = await sourceCommand(base, selection, SetupCreated)
      window.location.assign(`/sources/${revision}/setup/${created.setupId}`)
    } catch (error) {
      setMessage(
        error instanceof SourceRequestError && error.status === 400
          ? "Select available chapters explicitly."
          : "Setup could not be saved. Please try again.",
      )
      setBusy(false)
    }
  }
  async function decide(decision: "send" | "revise" | "cancel"): Promise<void> {
    setBusy(true)
    setMessage("")
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
      setMessage(
        error instanceof SourceRequestError && error.status === 409
          ? "This draft is missing, cancelled, or superseded. Review a fresh setup before sending."
          : "Decision could not be saved. Please try again.",
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <SourceFrame>
      <div>
        {message && (
          <p role="alert" tabIndex={-1}>
            {message}
          </p>
        )}
        {page.kind === "loading" && <p className="workspace-loading" role="status">Loading study setup</p>}
        {page.kind === "error" && (
          <section className="setup">
            <h1>Setup unavailable</h1>
            <p>
              This draft is missing, cancelled, or superseded. Review a fresh setup before sending.
            </p>
            <a href={`/sources/${revision}/setup`}>Return to setup</a>
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
            <h1>{page.decision === "send" ? "Transmission approved" : "Transmission cancelled"}</h1>
            <p>
              {page.decision === "send"
                ? "Your provider and source scope are saved. Analysis is not queued until its stage is available."
                : "No cloud work was queued. This draft cannot authorize transmission."}
            </p>
            {page.grantId && <p data-grant={page.grantId}>Consent saved for this exact setup.</p>}
            <p>
              <a href={`/sources/${revision}/setup`}>Return to setup</a>
            </p>
          </section>
        )}
      </div>
    </SourceFrame>
  )
}
