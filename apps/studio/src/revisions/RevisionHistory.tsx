import type { ReactElement } from "react"
import type { Revision } from "./client.ts"

export function RevisionHistory({
  history,
  currentId,
}: {
  readonly history: Revision["view"]["history"]
  readonly currentId: string
}): ReactElement {
  const old = history.filter((revision) => revision.id !== currentId)
  return (
    <>
      <h2>
        Setup history / <span lang="ja">設定の履歴</span>
      </h2>
      {old.length ? (
        old.map((revision, index) => (
          <section key={revision.id}>
            <h3>
              Old setup version {old.length - index} / <span lang="ja">旧設定</span>
            </h3>
            <p>
              {revision.analysis.provider} · {revision.analysis.model}
            </p>
            <p className="metadata">
              <code>{revision.id}</code>
            </p>
            <p>
              Retained for lineage, not current approval.{" "}
              <span lang="ja">履歴として保持され、現在の承認には使われません。</span>
            </p>
          </section>
        ))
      ) : (
        <p>
          No previous setup versions / <span lang="ja">以前の設定はありません</span>
        </p>
      )}
      <p>
        Old successful exports remain versioned after edits.{" "}
        <span lang="ja">変更後も成功済みの出力は旧版として保持されます。</span>
      </p>
    </>
  )
}
