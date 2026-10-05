import { type ReactElement, type ReactNode, type RefObject, useLayoutEffect, useRef } from "react"
import { type LibraryStudy, useRoomPrerequisite } from "./client.ts"
import { type LibraryRoom, libraryRooms, type RoomId, roomHref } from "./room-map.ts"

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
  const title = useRef<HTMLHeadingElement>(null)
  const prerequisite = useRoomPrerequisite(room.id, study)
  const focused = useRef("")
  const focusKey = `${room.id}:${study?.id ?? ""}`
  useLayoutEffect(() => {
    if (focused.current === focusKey) return
    focused.current = focusKey
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
        return <p role="status">Checking room prerequisites / 部屋の準備を確認しています</p>
      case "missing": {
        const destination = libraryRooms.find((item) => item.id === prerequisite.next)
        return (
          <section className="paper">
            <p>{prerequisite.en}</p>
            <p lang="ja">{prerequisite.ja}</p>
            <a href={roomHref(prerequisite.next, study)}>
              {destination?.en} / {destination?.ja}
            </a>
          </section>
        )
      }
      case "unavailable":
        return (
          <section className="paper" role="alert">
            <p>
              Room unavailable ({prerequisite.status}). Please return to the hall and try again.
            </p>
            <p lang="ja">広間に戻り、もう一度お試しください。</p>
            <button type="button" onClick={onHall}>
              Return to hall / 広間に戻る
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
            <span>{room.en}</span>
            <span lang="ja">{room.ja}</span>
          </p>
          <h2 id="desk-title" ref={title} tabIndex={-1}>
            {room.doEn}
            <span lang="ja">{room.doJa}</span>
          </h2>
          {selection}
        </header>
        <div className="desk-main">
          <div className="sheet">{content()}</div>
          <aside className="note" aria-label="Margin note / 余白のメモ">
            <h3>Explicit decisions</h3>
            <p>Opening a room does not save, send, approve or generate anything.</p>
            <p lang="ja">部屋を開いても、保存・送信・承認・生成は行われません。</p>
          </aside>
        </div>
        <footer className="desk-foot">
          <p className="status route-ref">
            {study ? `${study.title} · ${study.id}` : "Select a study / 読書を選んでください"}
          </p>
          <div className="pager">
            {previous && (
              <button className="btn btn-quiet" type="button" onClick={() => onOpen(previous.id)}>
                Previous <span lang="ja">前へ</span>
              </button>
            )}
            {next && (
              <button className="btn btn-primary" type="button" onClick={() => onOpen(next.id)}>
                Next room <span lang="ja">次の部屋へ</span>
              </button>
            )}
            <button className="btn btn-quiet" type="button" onClick={onHall}>
              Return to hall / 広間に戻る
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
  return (
    <nav id="route" className="route" ref={routeRef} aria-label="Reading route / 読書ルート">
      <p className="route-title">
        Reading route <span lang="ja">読書ルート</span>
      </p>
      <ol>
        {libraryRooms.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              aria-label={`${item.n}. ${item.en} / ${item.ja}`}
              aria-current={room?.id === item.id ? "step" : undefined}
              onClick={() => onOpen(item.id)}
            >
              <span className="rn">{item.n}</span>
              <span className="rt">
                <b>{item.en}</b>
                <small lang="ja">{item.ja}</small>
                <em>{item.doEn}</em>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
