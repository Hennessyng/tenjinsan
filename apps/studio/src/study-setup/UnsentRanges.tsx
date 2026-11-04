import type { PreparationReview } from "@reading-studio/contracts/setup-progress"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { sourceLocation } from "../source-viewer/SourceDetails.tsx"

export function UnsentRanges({ ranges }: { readonly ranges: PreparationReview["unsentRanges"] }) {
  const { t } = useLanguage()
  return (
    <>
      <h3>{t("setup.refusal.unsent")}</h3>
      <ul>
        {ranges.map((range) => (
          <li key={`${range.resourcePath}-${range.blockId}-${range.start}-${range.end}`}>
            {range.resourcePath} · {range.blockId} · UTF-16 [{range.start}, {range.end}) ·{" "}
            {sourceLocation(range, t)}
          </li>
        ))}
      </ul>
    </>
  )
}
