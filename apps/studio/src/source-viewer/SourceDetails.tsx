import type {
  BookEdition,
  NormalizationRevision,
  SourceBlock,
} from "@reading-studio/contracts/source"
import type { ReactElement } from "react"
import type { z } from "zod"
import { type Translate, useLanguage } from "../i18n/LanguageProvider.tsx"

export function sourceLocation(
  block: Pick<z.infer<typeof SourceBlock>, "locator" | "pageLabel" | "structure">,
  t: Translate,
): string {
  const locator = block.locator
  if (!locator)
    return block.pageLabel === undefined
      ? t("source.location.noPage")
      : t("source.location.page", { label: block.pageLabel })
  switch (locator.kind) {
    case "pdf":
      return t("source.location.pdf", { page: locator.page })
    case "txt":
      return t("source.location.txt", { line: locator.startLine, offset: locator.start })
    case "docx":
      return `${t("source.location.docx", { part: locator.part, paragraph: locator.paragraph })}${block.structure ? ` · ${block.structure}` : ""}`
    default:
      return assertNever(locator)
  }
}
function assertNever(value: never): never {
  throw new TypeError(`Unexpected locator: ${value}`)
}

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
