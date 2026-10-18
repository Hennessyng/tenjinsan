import {
  DEFAULT_UI_LOCALE,
  UI_LANGUAGE_STORAGE_KEY,
  UI_LOCALES,
  type UiLocale,
} from "@reading-studio/contracts/i18n"

export const LANGUAGE_STORAGE_KEY = UI_LANGUAGE_STORAGE_KEY
export type StorageLike = Pick<Storage, "getItem" | "setItem">
export type LocaleSource = "explicit" | "remembered" | "default"
export type ResolvedLocale = Readonly<{ locale: UiLocale; source: LocaleSource }>

export function parseLocale(raw: string | null | undefined): UiLocale | null {
  return UI_LOCALES.find((locale) => locale === raw) ?? null
}

function readRemembered(storage: StorageLike | null): UiLocale | null {
  if (storage === null) return null
  try {
    return parseLocale(storage.getItem(LANGUAGE_STORAGE_KEY))
  } catch (failure) {
    console.warn("[ui-language] storage read failed; using fallback order", failure)
    return null
  }
}

/** Accepted explicit `lang` wins, then a valid remembered choice, then English. Never writes. */
export function resolveLocale(
  explicit: string | null,
  storage: StorageLike | null,
): ResolvedLocale {
  const requested = parseLocale(explicit)
  if (requested !== null) return { locale: requested, source: "explicit" }
  const remembered = readRemembered(storage)
  if (remembered !== null) return { locale: remembered, source: "remembered" }
  return { locale: DEFAULT_UI_LOCALE, source: "default" }
}

export function rememberLocale(storage: StorageLike | null, locale: UiLocale): "saved" | "failed" {
  if (storage === null) return "failed"
  try {
    storage.setItem(LANGUAGE_STORAGE_KEY, locale)
    return "saved"
  } catch (failure) {
    console.warn("[ui-language] storage write failed; choice applies to this session only", failure)
    return "failed"
  }
}

export function browserStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch (failure) {
    console.warn("[ui-language] localStorage unavailable", failure)
    return null
  }
}
