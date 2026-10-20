import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { adoptLibraryContext, readLibraryContext, selectLibraryStudy } from "./client.ts"
import { commitRoomNavigation, requestDeparture } from "./useUnsavedEdits.ts"

let active: AbortController | null = null

export function ReadSourceLink({
  revision,
  children,
}: {
  readonly revision: string
  readonly children: ReactNode
}): ReactElement {
  const { locale, t } = useLanguage()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const operation = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      operation.current?.abort()
    }
  }, [])
  const href = `/sources/${encodeURIComponent(revision)}`
  async function open(): Promise<void> {
    if (active || !mounted.current) return
    const controller = new AbortController()
    active = controller
    operation.current = controller
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])
    setBusy(true)
    setFailed(false)
    try {
      const context = await readLibraryContext(signal)
      if (signal.aborted) return
      const matches = context.studies.filter((study) => study.normalizations.includes(revision))
      const target =
        matches.find((study) => study.id === context.selectedStudyId) ??
        matches.reduce<(typeof matches)[number] | undefined>(
          (first, study) => (!first || study.id < first.id ? study : first),
          undefined,
        )
      if (!target) {
        setFailed(true)
        return
      }
      if (context.selectedStudyId !== target.id) {
        if (
          context.selectedStudyId &&
          !window.confirm(t("bookRoom.switchConfirm", { title: target.title, id: target.id }))
        )
          return
        const selection = await selectLibraryStudy(target.id, signal)
        if (signal.aborted) return
        if (selection.selectedStudyId !== target.id) {
          setFailed(true)
          return
        }
      }
      if (signal.aborted) return
      adoptLibraryContext({ ...context, selectedStudyId: target.id })
      const url = new URL(href, location.href)
      if (new URL(location.href).searchParams.has("lang")) url.searchParams.set("lang", locale)
      commitRoomNavigation(url)
    } catch (failure) {
      if (!(failure instanceof Error)) throw failure
      if (!controller.signal.aborted) setFailed(true)
    } finally {
      if (active === controller) active = null
      if (!controller.signal.aborted) setBusy(false)
      operation.current = null
    }
  }
  return (
    <>
      <a
        href={href}
        data-source-open
        aria-disabled={busy || undefined}
        onClick={(event) => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return
          event.preventDefault()
          if (!busy)
            requestDeparture(() => {
              void open()
            })
        }}
      >
        {children}
      </a>
      {busy && <span role="status"> {t("bookRoom.opening")}</span>}
      {failed && <span role="alert"> {t("bookRoom.openFailed")}</span>}
    </>
  )
}
