import EN from "./EN.json" with { type: "json" }
import JP from "./JP.json" with { type: "json" }

export const UI_LANGUAGE_STORAGE_KEY = "tenjinsan.ui-language"
export const englishCatalog: Readonly<typeof EN> = EN

export const UI_LOCALES = ["en", "ja"] as const
export type UiLocale = (typeof UI_LOCALES)[number]
export const DEFAULT_UI_LOCALE: UiLocale = "en"
export type CatalogKey = keyof typeof EN
export type Catalog = Readonly<Record<string, string>>
export type Catalogs = Readonly<Record<UiLocale, Catalog>>
export type Params = Readonly<Record<string, string | number>>
export type CatalogProblem = Readonly<{
  locale: UiLocale
  key: string
  reason: "missing" | "blank"
}>

export const catalogs: Catalogs = { en: EN, ja: JP }

function usable(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== ""
}

/**
 * Looks up a UI string. Unexpectedly unavailable text in the chosen locale falls back to
 * English; the build-time `validateCatalogs` failure, not this fallback, keeps catalogs
 * complete. Params replace `{name}` placeholders as plain text.
 */
export function translate(
  locale: UiLocale,
  key: CatalogKey,
  params?: Params,
  source: Catalogs = catalogs,
): string {
  const chosen = source[locale][key]
  const text = usable(chosen) ? chosen : (source.en[key] ?? "")
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => String(params[name] ?? whole))
}

/** Every consumed key must exist and be nonblank in every locale, English included. */
export function validateCatalogs(
  source: Catalogs,
  consumedKeys: readonly string[],
): readonly CatalogProblem[] {
  return UI_LOCALES.flatMap((locale) =>
    consumedKeys.flatMap((key): CatalogProblem[] => {
      const value = source[locale][key]
      if (value === undefined) return [{ locale, key, reason: "missing" }]
      return usable(value) ? [] : [{ locale, key, reason: "blank" }]
    }),
  )
}
