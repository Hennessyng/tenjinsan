import type { FormEvent, ReactElement } from "react"
import type { Evidence, EvidenceAction } from "./client.ts"

export function EvidenceValues({
  value,
  onAction,
  busy,
}: {
  readonly value: Evidence
  readonly onAction: (action: EvidenceAction) => void
  readonly busy: boolean
}): ReactElement {
  return (
    <>
      <h2 id="projected-content">
        4. Inspect and clean / <span lang="ja">確認と修正</span>
      </h2>
      <a
        href={`/api/evidence/${value.view.draft.studyId}/${value.view.draft.lessonRevisionId}/preview`}
      >
        Preview cleaned projection / <span lang="ja">修正後の公開用データを確認</span>
      </a>
      <p>
        <a
          href={`/api/evidence/${value.view.draft.studyId}/${value.view.draft.lessonRevisionId}/read`}
        >
          Read bilingual lesson / <span lang="ja">対訳で本文を読む</span>
        </a>
      </p>
      <p>
        <a href={`/publications/${value.view.draft.studyId}`}>
          Publication and versioned files / <span lang="ja">公開承認とファイル履歴</span>
        </a>
      </p>
      <details>
        <summary>Inspect every projected value / すべての値を確認</summary>
        {value.entries.map((entry, index) => (
          <details key={`${value.view.draft.id}-${entry.path}`}>
            <summary>{entry.path}</summary>
            <p lang={entry.path.endsWith("/ja") ? "ja" : "en"}>{entry.text}</p>
            <form
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                const data = new FormData(event.currentTarget)
                onAction({
                  action: "replace-text",
                  path: entry.path,
                  text: String(data.get("text") ?? ""),
                })
              }}
            >
              <label htmlFor={`value-${index}`}>Correct {entry.path}</label>
              <textarea
                id={`value-${index}`}
                name="text"
                rows={3}
                required
                defaultValue={entry.text}
              />
              <button type="submit" disabled={busy}>
                Save correction / 修正を保存
              </button>
            </form>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction({ action: "privacy-flag", path: entry.path })}
            >
              Flag private information / 非公開情報を指摘
            </button>
          </details>
        ))}
      </details>
      <details>
        <summary>Remove uncertain content / 不確かな内容を削除</summary>
        {value.removable.map((path) => (
          <p key={path}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction({ action: "remove-content", path })}
            >
              Remove {path}
            </button>
          </p>
        ))}
      </details>
    </>
  )
}
