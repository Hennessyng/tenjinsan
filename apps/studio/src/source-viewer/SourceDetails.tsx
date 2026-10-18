import type { BookEdition, NormalizationRevision } from "@reading-studio/contracts/source"
import type { ReactElement } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"

export { sourceLocation } from "./source-location.ts"

export function SourceDetails({
  edition,
  normalization,
}: {
  readonly edition: BookEdition
  readonly normalization: NormalizationRevision
}): ReactElement {
  const { t } = useLanguage()
  return (
    <details>
      <summary>{t("source.details.summary")}</summary>
      <p>
        {t("source.details.hash")} <code>{edition.originalHash}</code>
      </p>
      <p>
        {t("source.details.revision")} <code>{normalization.id}</code>
        <br />
        {t("source.details.parser", {
          parser: normalization.parserVersion,
          normalizer: normalization.normalizerVersion,
        })}
      </p>
      <p>{t("source.details.note")}</p>
      {(
        normalization.omissions ??
        normalization.resources.flatMap((resource) =>
          resource.status === "excluded" ? [{ path: resource.path, reason: resource.reason }] : [],
        )
      ).map((item) => (
        <p key={`${item.path}-${item.reason}`}>
          {t("source.details.omitted", { path: item.path, reason: item.reason })}
        </p>
      ))}
    </details>
  )
}
