import { type ReactElement, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { buildHall, hallCamera } from "./art/hall.ts"
import { type LibraryRoom, libraryRooms, type RoomId, roomText } from "./room-map.ts"

export function LibraryHall({
  room,
  onOpen,
}: {
  readonly room: LibraryRoom | null
  readonly onOpen: (id: RoomId) => void
}): ReactElement {
  const { t } = useLanguage()
  const stage = useRef<HTMLDivElement>(null)
  const world = useRef<HTMLDivElement>(null)
  const camera = useRef<HTMLDivElement>(null)
  const controller = useRef<ReturnType<typeof hallCamera> | null>(null)
  const [stations, setStations] = useState<ReadonlyMap<RoomId, HTMLElement>>(new Map())
  useLayoutEffect(() => {
    if (!stage.current || !world.current || !camera.current) return
    setStations(buildHall(world.current))
    controller.current = hallCamera({
      stage: stage.current,
      world: world.current,
      camera: camera.current,
    })
    return () => {
      controller.current?.stop()
      controller.current = null
    }
  }, [])
  useLayoutEffect(() => {
    controller.current?.focus(room)
  }, [room])
  return (
    <div className="stage" ref={stage} inert={room !== null}>
      <div className="camera" ref={camera}>
        <div className="stage3d">
          <div className="world" ref={world} />
        </div>
      </div>
      {libraryRooms.map((item) => {
        const target = stations.get(item.id)
        if (!target) return null
        return createPortal(
          <button
            className="pin"
            type="button"
            aria-label={`${item.n}. ${t(roomText[item.id].name)}. ${t(roomText[item.id].action)}.`}
            ref={(node) => {
              node?.style.setProperty("--ph", String(item.h))
            }}
            onClick={() => onOpen(item.id)}
          >
            <span className="pin-n">{item.n}</span>
            <span className="pin-t">
              <b>{t(roomText[item.id].name)}</b>
              <em>{t("hall.inspect")}</em>
            </span>
          </button>,
          target,
          item.id,
        )
      })}
    </div>
  )
}
