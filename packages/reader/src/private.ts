import { translate, UI_LANGUAGE_STORAGE_KEY, type UiLocale } from "@reading-studio/contracts/i18n"
import { html, raw } from "hono/html"
import { readerDocument } from "./index.ts"
import { privateReaderRuntime } from "./private-script.ts"

export { privateReaderRuntime } from "./private-script.ts"

export function privateReaderDocument(input: unknown, locale: UiLocale = "en") {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key)
  return readerDocument(input, {
    ui: locale,
    controls: html`<fieldset class="language-controls" id="private-language-controls" data-storage-key="${UI_LANGUAGE_STORAGE_KEY}"><legend>${t("language.label")}</legend><div class="scene-actions"><button type="button" lang="en" data-private-locale="en" aria-pressed="${locale === "en"}">${t("language.name.en")}</button><button type="button" lang="ja" data-private-locale="ja" aria-pressed="${locale === "ja"}">${t("language.name.ja")}</button></div></fieldset><p id="private-language-notice" role="status" hidden>${t("language.notice.unsaved")}</p><dialog class="reader-dialog" id="private-language-dialog" aria-labelledby="private-language-title"><h2 id="private-language-title">${t("departure.title")}</h2><p>${t("departure.body")}</p><div class="scene-actions"><button type="button" data-stay autofocus>${t("departure.stay")}</button><button type="button" data-leave>${t("departure.leave")}</button></div></dialog>`,
    trailingScripts: html`<script data-private-language-runtime>${raw(privateReaderRuntime)}</script>`,
  })
}
