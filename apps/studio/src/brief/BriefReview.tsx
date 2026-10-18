import type { ReactElement } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
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
  const { t } = useLanguage()
  const { content } = view.draft
  const guiding =
    content.questionChoice === "refined" && content.refinedQuestion
      ? content.refinedQuestion
      : content.originalQuestion
  return (
    <>
      <article>
        <h2>{t("brief.guiding")}</h2>
        <p lang="en">{guiding.en}</p>
        <p lang="ja">{guiding.ja}</p>
        <h2>{t("brief.supporting")}</h2>
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
          <p className="workspace-empty">{t("brief.none")}</p>
        )}
      </article>
      <h2>{t("brief.compare")}</h2>
      <dl>
        <dt>{t("brief.original")}</dt>
        <dd lang="en">{content.originalQuestion.en}</dd>
        <dd lang="ja">{content.originalQuestion.ja}</dd>
        <dt>{t("brief.refined")}</dt>
        <dd className={content.refinedQuestion ? undefined : "workspace-empty"} lang="en">
          {content.refinedQuestion?.en ?? t("brief.noAlternative")}
        </dd>
        <dd className={content.refinedQuestion ? undefined : "workspace-empty"} lang="ja">
          {content.refinedQuestion?.ja ?? t("brief.noAlternative")}
        </dd>
      </dl>
      <p>
        {t("brief.english")}:{" "}
        {content.refinedQuestion && content.originalQuestion.en !== content.refinedQuestion.en
          ? t("brief.changed")
          : t("brief.unchanged")}{" "}
        ·{" "}
        <span>
          {t("brief.japanese")}:{" "}
          {content.refinedQuestion && content.originalQuestion.ja !== content.refinedQuestion.ja
            ? t("brief.changed")
            : t("brief.unchanged")}
        </span>
      </p>
      <p>
        {t("brief.selected", {
          choice: content.questionChoice === "original" ? t("brief.original") : t("brief.refined"),
        })}
      </p>
      <dl>
        <dt>{t("brief.purpose")}</dt>
        <dd>{content.purpose}</dd>
        <dt>{t("brief.context")}</dt>
        <dd>{content.context}</dd>
        <dt>{t("brief.depth")}</dt>
        <dd>
          {
            {
              overview: t("brief.depth.overview"),
              focused: t("brief.depth.focused"),
              deep: t("brief.depth.deep"),
            }[content.depth]
          }
        </dd>
        <dt>{t("brief.languages")}</dt>
        <dd>
          {
            { en: t("brief.english"), ja: t("brief.japanese"), paired: t("brief.paired") }[
              content.language
            ]
          }
        </dd>
        <dt>{t("brief.spoilers")}</dt>
        <dd>
          {content.spoilerPolicy === "avoid"
            ? t("brief.spoilers.avoid")
            : t("brief.spoilers.allow")}
        </dd>
        <dt>{t("brief.exclusions")}</dt>
        <dd className={content.exclusions.length ? undefined : "workspace-empty"}>
          {content.exclusions.join("\n") || t("brief.none")}
        </dd>
      </dl>
      <div className="setup-actions">
        {view.status !== "approved" && view.status !== "outdated" && view.status !== "revise" && (
          <button type="button" disabled={busy} onClick={() => onDecision("approve")}>
            {t("brief.approve")}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => onDecision("revise")}>
          {t("brief.revise")}
        </button>
        <button type="button" disabled={busy} onClick={() => onDecision("defer")}>
          {t("brief.defer")}
        </button>
      </div>
    </>
  )
}
