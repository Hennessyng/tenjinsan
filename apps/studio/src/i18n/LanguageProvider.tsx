import {
  type CatalogKey,
  type Params,
  translate,
  type UiLocale,
} from "@reading-studio/contracts/i18n"
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { requestDeparture } from "../library/useUnsavedEdits.ts"
import { browserStorage, parseLocale, rememberLocale, resolveLocale } from "./preference.ts"

type Persistence = "saved" | "session-only"
export type Translate = (key: CatalogKey, params?: Params) => string
type Language = Readonly<{
  locale: UiLocale
  t: Translate
  requestLocale: (next: UiLocale) => void
  resetNonce: number
  persistence: Persistence
}>

const LanguageContext = createContext<Language | null>(null)

export function useLanguage(): Language {
  const value = useContext(LanguageContext)
  if (value === null) throw new TypeError("LanguageProvider is missing")
  return value
}

function persistenceOf(outcome: "saved" | "failed"): Persistence {
  return outcome === "saved" ? "saved" : "session-only"
}

export function LanguageProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [initial] = useState(() =>
    resolveLocale(new URL(location.href).searchParams.get("lang"), browserStorage()),
  )
  const [locale, setLocale] = useState<UiLocale>(initial.locale)
  const [persistence, setPersistence] = useState<Persistence>("saved")
  const [resetNonce, setResetNonce] = useState(0)
  useEffect(() => {
    if (initial.source === "explicit")
      setPersistence(persistenceOf(rememberLocale(browserStorage(), initial.locale)))
  }, [initial])
  useEffect(() => {
    document.documentElement.lang = locale
    document.title = translate(locale, "startup.title")
  }, [locale])
  const requestLocale = useCallback(
    (next: UiLocale) => {
      if (next === locale) return
      requestDeparture(() => {
        setLocale(next)
        setPersistence(persistenceOf(rememberLocale(browserStorage(), next)))
        const url = new URL(location.href)
        if (url.searchParams.has("lang")) {
          url.searchParams.set("lang", next)
          history.replaceState(history.state, "", url)
        }
        setResetNonce((value) => value + 1)
      })
    },
    [locale],
  )
  useEffect(() => {
    // The capture-phase departure guard suppresses blocked and reversal popstates.
    // This bubble listener accepts URL language only after that guard permits navigation.
    const acceptUrlLanguage = () => {
      const explicit = parseLocale(new URL(location.href).searchParams.get("lang"))
      if (explicit === null) return
      if (explicit !== locale) requestLocale(explicit)
      else setPersistence(persistenceOf(rememberLocale(browserStorage(), explicit)))
    }
    window.addEventListener("popstate", acceptUrlLanguage)
    return () => window.removeEventListener("popstate", acceptUrlLanguage)
  }, [locale, requestLocale])
  const t = useCallback<Translate>((key, params) => translate(locale, key, params), [locale])
  const value = useMemo<Language>(
    () => ({ locale, t, requestLocale, resetNonce, persistence }),
    [locale, t, requestLocale, resetNonce, persistence],
  )
  return <LanguageContext value={value}>{children}</LanguageContext>
}
