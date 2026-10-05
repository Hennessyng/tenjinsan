import { createContext, type ReactElement, useEffect, useMemo, useRef, useState } from "react"
import { AuthRequired, useAuthenticationRequired } from "./AuthRequired.tsx"
import { SelectedLibraryStudy, selectLibraryStudy, useLibraryContext } from "./client.ts"
import { LibraryDesk, LibraryRoute } from "./LibraryDesk.tsx"
import { LibraryHall } from "./LibraryHall.tsx"
import { navigateRoom } from "./navigation.ts"
import { type RoomId, roomAt } from "./room-map.ts"
import { requestDeparture, UnsavedDepartureDialog, useUnsavedEdits } from "./useUnsavedEdits.ts"

export const LibraryFrameContext = createContext(false)

export function LibraryShell({
  children,
}: {
  readonly children: () => ReactElement
}): ReactElement {
  useUnsavedEdits()
  const authenticationRequired = useAuthenticationRequired()
  const [url, setUrl] = useState(() => new URL(location.href))
  const [choice, setChoice] = useState("")
  const [error, setError] = useState("")
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const {
    context,
    ready,
    error: loadError,
  } = useLibraryContext(`${url.href}:${refresh}`, !authenticationRequired)
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
    setError("")
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
    navigateRoom(id, study)
  }
  const onHall = () => {
    navigateRoom(null, study)
    requestAnimationFrame(() => {
      if (opener.current?.isConnected) opener.current.focus()
      else route.current?.querySelector<HTMLButtonElement>("button")?.focus()
    })
  }
  if (authenticationRequired) return <AuthRequired />
  const Container = room ? "div" : "main"
  const Identity = room ? "p" : "h1"
  const selection = (
    <div className="study-selection">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!choice) return
          requestDeparture(async () => {
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
          })
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
      <Identity className="identity">
        {selected
          ? `${selected.title} · ${selected.id}`
          : direct
            ? `Inspecting linked study: ${direct.title} · ${direct.id}`
            : "No selected study / 読書は未選択です"}
      </Identity>
      {context?.studies.length === 0 && <a href="/imports">Bring a book in / 本を受け入れる</a>}
      {(error || loadError) && (
        <p role="alert">
          {error || loadError}{" "}
          <button type="button" onClick={() => setRefresh((value) => value + 1)}>
            Retry / 再試行
          </button>
        </p>
      )}
    </div>
  )
  return (
    <Container id="library" className="library" data-mode={room ? "desk" : "hall"} tabIndex={-1}>
      <UnsavedDepartureDialog />
      <a className="skip-link" href={room ? "#desk-title" : "#library"}>
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
      <LibraryRoute room={room} onOpen={onOpen} routeRef={route} />
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
          contextReady={ready}
          nativeContent={ready && !conflict && url.pathname !== "/"}
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
          ) : ready ? (
            <LibraryFrameContext value={true}>
              <SelectedLibraryStudy value={study}>{children()}</SelectedLibraryStudy>
            </LibraryFrameContext>
          ) : loadError ? (
            <p role="alert">{loadError}</p>
          ) : (
            <p role="status">Checking the current room context / 現在の読書を確認しています</p>
          )}
        </LibraryDesk>
      )}
    </Container>
  )
}
