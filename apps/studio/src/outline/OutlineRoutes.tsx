import type { ReactElement } from "react"
import { useEffect, useRef, useState } from "react"
import type { z } from "zod"
import { SourceRequestError, sourceCommand, sourceRequest } from "../source-viewer/client.ts"
import { SourceFrame } from "../source-viewer/SourceRoutes.tsx"
import type { Outline } from "./client.ts"
import { type OutlineAction, OutlineState } from "./client.ts"
import { OutlineContent } from "./OutlineContent.tsx"

const statuses = {
  pending: "Awaiting outline approval",
  approved: "Outline approved",
  revise: "Revision requested",
  defer: "Decision deferred",
  outdated: "Outdated: review the current brief",
} as const

export function OutlineRoutes(): ReactElement {
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
    setBusy(true)
    setError(false)
    try {
      setState(await sourceCommand(endpoint, action, OutlineState))
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
        {error ? <p role="alert">Study not found</p> : <p className="workspace-loading" role="status">Loading outline</p>}
      </SourceFrame>
    )
  const { view, brief, fixture, providerReady } = state
  const current = view && view.status !== "outdated"
  return (
    <SourceFrame>
      <section className="setup outline">
        <p className="eyebrow">READING / TEACHING SEQUENCE</p>
        <h1>
          Study outline / <span lang="ja">学習の構成</span>
        </h1>
        <nav>
          <a href={`/briefs/${study}`}>
            Reading brief / <span lang="ja">読書方針</span>
          </a>
        </nav>
        <p>
          {fixture
            ? "Fixture provider only; no live generation or cloud transmission."
            : providerReady
              ? "Provider-backed outline requests are queued under the approved transmission grant; refresh to review the result."
              : "Live generation blocked: no live outline provider is configured. Fixture verification is separate."}
        </p>
        {error && (
          <p ref={alert} role="alert" tabIndex={-1}>
            Unable to proceed: stale revision, missing approval or unresolved flags. Review the
            current outline.
          </p>
        )}
        {!brief && (
          <p>
            Approve the current reading brief before generating an outline. /{" "}
            <span lang="ja">先に読書方針を承認してください。</span>
          </p>
        )}
        {view && (
          <>
            <p role="status">{statuses[view.status]}</p>
            <p className="metadata" data-outline-revision={view.draft.id}>
              Revision: {view.draft.id}
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
            {fixture ? "Generate fixture outline" : "Queue outline generation"}
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
                Approve outline / 承認する
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void submit({ action: "defer", revisionId: view.draft.id })
                }}
              >
                Defer / 保留する
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void submit({ action: "revise", revisionId: view.draft.id })
                }}
              >
                Request revision / 修正する
              </button>
            </div>
            {(fixture || providerReady) && (
              <>
                <h2>
                  How should the sequence change? / <span lang="ja">構成をどう変えますか？</span>
                </h2>
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void submit({ action: "choice", revisionId: view.draft.id, value: choice })
                  }}
                >
                  <label htmlFor="revision-choice">Revision choice / 修正案</label>
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
                    <option value="reverse-order">Reverse section order / 順序を逆にする</option>
                    <option value="simplify-visuals">Simplify visuals / 図解を簡潔にする</option>
                  </select>
                  <button type="submit" disabled={busy}>
                    Apply selected revision
                  </button>
                </form>
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void submit({ action: "custom", revisionId: view.draft.id, text: custom })
                  }}
                >
                  <label htmlFor="custom">Your own visual intention / 独自の図解案</label>
                  <input
                    id="custom"
                    required
                    maxLength={2000}
                    value={custom}
                    onChange={(event) => setCustom(event.target.value)}
                  />
                  <button type="submit" disabled={busy}>
                    Apply custom revision
                  </button>
                </form>
              </>
            )}
          </>
        )}
        <p>
          {view?.status === "approved" && providerReady
            ? "Approved. Bilingual lesson generation is queued; refresh the evidence page to review the result."
            : view?.status === "approved"
              ? "Approval recorded. Section generation is not implemented in Task18."
              : "Section generation blocked until this exact outline is approved."}
        </p>
        {!providerReady && (
          <button disabled type="button">
            Generate sections / 本文を生成
          </button>
        )}
        <p>
          <a href={`/evidence/${study}`}>
            Review generated lesson evidence / <span lang="ja">生成済み本文の根拠を確認</span>
          </a>
        </p>
      </section>
    </SourceFrame>
  )
}
