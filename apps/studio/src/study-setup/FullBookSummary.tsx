import { useLanguage } from "../i18n/LanguageProvider.tsx"
import type { FullBookReview } from "./full-book-client.ts"

export function FullBookSummary({ value }: { readonly value: FullBookReview }) {
  const { t, locale } = useLanguage()
  const budget = value.budget
  return (
    <div>
      <h2>{t("fullBook.budget")}</h2>
      {value.hierarchy.policyVersion && <code>{value.hierarchy.policyVersion}</code>}
      <dl className="subscription-observations setup-connection-details full-book-budget">
        <dt>{t("fullBook.spent")}</dt>
        <dd>{budget.spent}</dd>
        <dt>{t("fullBook.held")}</dt>
        <dd>{budget.held}</dd>
        <dt>{t("fullBook.unknown")}</dt>
        <dd>{budget.unknown}</dd>
        <dt>{t("fullBook.pending")}</dt>
        <dd>{budget.pending}</dd>
        <dt>{t("fullBook.jobs")}</dt>
        <dd>{budget.proposedMaxJobs}</dd>
        <dt>{t("fullBook.attempts")}</dt>
        <dd>{budget.proposedMaxAttempts}</dd>
        <dt>{t("fullBook.ceiling")}</dt>
        <dd>{budget.sourceCeiling}</dd>
      </dl>
      <p>{t(budget.fits ? "fullBook.fits" : "fullBook.overBudget")}</p>
      <p>
        {t("fullBook.hierarchy", {
          windows: value.hierarchy.windows,
          groups: value.hierarchy.groups,
          levels: value.hierarchy.levels,
          batches: value.hierarchy.findingBatches,
        })}
      </p>
      <h2>
        {value.route.provider} / {value.route.model}
      </h2>
      <p>
        <small>
          {value.source.normalizationRevisionId} · {value.source.sourceHash}
        </small>
      </p>
      <p>
        {t("fullBook.available", {
          blocks: value.source.readableBlocks,
          bytes: value.source.availableTextUtf8Bytes,
        })}
      </p>
      <h2>{t("fullBook.omissions")}</h2>
      <p>
        {t(
          value.source.coverage === "partial"
            ? "source.coverage.partial"
            : "source.coverage.complete",
        )}
      </p>
      {value.source.omissions.length ? (
        <ul>
          {value.source.omissions.map((item) => (
            <li key={`${item.path}-${item.reason}`}>
              {item.path} · {item.reason}
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("fullBook.noOmissions")}</p>
      )}
      <ul>
        {value.warnings[locale].map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  )
}
