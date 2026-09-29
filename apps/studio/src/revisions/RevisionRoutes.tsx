import type { ReactElement } from "react"
import { useEffect, useRef, useState } from "react"
import { SourceRequestError, sourceCommand, sourceRequest } from "../source-viewer/client.ts"
import { SourceFrame } from "../source-viewer/SourceRoutes.tsx"
import type { Revision } from "./client.ts"
import { ForkedRevision, RevisionState } from "./client.ts"
import { RevisionHistory } from "./RevisionHistory.tsx"

export function RevisionRoutes(): ReactElement {
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
    if (!state) return
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
        window.location.assign(`/revisions/${fork.forkStudyId}`)
      } else {
        const updated = await sourceCommand(endpoint, input, RevisionState)
        setState(updated)
        setProvider("0")
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
          <section className="setup">
            <h1>Study unavailable / 読書が見つかりません</h1>
            <a href="/interviews">Return to interviews / 質問に戻る</a>
          </section>
        ) : (
          <p role="status">Loading revisions</p>
        )}
      </SourceFrame>
    )
  const { view, available, canEdit, choices } = state
  const { setup, parent, grant, analysis, history } = view
  const approved = grant?.kind === "active"
  return (
    <SourceFrame>
      <section className="setup evidence revision-studio">
        <p className="eyebrow">STUDY / REVISIONS</p>
        <h1>
          {parent ? "Forked study /" : "Study revisions /"}{" "}
          <span lang="ja">{parent ? "分岐した読書" : "読書の版"}</span>
        </h1>
        <p>
          Keep one edition, explore another lens. Each study keeps its own answers and reading goal.{" "}
          <span lang="ja">同じ本を別の視点で読み、回答と目的を分けて保存します。</span>
        </p>
        {error && (
          <p ref={alert} role="alert" tabIndex={-1}>
            This decision is stale or unavailable. Review the current setup and try again.{" "}
            <span lang="ja">古い版または利用できない設定です。現在の版を確認してください。</span>
          </p>
        )}
        {parent && (
          <>
            <p>
              <a href={`/revisions/${parent.studyId}`}>
                Original study / <span lang="ja">元の読書</span>
              </a>
            </p>
            <p className="metadata">
              Forked from setup / 分岐元の設定: <code>{parent.setupRevisionId}</code>
            </p>
          </>
        )}
        <nav className="setup-actions" aria-label="Study workflow">
          {canEdit && (
            <>
              <a href={`/interviews/${setup.studyId}`}>
                Edit answers / <span lang="ja">回答を編集</span>
              </a>
              <a href={`/briefs/${setup.studyId}?edit=1`}>
                Edit reading goal / <span lang="ja">読書の目的を編集</span>
              </a>
            </>
          )}
          <a href={`/publications/${setup.studyId}`}>Versioned HTML / PDF</a>
        </nav>
        <h2>
          Current setup / <span lang="ja">現在の設定</span>
        </h2>
        <p>
          {setup.analysis.provider} · {setup.analysis.model}
        </p>
        <p className="metadata">
          Study / 読書: <code>{setup.studyId}</code>
          <br />
          Setup / 設定: <code>{setup.id}</code>
          <br />
          Edition / 書籍: <code>{setup.editionId}</code>
        </p>
        <p>
          {analysis
            ? "Matching lens-neutral analysis available / 視点に依存しない解析を再利用できます"
            : "New provider analysis required / 現在の設定に合う解析が必要です"}
        </p>
        <div>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void decide("fork")
            }}
          >
            Fork a second lens / 別の視点に分岐
          </button>
          <p>
            Reuse matching analysis, not answers, approvals or transmission consent. The original
            stays unchanged.{" "}
            <span lang="ja">
              一致する解析のみ再利用し、回答・承認・送信許可は引き継ぎません。元の読書は保持されます。
            </span>
          </p>
        </div>
        <h2>
          Change provider / <span lang="ja">プロバイダーを変更</span>
        </h2>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void decide("provider")
          }}
        >
          <label htmlFor="revision-provider">Provider and model / プロバイダーとモデル</label>
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
          <p>
            A new setup invalidates downstream approvals. No other provider&apos;s cached map is
            used. Nothing is sent by this action.{" "}
            <span lang="ja">
              新しい設定では派生成果の承認が無効になります。他のプロバイダーの解析は混在させず、この操作では送信しません。
            </span>
          </p>
          <button type="submit" disabled={busy}>
            Review provider change / 変更を確認
          </button>
        </form>
        <h2>
          Fresh provider consent / <span lang="ja">新しい送信許可</span>
        </h2>
        <p role="status">
          {approved
            ? "Transmission approved for this setup / この設定の送信を承認済み"
            : "Fresh consent required / この設定には新しい送信許可が必要です"}
        </p>
        <p>
          Destination / 送信先: {setup.analysis.provider} · {setup.analysis.model}. Book text only;
          no reader context or derived study material.{" "}
          <span lang="ja">本のテキストのみ。個人の背景や派生成果は含みません。</span>
        </p>
        <details>
          <summary>Review source scope / 送信範囲を確認</summary>
          <p>{setup.analysis.scope.kind}</p>
          <ul>
            {setup.analysis.scope.selected.map((resource) => (
              <li key={resource.resourcePath}>
                {resource.resourcePath} · {resource.blockIds.length} blocks
              </li>
            ))}
          </ul>
          <p>
            Excluded / 除外:{" "}
            {setup.analysis.scope.exclusions.map((resource) => resource.resourcePath).join(", ") ||
              "None / なし"}
          </p>
        </details>
        <p>
          Provider API charges may apply. Approval saves permission only; it does not start
          generation.{" "}
          <span lang="ja">
            API料金がかかる場合があります。許可の保存のみで、生成は開始しません。
          </span>
        </p>
        {!approved && (
          <div>
            {!available && (
              <p>
                API credential missing. Configure this provider on the server first.{" "}
                <span lang="ja">先にサーバーでAPI認証情報を設定してください。</span>
              </p>
            )}
            <button
              type="button"
              disabled={busy || !available || grant !== null}
              onClick={() => {
                void decide("consent")
              }}
            >
              Approve transmission / 送信を許可
            </button>
          </div>
        )}
        <RevisionHistory history={history} currentId={setup.id} />
      </section>
    </SourceFrame>
  )
}
