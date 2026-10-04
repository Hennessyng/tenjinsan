import type { BriefView } from "@reading-studio/contracts"
import { html } from "hono/html"

export function briefEditor(view: BriefView | null) {
  const content = view?.draft.content
  const text = (name: string, label: string, value = "") =>
    html`<label>${label}<textarea name="${name}" rows="2" ${["originalEn", "originalJa", "purpose", "context"].includes(name) ? html`required` : html``}>${value}</textarea></label>`
  const labels = {
    questionChoice: "Guiding question / 主となる問い",
    depth: "Depth / 深さ",
    language: "Languages / 言語",
    spoilerPolicy: "Spoilers / ネタバレ",
  } as const
  const select = (
    name: keyof typeof labels,
    options: readonly (readonly [string, string])[],
    value: string,
  ) =>
    html`<label>${labels[name]}<select name="${name}">${options.map(([key, title]) => html`<option value="${key}" ${key === value ? html`selected` : html``}>${title}</option>`)}</select></label>`
  return html`<form method="post">
    <input type="hidden" name="action" value="save"><input type="hidden" name="expectedRevisionId" value="${view?.draft.id ?? ""}">
    <h2>Original question / 最初の問い</h2>
    ${content ? html`<p lang="en">${content.originalQuestion.en}</p><p lang="ja">${content.originalQuestion.ja}</p><input type="hidden" name="originalEn" value="${content.originalQuestion.en}"><input type="hidden" name="originalJa" value="${content.originalQuestion.ja}">` : html`${text("originalEn", "Original question (English)")}${text("originalJa", "最初の問い（日本語）")}`}
    <h2>Refined alternative / 練り直した問い</h2><p>The original stays unchanged. Select the alternative only if it expresses your intent. / 元の問いは保存されます。意図に合う場合のみ別案を選んでください。</p>
    ${text("refinedEn", "Refined question (English)", content?.refinedQuestion?.en)}
    ${text("refinedJa", "練り直した問い（日本語）", content?.refinedQuestion?.ja)}
    ${select(
      "questionChoice",
      [
        ["original", "Keep original / 元の問いを使う"],
        ["refined", "Use refined / 別案を使う"],
      ],
      content?.questionChoice ?? "original",
    )}
    <h2>Supporting questions / 補助の問い</h2><p>Up to three; leave unused pairs blank. / 最大3つ。不要な組は空欄にしてください。</p>
    ${[0, 1, 2].map((index) => html`${text(`supportEn${index}`, `Supporting question ${index + 1} (English)`, content?.supportingQuestions[index]?.en)}${text(`supportJa${index}`, `補助の問い ${index + 1}（日本語）`, content?.supportingQuestions[index]?.ja)}`)}
    ${text("purpose", "Purpose / 読書の目的", content?.purpose)}
    ${text("context", "Personal context / 個人的な背景", content?.context)}
    ${select(
      "depth",
      [
        ["overview", "Overview / 概観"],
        ["focused", "Focused / 焦点を絞る"],
        ["deep", "Deep / 深く読む"],
      ],
      content?.depth ?? "focused",
    )}
    ${select(
      "language",
      [
        ["en", "English"],
        ["ja", "日本語"],
        ["paired", "English + 日本語"],
      ],
      content?.language ?? "paired",
    )}
    ${select(
      "spoilerPolicy",
      [
        ["avoid", "Avoid / 避ける"],
        ["allow", "Allow / 許可する"],
      ],
      content?.spoilerPolicy ?? "avoid",
    )}
    ${text("exclusions", "Topic exclusions, one per line / 除外する話題（1行に1つ）", content?.exclusions.join("\n"))}
    <p>Saving creates a new revision and invalidates earlier approval and descendants. It does not start generation. / 保存すると新しい版になり、以前の承認と派生成果は古い状態になります。生成は開始しません。</p>
    <button type="submit">Review brief / 内容を確認</button>
  </form>`
}

export function briefDecisions(view: BriefView) {
  return html`<form method="post"><input type="hidden" name="revisionId" value="${view.draft.id}">
    <div class="setup-actions">${view.status !== "approved" && view.status !== "outdated" && view.status !== "revise" ? html`<button name="action" value="approve">Approve brief / 読書方針を承認</button>` : html``}
    <button name="action" value="revise">Revise / 修正する</button><button name="action" value="defer">Defer / 保留する</button></div>
  </form>`
}
