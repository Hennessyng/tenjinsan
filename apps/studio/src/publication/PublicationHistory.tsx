import type { ReactElement } from "react"
import type { Publication } from "./client.ts"

export function PublicationHistory({
  value,
  busy,
  onGenerate,
}: {
  readonly value: Publication
  readonly busy: boolean
  readonly onGenerate: (id: string) => void
}): ReactElement {
  const { history } = value
  return (
    <>
      <h2>
        Versioned files / <span lang="ja">ファイルの履歴</span>
      </h2>
      <p>
        If generation fails or is interrupted, choose Revise, review again, then Publish a new
        version. Existing successful files are retained. /{" "}
        <span lang="ja">
          生成に失敗した場合は修正と再確認の後、新しい版を承認してください。成功済みのファイルは保持されます。
        </span>
      </p>
      {history.length ? (
        history.map(({ snapshot, current, outputs }, index) => (
          <section key={snapshot.publication.id}>
            <h3>
              Version {history.length - index} ·{" "}
              {current ? "Current approval / 現在の承認" : "Old version — stale / 旧版"}
            </h3>
            <p className="metadata">
              {snapshot.publication.id}
              <br />
              {snapshot.publication.approval.rendererVersion}
              <br />
              {snapshot.publication.approval.approvedAt}
            </p>
            <ul>
              {outputs.map((output) => (
                <li key={output.id}>
                  {output.format.toUpperCase()} —{" "}
                  {output.state === "released"
                    ? current
                      ? "Current / 現在"
                      : "Old version / 旧版"
                    : output.state === "failed"
                      ? `Error / エラー: ${output.error}`
                      : `${output.state} — not available / 未完成`}
                  {output.state === "released" && (
                    <a href={`/publication-artifacts/${output.id}`}>
                      Download {output.format.toUpperCase()} · version {history.length - index}
                    </a>
                  )}
                </li>
              ))}
            </ul>
            {current && outputs.some((output) => output.state === "queued") && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onGenerate(snapshot.publication.id)}
              >
                Generate approved files / 承認済みファイルを生成
              </button>
            )}
          </section>
        ))
      ) : (
        <p>No approved files yet / 承認済みファイルはまだありません</p>
      )}
    </>
  )
}
