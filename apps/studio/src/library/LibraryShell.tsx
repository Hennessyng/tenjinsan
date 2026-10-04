import { type ReactElement, useEffect, useRef, useState } from "react"
import { SourceRequestError } from "../source-viewer/client.ts"
import { type LibraryContext, readLibraryContext, selectLibraryStudy } from "./client.ts"
import { LibraryDesk } from "./LibraryDesk.tsx"
import { LibraryHall } from "./LibraryHall.tsx"
import { navigateRoom } from "./navigation.ts"
import { libraryRooms, type RoomId, roomAt } from "./room-map.ts"

export function LibraryShell({
  children,
}: {
  readonly children: () => ReactElement
}): ReactElement {
  const [url, setUrl] = useState(() => new URL(location.href))
  const [context, setContext] = useState<LibraryContext | null>(null)
  const [choice, setChoice] = useState("")
  const [error, setError] = useState("")
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  const route = useRef<HTMLElement>(null)
  const contextRequest = useRef("")
  useEffect(() => {
    const update = () => setUrl(new URL(location.href))
    window.addEventListener("popstate", update)
    return () => window.removeEventListener("popstate", update)
  }, [])
  useEffect(() => {
    const abort = new AbortController()
    const generation = `${url.href}:${refresh}`
    contextRequest.current = generation
    setError("")
    readLibraryContext(abort.signal)
      .then((value) => {
        if (abort.signal.aborted || contextRequest.current !== generation) return
        setContext(value)
        setChoice(value.selectedStudyId ?? "")
      })
      .catch((failure: unknown) => {
        if (abort.signal.aborted) return
        if (!(failure instanceof Error)) throw failure
        setError(
          failure instanceof SourceRequestError
            ? `Library unavailable (${failure.status}). / 図書室を読み込めません。`
            : "Library unavailable. Please retry. / もう一度お試しください。",
        )
      })
    return () => abort.abort()
  }, [url.href, refresh])
  const room = roomAt(url)
  const selected = context?.studies.find((study) => study.id === context.selectedStudyId) ?? null
  const pathId = url.pathname.split("/")[2]
  const linked =
    context?.studies.filter(
      (study) => study.id === pathId || study.normalizations.includes(pathId ?? ""),
    ) ?? []
  const direct = linked.length === 1 ? (linked[0] ?? null) : null
  const conflict = selected !== null && direct !== null && selected.id !== direct.id
  const study = conflict ? null : (selected ?? direct)
  const onOpen = (id: RoomId) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    navigateRoom(id, study)
  }
  const onHall = () => {
    navigateRoom(null, study)
    requestAnimationFrame(() => {
      if (opener.current?.isConnected) opener.current.focus()
      else route.current?.querySelector<HTMLButtonElement>("button")?.focus()
    })
  }
  const selection = (
    <div className="study-selection">
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          if (!choice) return
          setBusy(true)
          setError("")
          try {
            await selectLibraryStudy(choice)
            setRefresh((value) => value + 1)
          } catch (failure) {
            if (!(failure instanceof Error)) throw failure
            setError("Study selection failed. Please retry. / 読書を選択できませんでした。")
          } finally {
            setBusy(false)
          }
        }}
      >
        <label htmlFor="selected-study">Selected study / 選択した読書</label>
        <select
          id="selected-study"
          value={choice}
          onChange={(event) => setChoice(event.currentTarget.value)}
          disabled={busy}
        >
          <option value="">Choose a study / 読書を選んでください</option>
          {context?.studies.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title} · {item.id}
            </option>
          ))}
        </select>
        <button className="btn" type="submit" disabled={busy || !choice}>
          Select study / 読書を選ぶ
        </button>
      </form>
      <p className="identity">
        {selected
          ? `${selected.title} · ${selected.id}`
          : direct
            ? `Inspecting linked study: ${direct.title} · ${direct.id}`
            : "No selected study / 読書は未選択です"}
      </p>
      {context?.studies.length === 0 && <a href="/imports">Bring a book in / 本を受け入れる</a>}
      {error && (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={() => setRefresh((value) => value + 1)}>
            Retry / 再試行
          </button>
        </p>
      )}
    </div>
  )
  return (
    <div id="library" className="library" data-mode={room ? "desk" : "hall"}>
      <a className="skip-link" href={room ? "#desk-title" : "#route"}>
        Skip to the reading route / 読書ルートへ
      </a>
      <header className="hud-top">
        <a
          className="brand"
          href="/"
          onClick={(event) => {
            event.preventDefault()
            onHall()
          }}
          aria-label="Back to the hall / ホールへ戻る"
        >
          <svg className="brand-mark" aria-hidden="true" viewBox="-50 -50 100 100">
            {[0, 72, 144, 216, 288].map((angle) => (
              <circle key={angle} cx="0" cy="-26" r="17" transform={`rotate(${angle})`} />
            ))}
            <circle r="4" />
          </svg>
          <span>
            TENJINSAN <small lang="ja">問いからひらく読書</small>
          </span>
        </a>
        <p className="where">{room ? room.en : "Library hall / 図書室の広間"}</p>
        <div className="hud-actions">
          <button
            className="btn btn-quiet"
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError("")
              try {
                const response = await fetch("/api/auth/sign-out", {
                  method: "POST",
                  credentials: "same-origin",
                  headers: { "Content-Type": "application/json" },
                  body: "{}",
                })
                if (!response.ok) {
                  setError("Log out failed. Please try again. / ログアウトに失敗しました。")
                  return
                }
                document.cookie = `tj_entry=; Path=/; Max-Age=0; SameSite=Strict${location.protocol === "https:" ? "; Secure" : ""}`
                location.assign("/login")
              } catch (failure) {
                if (!(failure instanceof TypeError)) throw failure
                setError("Could not connect. Please retry. / 接続できませんでした。")
              } finally {
                setBusy(false)
              }
            }}
          >
            Log out
          </button>
        </div>
      </header>
      <nav id="route" className="route" ref={route} aria-label="Reading route / 読書ルート">
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
      <LibraryHall room={room} onOpen={onOpen} />
      {!room && selection}
      {!room && (
        <div className="hud-bottom">
          <p className="hint">
            Move the pointer to look around. Choose a desk to sit down.
            <span lang="ja">ポインタで見回し、机を選んで席に着きます。</span>
          </p>
        </div>
      )}
      {room && (
        <LibraryDesk
          room={room}
          study={study}
          onOpen={onOpen}
          onHall={onHall}
          selection={selection}
        >
          {conflict ? (
            <div className="paper">
              <p>
                The link and selected study differ. Choose the linked study explicitly before
                continuing. / リンクと選択した読書が異なります。
              </p>
              <button className="btn" type="button" onClick={() => setChoice(direct?.id ?? "")}>
                Choose linked study / リンク先の読書を選ぶ
              </button>
            </div>
          ) : url.pathname === "/" ? (
            <div className="paper">
              <p>
                Select a study to continue in this room. /
                この部屋で進めるには読書を選んでください。
              </p>
            </div>
          ) : (
            children()
          )}
        </LibraryDesk>
      )}
    </div>
  )
}
