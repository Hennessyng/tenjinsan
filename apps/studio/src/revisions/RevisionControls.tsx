import type { ReactElement } from "react"

export function RevisionForkControls({
  busy,
  onFork,
}: {
  readonly busy: boolean
  readonly onFork: () => void
}): ReactElement {
  return (
    <div>
      <button type="button" disabled={busy} onClick={onFork}>
        Fork a second lens / 別の視点に分岐
      </button>
      <p>
        Reuse matching analysis, not answers, approvals or transmission consent. The original stays
        unchanged.{" "}
        <span lang="ja">
          一致する解析のみ再利用し、回答・承認・送信許可は引き継ぎません。元の読書は保持されます。
        </span>
      </p>
    </div>
  )
}
