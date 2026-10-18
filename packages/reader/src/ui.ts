import { assertNever, type ExportUi } from "@reading-studio/contracts"
import { type CatalogKey, translate, type UiLocale } from "@reading-studio/contracts/i18n"
import { html } from "hono/html"

function locales(ui: ExportUi): readonly UiLocale[] {
  switch (ui) {
    case "en":
      return ["en"]
    case "ja":
      return ["ja"]
    case "en+ja":
      return ["en", "ja"]
    default:
      return assertNever(ui)
  }
}

export function fixedUi(key: CatalogKey, ui: ExportUi) {
  return html`${locales(ui).map((locale, index) => html`${index ? " / " : ""}<span data-ui-copy lang="${locale}">${translate(locale, key)}</span>`)}`
}

export function fixedUiBlock(key: CatalogKey, ui: ExportUi) {
  return html`${locales(ui).map((locale) => html`<span data-ui-copy data-ui-block lang="${locale}">${translate(locale, key)}</span>`)}`
}

export function fixedUiText(key: CatalogKey, ui: ExportUi): string {
  return locales(ui)
    .map((locale) => translate(locale, key))
    .join(" / ")
}
