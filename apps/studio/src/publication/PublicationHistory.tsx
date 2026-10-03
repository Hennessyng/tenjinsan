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
      <aside className="publication-note" aria-label="Download note">
        <strong>Last stop / 最後の部屋</strong>
        <span>
          Files are versioned. Downloading never changes the approved copy. /{" "}
          <span lang="ja">
            ファイルは版ごとに保存されます。保存しても承認済みの内容は変わりません。
          </span>
        </span>
      </aside>
      {history.length ? (
        history.map(({ snapshot, current, outputs }, index) => (
          <section className="publication-edition" key={snapshot.publication.id}>
            <h3>
              Files, version {history.length - index} /{" "}
              <span lang="ja">ファイル（{history.length - index}版）</span> ·{" "}
              {current ? "Current approval / 現在の承認" : "Old version — stale / 旧版"}
            </h3>
            <p className="metadata">
              {snapshot.publication.id}
              <br />
              {snapshot.publication.approval.rendererVersion}
              <br />
              {snapshot.publication.approval.approvedAt}
            </p>
            <ul className="publication-volumes">
              {outputs.map((output) => (
                <li className="publication-volume" data-format={output.format} key={output.id}>
                  <strong>Lesson ({output.format.toUpperCase()})</strong>
                  <span className="publication-output-state">
                    {output.state === "released"
                      ? current
                        ? "Current / 現在"
                        : "Old version / 旧版"
                      : output.state === "failed"
                        ? `Error / エラー: ${output.error}`
                        : `${output.state} — not available / 未完成`}
                  </span>
                  {output.state === "released" && (
                    <span className="publication-format-note">
                      {output.format === "html"
                        ? "Opens in any browser. / どのブラウザでも開けます。"
                        : "For printing. / 印刷用です。"}
                    </span>
                  )}
                  {output.state === "released" && (
                    <a
                      className="publication-download"
                      href={`/publication-artifacts/${output.id}`}
                    >
                      Download {output.format.toUpperCase()} / 保存する · version{" "}
                      {history.length - index}
                    </a>
                  )}
                </li>
              ))}
            </ul>
            {current && outputs.some((output) => output.state === "queued") && (
              <div className="setup-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onGenerate(snapshot.publication.id)}
                >
                  Generate approved files / 承認済みファイルを生成
                </button>
              </div>
            )}
          </section>
        ))
      ) : (
        <p className="workspace-empty">No approved files yet / 承認済みファイルはまだありません</p>
      )}
    </>
  )
}
