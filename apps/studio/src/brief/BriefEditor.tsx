import type { FormEvent, ReactElement } from "react"
import type { z } from "zod"
import type { Brief } from "./client.ts"
import { BriefSave } from "./client.ts"

const selects = {
  questionChoice: {
    label: "Guiding question / 主となる問い",
    options: [
      ["original", "Keep original / 元の問いを使う"],
      ["refined", "Use refined / 別案を使う"],
    ],
  },
  depth: {
    label: "Depth / 深さ",
    options: [
      ["overview", "Overview / 概観"],
      ["focused", "Focused / 焦点を絞る"],
      ["deep", "Deep / 深く読む"],
    ],
  },
  language: {
    label: "Languages / 言語",
    options: [
      ["en", "English"],
      ["ja", "日本語"],
      ["paired", "English + 日本語"],
    ],
  },
  spoilerPolicy: {
    label: "Spoilers / ネタバレ",
    options: [
      ["avoid", "Avoid / 避ける"],
      ["allow", "Allow / 許可する"],
    ],
  },
} as const

export function BriefEditor({
  view,
  onSave,
  busy,
}: {
  readonly view: Brief["view"]
  readonly onSave: (value: z.infer<typeof BriefSave>) => void
  readonly busy: boolean
}): ReactElement {
  const content = view?.draft.content
  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const values = Object.fromEntries(
      [...form.entries()].map(([key, value]) => [key, String(value)]),
    )
    const parsed = BriefSave.safeParse(values)
    if (parsed.success) onSave(parsed.data)
  }
  const text = (name: string, label: string, value = "", required = false) => (
    <label key={name}>
      {label}
      <textarea name={name} rows={2} required={required} defaultValue={value} />
    </label>
  )
  const select = (name: keyof typeof selects, value: string) => (
    <label key={name}>
      {selects[name].label}
      <select name={name} defaultValue={value}>
        {selects[name].options.map(([id, title]) => (
          <option key={id} value={id}>
            {title}
          </option>
        ))}
      </select>
    </label>
  )
  return (
    <form key={view?.draft.id ?? "new"} onSubmit={save}>
      <input type="hidden" name="action" value="save" />
      <input type="hidden" name="expectedRevisionId" value={view?.draft.id ?? ""} />
      <h2>Original question / 最初の問い</h2>
      {content ? (
        <>
          <p lang="en">{content.originalQuestion.en}</p>
          <p lang="ja">{content.originalQuestion.ja}</p>
          <input type="hidden" name="originalEn" value={content.originalQuestion.en} />
          <input type="hidden" name="originalJa" value={content.originalQuestion.ja} />
        </>
      ) : (
        <>
          {text("originalEn", "Original question (English)", "", true)}
          {text("originalJa", "最初の問い（日本語）", "", true)}
        </>
      )}
      <h2>Refined alternative / 練り直した問い</h2>
      <p>
        The original stays unchanged. Select the alternative only if it expresses your intent. /
        元の問いは保存されます。意図に合う場合のみ別案を選んでください。
      </p>
      {text("refinedEn", "Refined question (English)", content?.refinedQuestion?.en ?? "")}
      {text("refinedJa", "練り直した問い（日本語）", content?.refinedQuestion?.ja ?? "")}
      {select("questionChoice", content?.questionChoice ?? "original")}
      <h2>Supporting questions / 補助の問い</h2>
      <p>Up to three; leave unused pairs blank. / 最大3つ。不要な組は空欄にしてください。</p>
      {[0, 1, 2].map((index) => (
        <div key={index}>
          {text(
            `supportEn${index}`,
            `Supporting question ${index + 1} (English)`,
            content?.supportingQuestions[index]?.en ?? "",
          )}
          {text(
            `supportJa${index}`,
            `補助の問い ${index + 1}（日本語）`,
            content?.supportingQuestions[index]?.ja ?? "",
          )}
        </div>
      ))}
      {text("purpose", "Purpose / 読書の目的", content?.purpose ?? "", true)}
      {text("context", "Personal context / 個人的な背景", content?.context ?? "", true)}
      {select("depth", content?.depth ?? "focused")}
      {select("language", content?.language ?? "paired")}
      {select("spoilerPolicy", content?.spoilerPolicy ?? "avoid")}
      {text(
        "exclusions",
        "Topic exclusions, one per line / 除外する話題（1行に1つ）",
        content?.exclusions.join("\n") ?? "",
      )}
      <p>
        Saving creates a new revision and invalidates earlier approval and descendants. It does not
        start generation. /
        保存すると新しい版になり、以前の承認と派生成果は古い状態になります。生成は開始しません。
      </p>
      <button type="submit" disabled={busy}>
        Review brief / 内容を確認
      </button>
    </form>
  )
}
