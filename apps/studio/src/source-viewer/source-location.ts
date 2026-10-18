import type { CatalogKey, Params } from "@reading-studio/contracts/i18n"
import type { SourceBlock } from "@reading-studio/contracts/source"
import type { z } from "zod"

export function sourceLocation(
  block: Pick<z.infer<typeof SourceBlock>, "locator" | "pageLabel" | "structure">,
  t: (key: CatalogKey, params?: Params) => string,
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
