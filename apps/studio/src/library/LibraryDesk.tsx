import { type ReactElement, type ReactNode, useLayoutEffect, useRef } from "react"
import type { LibraryStudy } from "./client.ts"
import { type LibraryRoom, libraryRooms, type RoomId } from "./room-map.ts"

export function LibraryDesk({
  room,
  study,
  children,
  selection,
  onOpen,
  onHall,
}: {
  readonly room: LibraryRoom
  readonly study: LibraryStudy | null
  readonly children: ReactNode
  readonly selection: ReactNode
  readonly onOpen: (id: RoomId) => void
  readonly onHall: () => void
}): ReactElement {
  const title = useRef<HTMLHeadingElement>(null)
  const focused = useRef("")
  const focusKey = `${room.id}:${study?.id ?? ""}`
  useLayoutEffect(() => {
    if (focused.current === focusKey) return
    focused.current = focusKey
    title.current?.focus({ preventScroll: true })
  }, [focusKey])
  const previous = libraryRooms.find((item) => item.n === room.n - 1)
  const next = libraryRooms.find((item) => item.n === room.n + 1)
  return (
    <section
      id="desk"
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
          <div className="sheet">{children}</div>
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
