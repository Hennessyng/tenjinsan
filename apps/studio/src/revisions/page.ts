import type {
  AnalysisRevision,
  StudySetupRevision,
  TransmissionGrant,
} from "@reading-studio/contracts"
import { html } from "hono/html"
import { sourcePage } from "../source-viewer/page.ts"

type RevisionView = {
  readonly setup: StudySetupRevision
  readonly history: readonly StudySetupRevision[]
  readonly parent: { readonly studyId: string; readonly setupRevisionId: string } | null
  readonly analysis: AnalysisRevision | null
  readonly grant: TransmissionGrant | null
}
type Presentation = {
  readonly available: boolean
  readonly canEdit: boolean
  readonly error: boolean
  readonly choices: readonly { readonly provider: string; readonly label: string }[]
}

export function revisionPage(view: RevisionView, presentation: Presentation) {
  const { setup, parent, grant, analysis, history } = view
  const approved = grant?.kind === "active"
  const old = history.filter((revision) => revision.id !== setup.id)
  return sourcePage(
    "Study revisions / 読書の版",
    html`
    <section class="setup evidence">
    <p class="eyebrow">STUDY / REVISIONS</p>
    <h1>${parent ? "Forked study /" : "Study revisions /"} <span lang="ja">${parent ? "分岐した読書" : "読書の版"}</span></h1>
    <p>Keep one edition, explore another lens. Each study keeps its own answers and reading goal. <span lang="ja">同じ本を別の視点で読み、回答と目的を分けて保存します。</span></p>
    ${presentation.error ? html`<p role="alert" tabindex="-1" autofocus>This decision is stale or unavailable. Review the current setup and try again. <span lang="ja">古い版または利用できない設定です。現在の版を確認してください。</span></p>` : html``}
    ${parent ? html`<p><a href="/revisions/${parent.studyId}">Original study / <span lang="ja">元の読書</span></a></p><p class="metadata">Forked from setup / 分岐元の設定: <code>${parent.setupRevisionId}</code></p>` : html``}
    <nav class="setup-actions" aria-label="Study workflow">
      ${presentation.canEdit ? html`<a href="/interviews/${setup.studyId}">Edit answers / <span lang="ja">回答を編集</span></a><a href="/briefs/${setup.studyId}?edit=1">Edit reading goal / <span lang="ja">読書の目的を編集</span></a>` : html``}
      <a href="/publications/${setup.studyId}">Versioned HTML / PDF</a>
    </nav>
    <h2>Current setup / <span lang="ja">現在の設定</span></h2>
    <p>${setup.analysis.provider} · ${setup.analysis.model}</p>
    <p class="metadata">Study / 読書: <code>${setup.studyId}</code><br>Setup / 設定: <code>${setup.id}</code><br>Edition / 書籍: <code>${setup.editionId}</code></p>
    <p>${analysis ? "Matching lens-neutral analysis available / 視点に依存しない解析を再利用できます" : "New provider analysis required / 現在の設定に合う解析が必要です"}</p>
    <form method="post"><input type="hidden" name="expectedSetupRevisionId" value="${setup.id}">
      <button name="action" value="fork">Fork a second lens / 別の視点に分岐</button>
      <p>Reuse matching analysis, not answers, approvals or transmission consent. The original stays unchanged. <span lang="ja">一致する解析のみ再利用し、回答・承認・送信許可は引き継ぎません。元の読書は保持されます。</span></p>
    </form>
    <h2>Change provider / <span lang="ja">プロバイダーを変更</span></h2>
    <form method="post"><input type="hidden" name="action" value="provider"><input type="hidden" name="expectedSetupRevisionId" value="${setup.id}">
      <label for="provider">Provider and model / プロバイダーとモデル</label>
      <select id="provider" name="provider">${presentation.choices.map((choice) => html`<option value="${choice.provider}" ${choice.provider === setup.analysis.provider ? html`selected` : html``}>${choice.label}</option>`)}</select>
      <p>A new setup invalidates downstream approvals. No other provider's cached map is used. Nothing is sent by this action. <span lang="ja">新しい設定では派生成果の承認が無効になります。他のプロバイダーの解析は混在させず、この操作では送信しません。</span></p>
      <button>Review provider change / 変更を確認</button>
    </form>
    <h2>Fresh provider consent / <span lang="ja">新しい送信許可</span></h2>
    <p role="status">${approved ? "Transmission approved for this setup / この設定の送信を承認済み" : "Fresh consent required / この設定には新しい送信許可が必要です"}</p>
    <p>Destination / 送信先: ${setup.analysis.provider} · ${setup.analysis.model}. Book text only; no reader context or derived study material. <span lang="ja">本のテキストのみ。個人の背景や派生成果は含みません。</span></p>
    <details><summary>Review source scope / 送信範囲を確認</summary>
      <p>${setup.analysis.scope.kind}</p><ul>${setup.analysis.scope.selected.map((resource) => html`<li>${resource.resourcePath} · ${resource.blockIds.length} blocks</li>`)}</ul>
      <p>Excluded / 除外: ${setup.analysis.scope.exclusions.map((resource) => resource.resourcePath).join(", ") || "None / なし"}</p>
    </details>
    <p>Provider API charges may apply. Approval saves permission only; it does not start generation. <span lang="ja">API料金がかかる場合があります。許可の保存のみで、生成は開始しません。</span></p>
    ${
      approved
        ? html``
        : html`<form method="post"><input type="hidden" name="expectedSetupRevisionId" value="${setup.id}">
      ${presentation.available ? html`` : html`<p>API credential missing. Configure this provider on the server first. <span lang="ja">先にサーバーでAPI認証情報を設定してください。</span></p>`}
      <button name="action" value="consent" ${presentation.available && !grant ? html`` : html`disabled`}>Approve transmission / 送信を許可</button>
    </form>`
    }
    <h2>Setup history / <span lang="ja">設定の履歴</span></h2>
    ${old.length ? old.map((revision, index) => html`<section><h3>Old setup version ${old.length - index} / <span lang="ja">旧設定</span></h3><p>${revision.analysis.provider} · ${revision.analysis.model}</p><p class="metadata"><code>${revision.id}</code></p><p>Retained for lineage, not current approval. <span lang="ja">履歴として保持され、現在の承認には使われません。</span></p></section>`) : html`<p>No previous setup versions / <span lang="ja">以前の設定はありません</span></p>`}
    <p>Old successful exports remain versioned after edits. <span lang="ja">変更後も成功済みの出力は旧版として保持されます。</span></p>
    </section>`,
  )
}
