import type { ReactElement } from "react"
import type { Brief } from "./client.ts"

export function BriefReview({
  view,
  onDecision,
  busy,
}: {
  readonly view: NonNullable<Brief["view"]>
  readonly onDecision: (action: "approve" | "revise" | "defer") => void
  readonly busy: boolean
}): ReactElement {
  const { content } = view.draft
  const guiding =
    content.questionChoice === "refined" && content.refinedQuestion
      ? content.refinedQuestion
      : content.originalQuestion
  return (
    <>
      <article>
        <h2>Guiding question / 主となる問い</h2>
        <p lang="en">{guiding.en}</p>
        <p lang="ja">{guiding.ja}</p>
        <h2>Supporting questions / 補助の問い</h2>
        {content.supportingQuestions.length ? (
          <ol>
            {content.supportingQuestions.map((question) => (
              <li key={`${question.en}:${question.ja}`}>
                <p lang="en">{question.en}</p>
                <p lang="ja">{question.ja}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="workspace-empty">None / なし</p>
        )}
      </article>
      <h2>Original vs refined / 元の問いと別案の比較</h2>
      <dl>
        <dt>Original / 元の問い</dt>
        <dd lang="en">{content.originalQuestion.en}</dd>
        <dd lang="ja">{content.originalQuestion.ja}</dd>
        <dt>Refined alternative / 別案</dt>
        <dd className={content.refinedQuestion ? undefined : "workspace-empty"} lang="en">
          {content.refinedQuestion?.en ?? "No alternative supplied"}
        </dd>
        <dd className={content.refinedQuestion ? undefined : "workspace-empty"} lang="ja">
          {content.refinedQuestion?.ja ?? "別案なし"}
        </dd>
      </dl>
      <p>
        English:{" "}
        {content.refinedQuestion && content.originalQuestion.en !== content.refinedQuestion.en
          ? "Changed"
          : "Unchanged"}{" "}
        ·{" "}
        <span lang="ja">
          日本語:{" "}
          {content.refinedQuestion && content.originalQuestion.ja !== content.refinedQuestion.ja
            ? "変更あり"
            : "変更なし"}
        </span>
      </p>
      <p>
        Selected: {content.questionChoice === "original" ? "Original / 元の問い" : "Refined / 別案"}
        . Alternatives never replace your question automatically.
      </p>
      <dl>
        <dt>Purpose / 目的</dt>
        <dd>{content.purpose}</dd>
        <dt>Personal context / 個人的な背景</dt>
        <dd>{content.context}</dd>
        <dt>Depth / 深さ</dt>
        <dd>
          {
            {
              overview: "Overview / 概観",
              focused: "Focused / 焦点を絞る",
              deep: "Deep / 深く読む",
            }[content.depth]
          }
        </dd>
        <dt>Languages / 言語</dt>
        <dd>{{ en: "English", ja: "日本語", paired: "English + 日本語" }[content.language]}</dd>
        <dt>Spoilers / ネタバレ</dt>
        <dd>
          {content.spoilerPolicy === "avoid"
            ? "Avoid spoilers / ネタバレを避ける"
            : "Allow spoilers / ネタバレを許可"}
        </dd>
        <dt>Topic exclusions / 除外する話題</dt>
        <dd className={content.exclusions.length ? undefined : "workspace-empty"}>
          {content.exclusions.join("\n") || "None / なし"}
        </dd>
      </dl>
      <div className="setup-actions">
        {view.status !== "approved" && view.status !== "outdated" && view.status !== "revise" && (
          <button type="button" disabled={busy} onClick={() => onDecision("approve")}>
            Approve brief / 読書方針を承認
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => onDecision("revise")}>
          Revise / 修正する
        </button>
        <button type="button" disabled={busy} onClick={() => onDecision("defer")}>
          Defer / 保留する
        </button>
      </div>
    </>
  )
}
