import {
  type EvidenceView,
  type PublicationOutput,
  type PublicationSnapshot,
  projectedStrings,
} from "@reading-studio/contracts"
import { html } from "hono/html"
import { sourcePage } from "../source-viewer/page.ts"

export type PublicationHistory = {
  readonly snapshot: PublicationSnapshot
  readonly current: boolean
  readonly outputs: readonly PublicationOutput[]
}

export function publicationPage(view: EvidenceView | null, history: readonly PublicationHistory[]) {
  const approved = history.find((entry) => entry.current)
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
  return sourcePage(
    "Publication / 公開用ファイル",
    html`
    <section class="setup evidence"><p class="eyebrow">REVIEW / RELEASE</p>
    <h1>Publication / <span lang="ja">公開用ファイル</span></h1>
    <p>Only the cleaned content below enters these files. Downloads remain owner-only; sharing a downloaded copy is your choice. / <span lang="ja">修正済みの内容だけを書き出します。ダウンロードには認証が必要です。</span></p>
    <p role="status">${status}</p>
    ${studyId ? html`<p><a href="/revisions/${studyId}">Study revisions / <span lang="ja">読書の版</span></a></p>` : html``}
    ${
      view
        ? html`
      <nav><a href="/evidence/${view.draft.studyId}/${view.draft.lessonRevisionId}">Evidence and privacy review / 根拠とプライバシー</a></nav>
      <h2>Cleaned publication / <span lang="ja">修正済みの公開内容</span></h2>
      <h3>${view.draft.projection.title.en} / <span lang="ja">${view.draft.projection.title.ja}</span></h3>
      ${view.draft.projection.sections.map((section) => html`<section><h3>${section.heading.en} / <span lang="ja">${section.heading.ja}</span></h3><p lang="en">${section.content.en}</p><p lang="ja">${section.content.ja}</p></section>`)}
      <details><summary>Inspect all publication values / すべての公開値を確認</summary>
      ${projectedStrings(view.draft.projection).map((entry) => html`<p><code>${entry.path}</code></p><p lang="${entry.path.endsWith("/ja") ? "ja" : "en"}">${entry.text}</p>`)}</details>
      <p class="metadata">Content: ${view.draft.projectionHash}<br>Evidence: ${view.reportHash}<br>Privacy: ${view.privacy.id}</p>
      <form method="post"><input type="hidden" name="expectedId" value="${view.draft.id}">
      <div class="setup-actions"><button name="action" value="publish" ${view.ready && !approved ? html`` : html`disabled`}>Publish / 公開用に承認</button>
      <button name="action" value="revise">Revise / 修正する</button>
      <button name="action" value="keep-private">Keep private / 非公開のまま</button></div></form>
      <p>Every edit invalidates approval. Publish pins this review and renderer; it does not make a public URL. / <span lang="ja">変更すると承認は無効になります。公開URLは作成されません。</span></p>`
        : html``
    }
    <h2>Versioned files / <span lang="ja">ファイルの履歴</span></h2>
    <p>If generation fails or is interrupted, choose Revise, review again, then Publish a new version. Existing successful files are retained. / <span lang="ja">生成に失敗した場合は修正と再確認の後、新しい版を承認してください。成功済みのファイルは保持されます。</span></p>
    ${
      history.length
        ? history.map(
            ({ snapshot, current, outputs }, index) => html`
      <section><h3>Version ${history.length - index} · ${current ? "Current approval / 現在の承認" : "Old version — stale / 旧版"}</h3>
      <p class="metadata">${snapshot.publication.id}<br>${snapshot.publication.approval.rendererVersion}<br>${snapshot.publication.approval.approvedAt}</p>
      <ul>${outputs.map(
        (
          output,
        ) => html`<li>${output.format.toUpperCase()} — ${output.state === "released" ? (current ? "Current / 現在" : "Old version / 旧版") : output.state === "failed" ? `Error / エラー: ${output.error}` : `${output.state} — not available / 未完成`}
      ${output.state === "released" ? html`<a href="/publication-artifacts/${output.id}">Download ${output.format.toUpperCase()} · version ${history.length - index}</a>` : html``}</li>`,
      )}</ul>
      ${current && outputs.some((output) => output.state === "queued") ? html`<form method="post" action="/publications/${snapshot.evidence.draft.studyId}/outputs/${snapshot.publication.id}"><button>Generate approved files / 承認済みファイルを生成</button></form>` : html``}
      </section>`,
          )
        : html`<p>No approved files yet / 承認済みファイルはまだありません</p>`
    }
    </section>`,
  )
}
