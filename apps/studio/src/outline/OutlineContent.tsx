import type { ReactElement } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import type { Outline } from "./client.ts"

export function OutlineContent({ value }: { readonly value: Outline }): ReactElement | null {
  const { t } = useLanguage()
  const { view, brief, scope } = value
  const content = view?.draft.content
  if (!content) return null
  const questions = brief ? [brief.guidingQuestion, ...brief.supportingQuestions] : []
  return (
    <>
      <h2>{content.title.en}</h2>
      <p lang="ja">{content.title.ja}</p>
      <h2>{t("outline.theme")}</h2>
      <p>{content.theme.en}</p>
      <p lang="ja">{content.theme.ja}</p>
      <h2>{t("outline.order")}</h2>
      <ol>
        {content.sections.map((section) => (
          <li key={section.id}>
            <article>
              <h3>{section.title.en}</h3>
              <p lang="ja">{section.title.ja}</p>
              <p>
                {t("outline.question", { n: section.questionIndex + 1 })}{" "}
                {questions[section.questionIndex]?.en ?? t("outline.questionMissing")}
              </p>
              <h4>{t("outline.goals")}</h4>
              <ul>
                {section.learningGoals.map((goal) => (
                  <li key={`${goal.en}:${goal.ja}`}>
                    {goal.en}
                    <p lang="ja">{goal.ja}</p>
                  </li>
                ))}
              </ul>
              <h4>{t("outline.evidence")}</h4>
              <ul>
                {section.sources.map((source) => (
                  <li key={`${source.resourcePath}-${source.blockId}-${source.start}`}>
                    {source.resourcePath} · {source.blockId} · {source.start}–{source.end}
                  </li>
                ))}
              </ul>
              <h4>{t("outline.visuals")}</h4>
              <p>
                {section.visualKind === "illustrative-model"
                  ? t("outline.illustrative")
                  : t("outline.grounded")}
              </p>
              {section.visualIntents.map((visual) => (
                <div key={`${visual.en}:${visual.ja}`}>
                  <p>{visual.en}</p>
                  <p lang="ja">{visual.ja}</p>
                </div>
              ))}
              {section.flags.map((flag) => (
                <p role="alert" key={flag}>
                  {t("outline.reviewFlag", { flag })}
                </p>
              ))}
            </article>
          </li>
        ))}
      </ol>
      <h2>{t("outline.qualifications")}</h2>
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
        <p className="workspace-empty">{t("outline.noQualifications")}</p>
      )}
      <h2>{t("outline.excluded")}</h2>
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
        <p>{t("outline.savedCustom", { text: view.draft.feedback.text })}</p>
      )}
    </>
  )
}
