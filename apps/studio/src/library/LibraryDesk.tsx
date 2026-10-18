import { type ReactElement, type ReactNode, type RefObject, useLayoutEffect, useRef } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { type LibraryStudy, useRoomPrerequisite } from "./client.ts"
import { type LibraryRoom, libraryRooms, type RoomId, roomHref, roomText } from "./room-map.ts"

export function LibraryDesk({
  room,
  study,
  children,
  selection,
  onOpen,
  onHall,
  contextReady,
  nativeContent,
}: {
  readonly room: LibraryRoom
  readonly study: LibraryStudy | null
  readonly children: ReactNode
  readonly selection: ReactNode
  readonly onOpen: (id: RoomId) => void
  readonly onHall: () => void
  readonly contextReady: boolean
  readonly nativeContent: boolean
}): ReactElement {
  const { t } = useLanguage()
  const title = useRef<HTMLHeadingElement>(null)
  const pane = useRef<HTMLDivElement>(null)
  const prerequisite = useRoomPrerequisite(room.id, study)
  const focused = useRef("")
  const focusKey = `${room.id}:${study?.id ?? ""}`
  useLayoutEffect(() => {
    if (focused.current === focusKey) return
    focused.current = focusKey
    if (pane.current) pane.current.scrollTop = 0
    title.current?.focus({ preventScroll: true })
  }, [focusKey])
  const previous = libraryRooms.find((item) => item.n === room.n - 1)
  const next = libraryRooms.find((item) => item.n === room.n + 1)
  const nativeMain = prerequisite.kind === "ready" && nativeContent
  const content = () => {
    if (!contextReady) return children
    switch (prerequisite.kind) {
      case "ready":
        return children
      case "loading":
        return <p role="status">{t("desk.checkingPrereq")}</p>
      case "missing": {
        const destination = libraryRooms.find((item) => item.id === prerequisite.next)
        return (
          <section className="paper">
            <p>{t(prerequisite.message)}</p>
            <a href={roomHref(prerequisite.next, study)}>
              {destination ? t(roomText[destination.id].name) : null}
            </a>
          </section>
        )
      }
      case "unavailable":
        return (
          <section className="paper" role="alert">
            <p>{t("desk.unavailable", { status: prerequisite.status })}</p>
            <button type="button" onClick={onHall}>
              {t("desk.returnHall")}
            </button>
          </section>
        )
    }
  }
  return (
    <section
      id="desk"
      role={nativeMain ? undefined : "main"}
      className="desk is-open"
      aria-labelledby="desk-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") onHall()
      }}
    >
      <div className="desk-edge" aria-hidden="true" />
      <div id="desk-body">
        <header className="desk-head">
          <p className="room-plate">
            <span className="rn">{room.n}</span>
            <span>{t(roomText[room.id].name)}</span>
          </p>
          <h2 id="desk-title" ref={title} tabIndex={-1}>
            {t(roomText[room.id].action)}
          </h2>
          {selection}
        </header>
        <div className="desk-main" ref={pane}>
          <div className="sheet">{content()}</div>
          <aside className="note" aria-label={t("desk.marginNote")}>
            <h3>{t("desk.explicitDecisions")}</h3>
            <p>{t("desk.noSideEffects")}</p>
          </aside>
        </div>
        <footer className="desk-foot">
          <p className="status route-ref">
            {study ? `${study.title} · ${study.id}` : t("desk.selectStudy")}
          </p>
          <div className="pager">
            {previous && (
              <button className="btn btn-quiet" type="button" onClick={() => onOpen(previous.id)}>
                {t("desk.previous")}
              </button>
            )}
            {next && (
              <button className="btn btn-primary" type="button" onClick={() => onOpen(next.id)}>
                {t("desk.nextRoom")}
              </button>
            )}
            <button className="btn btn-quiet" type="button" onClick={onHall}>
              {t("desk.returnHall")}
            </button>
          </div>
        </footer>
      </div>
    </section>
  )
}

export function LibraryRoute({
  room,
  onOpen,
  routeRef,
}: {
  readonly room: LibraryRoom | null
  readonly onOpen: (id: RoomId) => void
  readonly routeRef: RefObject<HTMLElement | null>
}): ReactElement {
  const { t } = useLanguage()
  return (
    <nav id="route" className="route" ref={routeRef} aria-label={t("route.title")}>
      <p className="route-title">{t("route.title")}</p>
      <ol>
        {libraryRooms.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              aria-label={`${item.n}. ${t(roomText[item.id].name)}`}
              aria-current={room?.id === item.id ? "step" : undefined}
              onClick={() => onOpen(item.id)}
            >
              <span className="rn">{item.n}</span>
              <span className="rt">
                <b>{t(roomText[item.id].name)}</b>
                <em>{t(roomText[item.id].action)}</em>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
