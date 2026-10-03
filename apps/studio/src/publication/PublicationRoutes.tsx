import type { ReactElement } from "react"
import { useEffect, useRef, useState } from "react"
import { SourceRequestError, sourceCommand, sourceRequest } from "../source-viewer/client.ts"
import { SourceFrame } from "../source-viewer/SourceRoutes.tsx"
import type { Publication } from "./client.ts"
import { Generated, PublicationState, RevisionRedirect } from "./client.ts"
import { PublicationHistory } from "./PublicationHistory.tsx"

export function PublicationRoutes(): ReactElement {
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
      } else
        setState(
          await sourceCommand(
            endpoint,
            { expectedId: state.view.draft.id, action },
            PublicationState,
          ),
        )
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
          <p role="alert">Publication unavailable</p>
        ) : (
          <p role="status">Loading publication</p>
        )}
      </SourceFrame>
    )
  const { view, history, entries } = state
  const approved = history.find((item) => item.current)
  const studyId = view?.draft.studyId ?? history[0]?.snapshot.evidence.draft.studyId
  const status = view?.draft.keepPrivate
    ? "Kept private / 非公開"
    : approved?.outputs.some((output) => output.state === "failed")
      ? "Export error — revise and approve again / 出力エラー・修正と再承認が必要です"
      : approved?.outputs.every((output) => output.state === "released")
        ? "Current files ready / 現在のファイルをダウンロードできます"
        : approved
          ? "Approved; files pending / 承認済み・ファイル生成待ち"
          : view?.ready
            ? "Ready for explicit approval / 公開承認を待っています"
            : "Review required or lesson outdated / 再確認が必要です"
  return (
    <SourceFrame>
      <section className="setup evidence publication-review">
        <p className="eyebrow">DISPLAY CASE / APPROVE AND DOWNLOAD</p>
        <h1>
          Publication / <span lang="ja">公開用ファイル</span>
        </h1>
        <p>
          Only the cleaned content below enters these files. Downloads remain owner-only; sharing a
          downloaded copy is your choice. /{" "}
          <span lang="ja">修正済みの内容だけを書き出します。ダウンロードには認証が必要です。</span>
        </p>
        <p role="status">{status}</p>
        {error && (
          <p ref={alert} role="alert" tabIndex={-1}>
            Stale review or output error. Reload and review the current version before deciding.
          </p>
        )}
        {studyId && (
          <p>
            <a href={`/revisions/${studyId}`}>
              Study revisions / <span lang="ja">読書の版</span>
            </a>
          </p>
        )}
        {view && (
          <>
            <nav>
              <a href={`/evidence/${view.draft.studyId}/${view.draft.lessonRevisionId}`}>
                Evidence and privacy review / 根拠とプライバシー
              </a>
            </nav>
            <h2>
              Cleaned publication / <span lang="ja">修正済みの公開内容</span>
            </h2>
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
              <summary>Inspect all publication values / すべての公開値を確認</summary>
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
              Content: {view.draft.projectionHash}
              <br />
              Evidence: {view.reportHash}
              <br />
              Privacy: {view.privacy.id}
            </p>
            <div className="setup-actions">
              <button
                type="button"
                disabled={busy || !view.ready || Boolean(approved)}
                onClick={() => {
                  void decide("publish")
                }}
              >
                Publish / 公開用に承認
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void decide("revise")
                }}
              >
                Revise / 修正する
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void decide("keep-private")
                }}
              >
                Keep private / 非公開のまま
              </button>
            </div>
            <p>
              Every edit invalidates approval. Publish pins this review and renderer; it does not
              make a public URL. /{" "}
              <span lang="ja">変更すると承認は無効になります。公開URLは作成されません。</span>
            </p>
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
