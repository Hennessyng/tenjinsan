import { type EvidenceView, projectedStrings } from "@reading-studio/contracts"
import { html } from "hono/html"
import { sourcePage } from "../source-viewer/page.ts"

export { readerDocument, sceneRuntime, spatialRuntime } from "@reading-studio/reader"
export { evidencePreview } from "./preview.ts"

export function evidencePage(
  view: EvidenceView,
  error: boolean,
  references: readonly {
    readonly title: string
    readonly href: string
    readonly text: string
  }[],
) {
  const { draft, privacy, mechanical } = view
  const expected = html`<input type="hidden" name="expectedId" value="${draft.id}">`
  const labels = {
    support: "Support / 主張の裏付け",
    qualification: "Qualifications / 留保",
    translation: "Translation / 翻訳",
    visual: "Visual assumptions / 図解の仮定",
  }
  return sourcePage(
    "Evidence and privacy / 根拠とプライバシー",
    html`
    <section class="setup evidence"><p class="eyebrow">REVIEW / BEFORE PUBLICATION</p>
    <h1>Evidence and privacy / <span lang="ja">根拠とプライバシー</span></h1>
    <nav><a href="/outlines/${draft.studyId}">Study outline / <span lang="ja">学習の構成</span></a></nav>
    ${error ? html`<p role="alert" tabindex="-1" autofocus>Unable to proceed: stale review, invalid correction or unresolved privacy flag. / 確認が古いか、修正が無効か、プライバシーの指摘が残っています。</p>` : html``}
    <p role="status">${draft.keepPrivate ? "Kept private; publication blocked." : view.ready ? "Ready for later publication approval; not published." : "Review required; publication blocked."}</p>
    <p class="metadata">Lesson: ${draft.lessonRevisionId}<br>Projection: ${draft.projectionHash}<br>Report: ${view.reportHash}</p>
    <h2>1. Source integrity / <span lang="ja">出典の整合性</span></h2>
    <p>${mechanical.length ? "Broken locators or unsupported quotations cannot be acknowledged away." : "Locators and quotations match stored text. This does not establish semantic support."}</p>
    <ul>${mechanical.map((flag) => html`<li role="alert">${flag.category}: <code>${flag.path}</code></li>`)}</ul>
    <details><summary>Compare original source passages / 原文と比較</summary>${references.map((reference) => html`<p><a href="${reference.href}">${reference.title}</a></p><blockquote>${reference.text}</blockquote>`)}</details>
    <h2>2. Meaning review / <span lang="ja">意味の確認</span></h2>
    <p>Compare claims with source passages, retained caveats, both languages and visual assumptions. Correct or remove content below, or explicitly acknowledge uncertainty. Acknowledged does not mean verified. / <span lang="ja">主張・留保・両言語・図解の仮定を確認してください。不確実性の認識は、正しさの証明ではありません。</span></p>
    ${draft.semantic.map(
      (decision) => html`<form method="post" aria-label="${decision.category}">${expected}
      <input type="hidden" name="action" value="semantic"><input type="hidden" name="category" value="${decision.category}">
      <h3>${labels[decision.category]}</h3><p>State: ${decision.status}</p><div class="setup-actions">
      <button name="status" value="reviewed">Mark ${decision.category} reviewed</button>
      <button name="status" value="acknowledged">Acknowledge ${decision.category} uncertainty</button></div></form>`,
    )}
    <h2>3. Privacy / <span lang="ja">プライバシー</span></h2>
    <p>Screened ${privacy.reviewedPaths.length} projected values. Screening assists review; it cannot guarantee anonymization. Inspect names, identifying situations and private source details in both languages. Privacy flags cannot be waived. / <span lang="ja">自動確認は匿名化を保証しません。個人を特定する情報を両言語で確認してください。指摘は免除できません。</span></p>
    <ul>${privacy.findings.map((finding) => html`<li role="alert">${finding.category}: <a href="#projected-content"><code>${finding.path}</code></a> — remove or generalize / 削除または一般化</li>`)}</ul>
    <form method="post">${expected}<input type="hidden" name="action" value="private-detail">
      <label for="private-detail">Known private detail or translated alias / 非公開情報・別言語での表記</label><input id="private-detail" name="text" required><button>Add to screening</button></form>
    <form method="post">${expected}<div class="setup-actions"><button name="action" value="privacy-reviewed" ${privacy.findings.length ? html`disabled` : html``}>Confirm privacy review of all projected content</button>
      <button name="action" value="keep-private">Keep private / 非公開のままにする</button></div></form>
    <p>Privacy review: ${privacy.status}. Every content change requires a new review. / <span lang="ja">内容の変更後は再確認が必要です。</span></p>
    <h2 id="projected-content">4. Inspect and clean / <span lang="ja">確認と修正</span></h2>
    <a href="/evidence/${draft.studyId}/${draft.lessonRevisionId}/preview">Preview cleaned projection / <span lang="ja">修正後の公開用データを確認</span></a>
    <p><a href="/evidence/${draft.studyId}/${draft.lessonRevisionId}/read">Read bilingual lesson / <span lang="ja">対訳で本文を読む</span></a></p>
    <p><a href="/publications/${draft.studyId}">Publication and versioned files / <span lang="ja">公開承認とファイル履歴</span></a></p>
    <details><summary>Inspect every projected value / すべての値を確認</summary>
      ${projectedStrings(draft.projection).map(
        (
          entry,
          index,
        ) => html`<details><summary>${entry.path}</summary><p lang="${entry.path.endsWith("/ja") ? "ja" : "en"}">${entry.text}</p>
        <form method="post">${expected}<input type="hidden" name="action" value="replace-text"><input type="hidden" name="path" value="${entry.path}">
        <label for="value-${index}">Correct ${entry.path}</label><textarea id="value-${index}" name="text" rows="3" required>${entry.text}</textarea><button>Save correction / 修正を保存</button></form>
        <form method="post">${expected}<input type="hidden" name="action" value="privacy-flag"><input type="hidden" name="path" value="${entry.path}"><button>Flag private information / 非公開情報を指摘</button></form></details>`,
      )}
    </details>
    <details><summary>Remove uncertain content / 不確かな内容を削除</summary>
      ${draft.projection.sections.map((section, index) =>
        [
          `/sections/${index}`,
          ...section.scenes.map((_, i) => `/sections/${index}/scenes/${i}`),
          ...section.practice.map((_, i) => `/sections/${index}/practice/${i}`),
          ...section.sourceNotes.map((_, i) => `/sections/${index}/sourceNotes/${i}`),
        ].map(
          (path) =>
            html`<form method="post">${expected}<input type="hidden" name="action" value="remove-content"><input type="hidden" name="path" value="${path}"><button>Remove ${path}</button></form>`,
        ),
      )}
    </details></section>`,
  )
}
