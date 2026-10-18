import type { ReactElement } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import type { JobStatus } from "./client.ts"

export function InputCoverage({ job }: { readonly job: JobStatus }): ReactElement {
  const { t } = useLanguage()
  const payloads = [
    ...new Map(job.inputCoverage?.map((coverage) => [coverage.requestHash, coverage])).values(),
  ]
  return (
    <details>
      <summary>{t("jobs.coverage.summary")}</summary>
      <p>{t("jobs.coverage.note")}</p>
      {payloads.length ? (
        payloads.map((coverage, index) => (
          <section key={coverage.requestHash}>
            <h4>
              {t("jobs.coverage.payload", {
                n: index + 1,
                transmission: t(
                  coverage.transmission === "reviewed-scope"
                    ? "jobs.coverage.reviewedScope"
                    : "jobs.coverage.windowOnly",
                ),
              })}
            </h4>
            <p>
              {t("jobs.coverage.extraction", {
                extraction: t(
                  coverage.extraction === "complete"
                    ? "source.coverage.complete"
                    : "source.coverage.partial",
                ),
              })}
            </p>
            <p>
              {t("jobs.coverage.ranges", {
                sent: coverage.ranges.length,
                reviewed: coverage.reviewedRanges.length,
              })}
            </p>
            <ul>
              {coverage.ranges.map((range) => (
                <li key={`${range.blockId}-${range.start}`}>
                  {range.resourcePath} · {range.blockId} · UTF-16 [{range.start}, {range.end})
                </li>
              ))}
            </ul>
            <ul>
              {coverage.untransmittedRanges?.map((range) => (
                <li key={`omitted-${range.blockId}-${range.start}`}>
                  {t("jobs.coverage.untransmitted", {
                    range: `${range.resourcePath} · ${range.blockId} · UTF-16 [${range.start}, ${range.end})`,
                  })}
                </li>
              ))}
            </ul>
            <ul>
              {coverage.omissions.map((item) => (
                <li key={`${item.path}-${item.reason}`}>
                  {t("jobs.coverage.omission", { path: item.path, reason: item.reason })}
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <p>{t("jobs.coverage.none")}</p>
      )}
      {job.failureCode === "input-limit" && <p>{t("jobs.coverage.inputLimit")}</p>}
    </details>
  )
}
