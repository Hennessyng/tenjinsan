import { assertNever, type ExportUi } from "@reading-studio/contracts"
import type { CatalogKey } from "@reading-studio/contracts/i18n"

export function exportInterfaceLabel(
  ui: ExportUi | undefined,
  t: (key: CatalogKey) => string,
): string {
  switch (ui) {
    case "en":
      return t("publication.exportUi.en")
    case "ja":
      return t("publication.exportUi.ja")
    case "en+ja":
      return t("publication.exportUi.paired")
    case undefined:
      return t("publication.exportUi.legacy")
    default:
      return assertNever(ui)
  }
}

export function pendingOutputLabel(state: string, t: (key: CatalogKey) => string): string {
  switch (state) {
    case "queued":
      return t("jobs.state.queued")
    case "running":
      return t("jobs.state.running")
    default:
      return state
  }
}
