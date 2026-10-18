import type { CatalogKey } from "@reading-studio/contracts/i18n"

export function revisionScopeLabel(kind: string, t: (key: CatalogKey) => string): string {
  switch (kind) {
    case "partial":
      return t("brief.scope.partial")
    case "all-main-chapters":
      return t("brief.scope.main")
    case "whole-document":
      return t("brief.scope.whole")
    default:
      return kind
  }
}
