import {
  createContext,
  Fragment,
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { LanguageSwitch } from "../i18n/LanguageSwitch.tsx"
import { SelectedLibraryStudy, useLibraryContext } from "./client.ts"
import { LibraryDesk, LibraryRoute } from "./LibraryDesk.tsx"
import { LibraryHall } from "./LibraryHall.tsx"
import { navigateRoom } from "./navigation.ts"
import { type RoomId, roomAt, roomText } from "./room-map.ts"
import { requestDeparture, UnsavedDepartureDialog, useUnsavedEdits } from "./useUnsavedEdits.ts"

export const LibraryFrameContext = createContext(false)

export function LibraryShell({
  children,
}: {
  readonly children: () => ReactElement
}): ReactElement {
  const { locale, t, resetNonce } = useLanguage()
  useUnsavedEdits()
  const [url, setUrl] = useState(() => new URL(location.href))
  const [choice, setChoice] = useState("")
  const [selectionFailed, setSelectionFailed] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const {
    context,
    ready,
    selectStudy,
    error: loadError,
  } = useLibraryContext(`${url.href}:${refresh}`)
  const loadMessage = (() => {
    if (loadError === null) return ""
    switch (loadError.kind) {
      case "status":
        return t("library.unavailable.status", { status: loadError.status })
      case "retry":
        return t("library.unavailable.retry")
      default: {
        const unreachable: never = loadError
        throw new TypeError(`Unexpected library load error: ${String(unreachable)}`)
      }
    }
  })()
  const opener = useRef<HTMLElement | null>(null)
  const route = useRef<HTMLElement>(null)
  useEffect(() => {
    const update = () => setUrl(new URL(location.href))
    window.addEventListener("popstate", update)
    return () => window.removeEventListener("popstate", update)
  }, [])
  const persistedSelectedStudyId = context?.selectedStudyId
  useEffect(() => {
    if (persistedSelectedStudyId === undefined) return
    setChoice(persistedSelectedStudyId ?? "")
    setSelectionFailed(false)
  }, [persistedSelectedStudyId])
  const room = roomAt(url)
  const selected = context?.studies.find((study) => study.id === context.selectedStudyId) ?? null
  const pathId = url.pathname.split("/")[2]
  const linked =
    context?.studies.filter(
      (study) => study.id === pathId || study.normalizations.includes(pathId ?? ""),
    ) ?? []
  const direct = linked.length === 1 ? (linked[0] ?? null) : null
  const conflict = selected !== null && direct !== null && selected.id !== direct.id
  const routeStudy = conflict ? null : (selected ?? direct)
  const study = useMemo(
    () =>
      url.pathname.startsWith("/sources/") && pathId && routeStudy?.normalizations.includes(pathId)
        ? { ...routeStudy, normalizationId: pathId }
        : routeStudy,
    [url.pathname, pathId, routeStudy],
  )
  const onOpen = (id: RoomId) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    navigateRoom(id, study, locale)
  }
  const onHall = () => {
    navigateRoom(null, study, locale)
    requestAnimationFrame(() => {
      if (opener.current?.isConnected) opener.current.focus()
      else route.current?.querySelector<HTMLButtonElement>("button")?.focus()
    })
  }
  const Container = room ? "div" : "main"
  const Identity = room ? "p" : "h1"
  const failure = selectionFailed ? t("shell.studySelect.failed") : loadMessage
  const selection = (
    <div className="study-selection">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!choice) return
          requestDeparture(async () => {
            setBusy(true)
            setSelectionFailed(false)
            try {
              await selectStudy(choice)
              setRefresh((value) => value + 1)
            } catch (failureCause) {
              if (!(failureCause instanceof Error)) throw failureCause
              setSelectionFailed(true)
            } finally {
              setBusy(false)
            }
          })
        }}
      >
        <label htmlFor="selected-study">{t("shell.studySelect.label")}</label>
        <select
          id="selected-study"
          value={choice}
          onChange={(event) => setChoice(event.currentTarget.value)}
          disabled={busy}
        >
          <option value="">{t("shell.studySelect.placeholder")}</option>
          {context?.studies.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title} · {item.id}
            </option>
          ))}
        </select>
        <button className="btn" type="submit" disabled={busy || !choice}>
          {t("shell.studySelect.submit")}
        </button>
      </form>
      <Identity className="identity">
        {selected
          ? `${selected.title} · ${selected.id}`
          : direct
            ? t("shell.studySelect.linked", { title: direct.title, id: direct.id })
            : t("shell.studySelect.none")}
      </Identity>
      {context?.studies.length === 0 && <a href="/imports">{t("shell.studySelect.bringIn")}</a>}
      {failure && (
        <p role="alert">
          {failure}{" "}
          <button type="button" onClick={() => setRefresh((value) => value + 1)}>
            {t("shell.retry")}
          </button>
        </p>
      )}
    </div>
  )
  return (
    <Container id="library" className="library" data-mode={room ? "desk" : "hall"} tabIndex={-1}>
      <UnsavedDepartureDialog
        text={{
          title: t("departure.title"),
          body: t("departure.body"),
          stay: t("departure.stay"),
          leave: t("departure.leave"),
        }}
      />
      <a className="skip-link" href={room ? "#desk-title" : "#library"}>
        {t("shell.skipLink")}
      </a>
      <header className="hud-top">
        <a
          className="brand"
          href="/"
          onClick={(event) => {
            event.preventDefault()
            onHall()
          }}
          aria-label={t("shell.backToHall")}
        >
          <svg className="brand-mark" aria-hidden="true" viewBox="-50 -50 100 100">
            {[0, 72, 144, 216, 288].map((angle) => (
              <circle key={angle} cx="0" cy="-26" r="17" transform={`rotate(${angle})`} />
            ))}
            <circle r="4" />
          </svg>
          <span>
            TENJINSAN <small>{t("shell.tagline")}</small>
          </span>
        </a>
        <p className="where">{room ? t(roomText[room.id].name) : t("shell.where.hall")}</p>
        <LanguageSwitch />
      </header>
      <LibraryRoute room={room} onOpen={onOpen} routeRef={route} />
      <LibraryHall room={room} onOpen={onOpen} />
      {!room && selection}
      {!room && (
        <div className="hud-bottom">
          <p className="hint">{t("shell.hint")}</p>
        </div>
      )}
      {room && (
        <LibraryDesk
          room={room}
          study={study}
          onOpen={onOpen}
          onHall={onHall}
          selection={selection}
          contextReady={ready}
          nativeContent={ready && !conflict && url.pathname !== "/"}
        >
          {conflict ? (
            <div className="paper">
              <p>{t("shell.conflict.body")}</p>
              <button className="btn" type="button" onClick={() => setChoice(direct?.id ?? "")}>
                {t("shell.conflict.choose")}
              </button>
            </div>
          ) : url.pathname === "/" ? (
            <div className="paper">
              <p>{t("shell.selectPrompt")}</p>
            </div>
          ) : ready ? (
            <LibraryFrameContext value={true}>
              <SelectedLibraryStudy value={study}>
                <Fragment key={resetNonce}>{children()}</Fragment>
              </SelectedLibraryStudy>
            </LibraryFrameContext>
          ) : loadError ? (
            <p role="alert">{loadMessage}</p>
          ) : (
            <p role="status">{t("shell.checking")}</p>
          )}
        </LibraryDesk>
      )}
    </Container>
  )
}
