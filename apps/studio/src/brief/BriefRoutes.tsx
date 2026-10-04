import type { ReactElement } from "react"
import { useEffect, useRef, useState } from "react"
import type { z } from "zod"
import { SourceRequestError, sourceCommand, sourceRequest } from "../source-viewer/client.ts"
import { SourceFrame } from "../source-viewer/SourceRoutes.tsx"
import { BriefEditor } from "./BriefEditor.tsx"
import { BriefReview } from "./BriefReview.tsx"
import type { Brief } from "./client.ts"
import { type BriefDecision, type BriefSave, BriefState } from "./client.ts"

const statuses = {
  pending: "Awaiting approval / 承認待ち",
  approved: "Brief approved / 読書方針を承認しました",
  revise: "Revision requested / 修正待ち",
  defer: "Decision deferred / 判断を保留しました",
  outdated:
    "Outdated: setup or answers changed. Save a new revision. / 設定または回答が変更されました。新しい版を保存してください。",
} as const

export function BriefRoutes(): ReactElement {
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
            <h1>Brief unavailable / 読書方針は未準備です</h1>
            <p>A current setup and saved interview are required.</p>
            <a href="/interviews">Return to interviews</a>
          </section>
        ) : (
          <p className="workspace-loading" role="status">
            Loading brief
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
        <p className="eyebrow">READING / YOUR DIRECTION</p>
        <h1>
          Reading brief / <span lang="ja">読書方針</span>
        </h1>
        <p>
          Review the direction before approving. No outline is generated here. /{" "}
          <span lang="ja">
            方向性を確認してから承認してください。ここでは構成案は生成されません。
          </span>
        </p>
        <nav>
          <a href={`/interviews/${study}?step=~review`}>
            Review saved answers / <span lang="ja">保存した回答を確認</span>
          </a>
        </nav>
        <p>
          <a href={`/revisions/${study}`}>
            Study revisions / <span lang="ja">読書の版</span>
          </a>
        </p>
        {error && (
          <p ref={alert} role="alert" tabIndex={-1}>
            Unable to save this decision. It may be stale or incomplete. Review the current brief
            and try again. / 入力不足または古い版です。現在の内容を確認してください。
          </p>
        )}
        {view && (
          <>
            <p role="status">{statuses[view.status]}</p>
            <p className="metadata">
              Revision / 版: <code>{view.draft.id}</code>
            </p>
          </>
        )}
        {view?.status === "approved" && (
          <p>
            <a href={`/outlines/${study}`}>
              Study outline / <span lang="ja">学習の構成</span>
            </a>
          </p>
        )}
        <details open>
          <summary>Source scope and exclusions / 対象と除外</summary>
          <p>
            {scope.kind === "partial"
              ? "Partial coverage / 一部のみ"
              : "All main chapters / 本文全章"}
          </p>
          <h2>Included / 対象</h2>
          <ul>
            {scope.selected.map((item) => (
              <li key={item.resourcePath}>
                {item.resourcePath}
                <small>{item.blockIds.join(", ")}</small>
              </li>
            ))}
          </ul>
          <h2>Excluded sources / 除外資料</h2>
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
            <p className="workspace-empty">None / なし</p>
          )}
          <p>
            Source scope comes from study setup. Changing it requires reviewing a new brief. /
            対象範囲は読書設定に従います。変更後は再確認が必要です。
          </p>
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
            <h2>Descendants / 派生成果</h2>
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
