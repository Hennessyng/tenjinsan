import type { ReactElement } from "react"
import type { Outline } from "./client.ts"

export function OutlineContent({ value }: { readonly value: Outline }): ReactElement | null {
  const { view, brief, scope } = value
  const content = view?.draft.content
  if (!content) return null
  const questions = brief ? [brief.guidingQuestion, ...brief.supportingQuestions] : []
  return (
    <>
      <h2>{content.title.en}</h2>
      <p lang="ja">{content.title.ja}</p>
      <h2>
        Theme / <span lang="ja">主題</span>
      </h2>
      <p>{content.theme.en}</p>
      <p lang="ja">{content.theme.ja}</p>
      <h2>
        Section order / <span lang="ja">学ぶ順序</span>
      </h2>
      <ol>
        {content.sections.map((section) => (
          <li key={section.id}>
            <article>
              <h3>{section.title.en}</h3>
              <p lang="ja">{section.title.ja}</p>
              <p>
                Approved question {section.questionIndex + 1}:{" "}
                {questions[section.questionIndex]?.en ?? "Not in current brief"}
              </p>
              <h4>
                Learning goals / <span lang="ja">学習目標</span>
              </h4>
              <ul>
                {section.learningGoals.map((goal) => (
                  <li key={`${goal.en}:${goal.ja}`}>
                    {goal.en}
                    <p lang="ja">{goal.ja}</p>
                  </li>
                ))}
              </ul>
              <h4>
                Evidence / <span lang="ja">根拠</span>
              </h4>
              <ul>
                {section.sources.map((source) => (
                  <li key={`${source.resourcePath}-${source.blockId}-${source.start}`}>
                    {source.resourcePath} · {source.blockId} · {source.start}–{source.end}
                  </li>
                ))}
              </ul>
              <h4>
                Visual intentions / <span lang="ja">図解の意図</span>
              </h4>
              <p>
                {section.visualKind === "illustrative-model"
                  ? "Illustrative model — not an author claim"
                  : "Source-grounded visual claim"}
              </p>
              {section.visualIntents.map((visual) => (
                <div key={`${visual.en}:${visual.ja}`}>
                  <p>{visual.en}</p>
                  <p lang="ja">{visual.ja}</p>
                </div>
              ))}
              {section.flags.map((flag) => (
                <p role="alert" key={flag}>
                  Review required: {flag}
                </p>
              ))}
            </article>
          </li>
        ))}
      </ol>
      <h2>
        Retained qualifications / <span lang="ja">保持する留保</span>
      </h2>
      {content.qualifications.length ? (
        <ul>
          {content.qualifications.map((item) => (
            <li key={`${item.text}:${item.sources.map((source) => source.blockId).join(":")}`}>
              {item.text}
              <small>
                {item.sources
                  .map((source) => `${source.resourcePath}:${source.blockId}`)
                  .join(", ")}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <p>No qualifications recorded in this analysis; this is not a claim that none exist.</p>
      )}
      <h2>
        Excluded areas / <span lang="ja">扱わない範囲</span>
      </h2>
      <ul>
        {content.excludedAreas.map((item) => (
          <li key={item}>{item}</li>
        ))}
        {scope?.exclusions.map((item) => (
          <li key={item.resourcePath}>
            {item.resourcePath}: {item.blockIds.join(", ")}
          </li>
        ))}
      </ul>
      {view?.draft.feedback?.kind === "custom" && (
        <p>Saved custom request (original language): {view.draft.feedback.text}</p>
      )}
    </>
  )
}
