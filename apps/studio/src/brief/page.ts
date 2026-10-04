import { type BriefView, guidingQuestion, type StudySetupRevision } from "@reading-studio/contracts"
import { html, raw } from "hono/html"
import { sourcePage } from "../source-viewer/page.ts"
import { briefDecisions, briefEditor } from "./forms.ts"

const styles = `
.brief textarea { display: block; width: 100%; padding: var(--space-3); font: inherit; color: var(--color-ink); background: var(--color-paper-raised); border: var(--rule) solid var(--color-green); }
.brief article { margin-block: var(--space-6); }
.brief [role="alert"] { border-left: var(--space-1) solid var(--color-focus); padding: var(--space-4); }
.brief dd { margin-inline-start: 0; white-space: pre-wrap; margin-bottom: var(--space-4); }
.brief dt { font-weight: 700; }
.brief h1 span { display: inline-block; }
.brief h2 { text-wrap: balance; }
`
const statuses = {
  pending: "Awaiting approval / 承認待ち",
  approved: "Brief approved / 読書方針を承認しました",
  revise: "Revision requested / 修正待ち",
  defer: "Decision deferred / 判断を保留しました",
  outdated:
    "Outdated: setup or answers changed. Save a new revision. / 設定または回答が変更されました。新しい版を保存してください。",
}

export function briefPage(input: {
  readonly view: BriefView | null
  readonly setup: StudySetupRevision
  readonly edit: boolean
  readonly error: boolean
  readonly descendants: readonly {
    readonly id: string
    readonly kind: string
    readonly status: string
  }[]
}) {
  const { view, setup } = input
  const scope = view?.draft.scope ?? setup.analysis.scope
  const content = view?.draft.content
  const guiding = content ? guidingQuestion(content) : null
  return sourcePage(
    "Reading brief / 読書方針",
    html`<style>${raw(styles)}</style><section class="setup brief">
    <p class="eyebrow">READING / YOUR DIRECTION</p><h1>Reading brief / <span lang="ja">読書方針</span></h1>
    <p>Review the direction before approving. No outline is generated here. / <span lang="ja">方向性を確認してから承認してください。ここでは構成案は生成されません。</span></p>
    <nav><a href="/interviews/${setup.studyId}?step=~review">Review saved answers / <span lang="ja">保存した回答を確認</span></a></nav>
    <p><a href="/revisions/${setup.studyId}">Study revisions / <span lang="ja">読書の版</span></a></p>
    ${input.error ? html`<p role="alert" tabindex="-1" autofocus>Unable to save this decision. It may be stale or incomplete. Review the current brief and try again. / 入力不足または古い版です。現在の内容を確認してください。</p>` : html``}
    ${view ? html`<p role="status">${statuses[view.status]}</p><p class="metadata">Revision / 版: <code>${view.draft.id}</code></p>` : html``}
    ${view?.status === "approved" ? html`<p><a href="/outlines/${setup.studyId}">Study outline / <span lang="ja">学習の構成</span></a></p>` : html``}
    <details open><summary>Source scope and exclusions / 対象と除外</summary>
    <p>${scope.kind === "partial" ? "Partial coverage / 一部のみ" : "All main chapters / 本文全章"}</p>
    <h2>Included / 対象</h2><ul>${scope.selected.map((item) => html`<li>${item.resourcePath}<small>${item.blockIds.join(", ")}</small></li>`)}</ul>
    <h2>Excluded sources / 除外資料</h2>${scope.exclusions.length ? html`<ul>${scope.exclusions.map((item) => html`<li>${item.resourcePath}<small>${item.blockIds.join(", ")}</small></li>`)}</ul>` : html`<p>None / なし</p>`}
    <p>Source scope comes from study setup. Changing it requires reviewing a new brief. / 対象範囲は読書設定に従います。変更後は再確認が必要です。</p></details>
    ${
      !view || input.edit || view.status === "revise" || view.status === "outdated"
        ? briefEditor(view)
        : content && guiding
          ? html`
      <article><h2>Guiding question / 主となる問い</h2><p lang="en">${guiding.en}</p><p lang="ja">${guiding.ja}</p>
      <h2>Supporting questions / 補助の問い</h2>${content.supportingQuestions.length ? html`<ol>${content.supportingQuestions.map((question) => html`<li><p lang="en">${question.en}</p><p lang="ja">${question.ja}</p></li>`)}</ol>` : html`<p>None / なし</p>`}</article>
      <h2>Original vs refined / 元の問いと別案の比較</h2>
      <dl><dt>Original / 元の問い</dt><dd lang="en">${content.originalQuestion.en}</dd><dd lang="ja">${content.originalQuestion.ja}</dd>
      <dt>Refined alternative / 別案</dt><dd lang="en">${content.refinedQuestion?.en ?? "No alternative supplied"}</dd><dd lang="ja">${content.refinedQuestion?.ja ?? "別案なし"}</dd></dl>
      <p>English: ${content.refinedQuestion && content.originalQuestion.en !== content.refinedQuestion.en ? "Changed" : "Unchanged"} · <span lang="ja">日本語: ${content.refinedQuestion && content.originalQuestion.ja !== content.refinedQuestion.ja ? "変更あり" : "変更なし"}</span></p>
      <p>Selected: ${content.questionChoice === "original" ? "Original / 元の問い" : "Refined / 別案"}. Alternatives never replace your question automatically.</p>
      <dl><dt>Purpose / 目的</dt><dd>${content.purpose}</dd><dt>Personal context / 個人的な背景</dt><dd>${content.context}</dd>
      <dt>Depth / 深さ</dt><dd>${{ overview: "Overview / 概観", focused: "Focused / 焦点を絞る", deep: "Deep / 深く読む" }[content.depth]}</dd><dt>Languages / 言語</dt><dd>${{ en: "English", ja: "日本語", paired: "English + 日本語" }[content.language]}</dd><dt>Spoilers / ネタバレ</dt><dd>${content.spoilerPolicy === "avoid" ? "Avoid spoilers / ネタバレを避ける" : "Allow spoilers / ネタバレを許可"}</dd><dt>Topic exclusions / 除外する話題</dt><dd>${content.exclusions.join("\n") || "None / なし"}</dd></dl>
      ${briefDecisions(view)}`
          : html``
    }
    ${input.descendants.length ? html`<h2>Descendants / 派生成果</h2><ul>${input.descendants.map((item) => html`<li>${item.kind}: ${item.id} — ${item.status}</li>`)}</ul>` : html``}
  </section>`,
  )
}
