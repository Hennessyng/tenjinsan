import { gateArtwork, gateCrest } from "../gate-artwork.ts"
import { type LibraryRoom, libraryRooms, type RoomId } from "../room-map.ts"
import { box, element, flat, shelves } from "./boxes.ts"
import { furnitureA } from "./furniture-a.ts"
import { furnitureB } from "./furniture-b.ts"

export function buildHall(world: HTMLElement): ReadonlyMap<RoomId, HTMLElement> {
  world.replaceChildren()
  const symbols = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  symbols.setAttribute("width", "0")
  symbols.setAttribute("height", "0")
  symbols.setAttribute("aria-hidden", "true")
  const ox = gateArtwork.match(/<symbol id="ox"[\s\S]*?<\/symbol>/)?.[0]
  if (!ox) throw new TypeError("Copied reference ox artwork is missing")
  symbols.innerHTML = `<defs>${gateCrest.replace('id="crest"', 'id="hall-crest"')}${ox.replace('id="ox"', 'id="hall-ox"')}</defs>`
  world.append(symbols)
  const floor = element("div", "floor")
  floor.append(
    element("i", "slab-s"),
    element("i", "slab-e"),
    flat({ cls: "doormat", x: 660, y: 700, w: 120, d: 90 }),
  )
  const runner = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  runner.setAttribute("class", "runner")
  runner.setAttribute("viewBox", "0 0 800 800")
  runner.setAttribute("aria-hidden", "true")
  const points = libraryRooms.map((room) => [room.x + room.w / 2, room.y + room.d / 2] as const)
  const first = points[0]
  if (!first) throw new TypeError("Copied room route has no first point")
  let pathData = `M${first[0]} ${first[1]}`
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]
    const next = points[index]
    if (!previous || !next) continue
    const middle = (previous[1] + next[1]) / 2
    pathData += ` C${previous[0]} ${middle} ${next[0]} ${middle} ${next[0]} ${next[1]}`
  }
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
  path.setAttribute("d", pathData)
  runner.append(path)
  floor.append(runner)
  world.append(floor)
  const sacredOx = element("div", "hall-ox")
  sacredOx.setAttribute("aria-hidden", "true")
  sacredOx.innerHTML =
    '<svg viewBox="0 0 120 72" aria-hidden="true"><use href="#hall-ox" width="120" height="72"/></svg>'
  world.append(
    box({ x: 536, y: 722, w: 96, d: 48, h: 24, c: "var(--shrine-stone-deep)" }),
    box({ x: 532, y: 718, z: 24, w: 104, d: 56, h: 4, c: "var(--shrine-stone)" }),
    sacredOx,
  )
  const left = element("div")
  left.style.cssText = "position:relative;width:100%;height:100%"
  left.append(shelves({ rows: 5, width: 776, rowH: 58, seed: 7 }))
  const ladder = element("i", "ladder")
  ladder.style.left = "330px"
  left.append(ladder)
  const right = element("div", "wall-r")
  right.append(element("i", "ledge"), element("i", "wain"))
  for (const position of [120, 360, 600, 740]) {
    const arch = element("i", "arch")
    arch.style.left = `${800 - position - 46}px`
    right.append(arch)
  }
  for (const position of [278, 518, 572]) {
    const ema = element("div", "ema")
    ema.style.left = `${position}px`
    ema.setAttribute("aria-hidden", "true")
    ema.innerHTML =
      '<svg viewBox="0 0 48 56"><path d="M2 16 L24 3 L46 16 V53 H2 Z" fill="var(--lib-oak)" stroke="var(--lib-brass)" stroke-width="2"/><circle cx="24" cy="12" r="2" fill="var(--shrine-wood)"/><use href="#hall-crest" x="10" y="22" width="28" height="28" fill="none" stroke="var(--shrine-wood)" stroke-width="4"/></svg>'
    right.append(ema)
  }
  world.append(
    box({ x: -14, y: 0, w: 14, d: 800, h: 300, c: "var(--lib-wall)", east: left }),
    box({ x: 0, y: -14, w: 800, d: 14, h: 300, c: "var(--lib-wall)", south: right }),
  )
  const stations = new Map<RoomId, HTMLElement>()
  for (const room of libraryRooms) {
    const station = element("div", "station")
    station.dataset["room"] = room.id
    for (const key of ["x", "y", "w", "d"] as const)
      station.style.setProperty(`--${key}`, String(room[key]))
    station.append(
      element("i", "ring"),
      flat({ cls: "shadow", x: 8, y: 8, w: room.w + 8, d: room.d + 8 }),
    )
    const parts = element("div", "parts")
    switch (room.id) {
      case "accession":
        furnitureA.accession(parts)
        break
      case "lending":
        furnitureA.lending(parts)
        break
      case "reference":
        furnitureA.reference(parts)
        break
      case "reading":
        furnitureA.reading(parts)
        break
      case "catalogue":
        furnitureB.catalogue(parts)
        break
      case "bindery":
        furnitureB.bindery(parts)
        break
      case "review":
        furnitureB.review(parts)
        break
      case "ledger":
        furnitureB.ledger(parts)
        break
      case "display":
        furnitureB.display(parts)
        break
    }
    parts.setAttribute("aria-hidden", "true")
    station.append(parts)
    world.append(station)
    stations.set(room.id, station)
  }
  return stations
}

type Pose = { rx: number; rz: number; scale: number; tx: number; ty: number }

function project(point: readonly [number, number, number], pose: Pose): readonly [number, number] {
  const azimuth = (pose.rz * Math.PI) / 180
  const tilt = (pose.rx * Math.PI) / 180
  const horizontal = point[0] - 400
  const vertical = point[1] - 400
  const rotatedX = horizontal * Math.cos(azimuth) - vertical * Math.sin(azimuth)
  const rotatedY = horizontal * Math.sin(azimuth) + vertical * Math.cos(azimuth)
  const projectedY = rotatedY * Math.cos(tilt) - point[2] * Math.sin(tilt)
  const projectedZ = rotatedY * Math.sin(tilt) + point[2] * Math.cos(tilt)
  const perspective = 2600 / (2600 - projectedZ)
  return [innerWidth / 2 + rotatedX * perspective, innerHeight / 2 + projectedY * perspective]
}

function targetPose(room: LibraryRoom | null): Pose {
  const pose: Pose = { rx: 60, rz: 45, scale: 1, tx: 0, ty: 0 }
  const width = innerWidth
  const height = innerHeight
  const area =
    width < 960
      ? room
        ? { left: 8, top: 62, right: width - 8, bottom: height * 0.38 - 4 }
        : { left: 8, top: 64, right: width - 8, bottom: height - 76 }
      : room
        ? {
            left: 72,
            top: 64,
            right: width - Math.min(780, width * 0.56) - 12,
            bottom: height - 16,
          }
        : { left: 288, top: 64, right: width - 12, bottom: height - 16 }
  if (room) {
    const [horizontal, vertical] = project(
      [room.x + room.w / 2, room.y + room.d / 2, room.h * 0.4],
      pose,
    )
    const size = Math.max(room.w, room.d) * 0.9 + room.h * 0.6
    pose.scale = Math.max(
      0.9,
      Math.min(2.1, (Math.min(area.right - area.left, area.bottom - area.top) * 0.64) / size),
    )
    pose.tx = (area.left + area.right) / 2 - pose.scale * horizontal
    pose.ty = (area.top + area.bottom) / 2 - pose.scale * vertical
    return pose
  }
  const corners: readonly (readonly [number, number, number])[] = [
    [0, 0, 0],
    [800, 0, 0],
    [0, 800, 0],
    [800, 800, 0],
    [0, 0, 300],
    [800, 0, 300],
    [0, 800, 300],
    [800, 800, -26],
  ]
  const points = corners.map((point) => project(point, pose))
  const horizontal = points.map((point) => point[0])
  const vertical = points.map((point) => point[1])
  pose.scale =
    Math.min(
      (area.right - area.left) / (Math.max(...horizontal) - Math.min(...horizontal)),
      (area.bottom - area.top) / (Math.max(...vertical) - Math.min(...vertical)),
    ) * (width < 700 ? 1.3 : 0.97)
  pose.tx =
    (area.left + area.right) / 2 -
    (pose.scale * (Math.max(...horizontal) + Math.min(...horizontal))) / 2
  pose.ty =
    (area.top + area.bottom) / 2 -
    (pose.scale * (Math.max(...vertical) + Math.min(...vertical))) / 2
  return pose
}

export function hallCamera(elements: {
  readonly world: HTMLElement
  readonly camera: HTMLElement
  readonly stage: HTMLElement
}): { focus: (room: LibraryRoom | null) => void; stop: () => void } {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)")
  let room: LibraryRoom | null = null
  const current = targetPose(null)
  let target = targetPose(null)
  let frame = 0
  let last = 0
  let pointerX = 0
  let pointerY = 0
  let smoothX = 0
  let smoothY = 0
  const apply = () => {
    elements.world.style.setProperty("--rx", `${current.rx}deg`)
    elements.world.style.setProperty("--rz", `${current.rz}deg`)
    elements.camera.style.transform = `translate(${current.tx}px, ${current.ty}px) scale(${current.scale})`
  }
  const tick = (now: number) => {
    frame = 0
    if (document.hidden) return
    const interval = Math.min(0.05, (now - last) / 1000 || 0.016)
    last = now
    const easing = reduce.matches ? 1 : 1 - Math.exp(-interval * 4.4)
    const pointerEasing = reduce.matches ? 1 : 1 - Math.exp(-interval * 6)
    smoothX += (pointerX - smoothX) * pointerEasing
    smoothY += (pointerY - smoothY) * pointerEasing
    const goal = {
      ...target,
      rx: target.rx - (!room && !reduce.matches ? smoothY * 2.4 : 0),
      rz: target.rz + (!room && !reduce.matches ? smoothX * 5 : 0),
    }
    let moving = false
    for (const key of ["rx", "rz", "scale", "tx", "ty"] as const) {
      const difference = goal[key] - current[key]
      if (Math.abs(difference) > (key === "scale" ? 0.0005 : 0.02)) {
        current[key] += difference * easing
        moving = true
      } else current[key] = goal[key]
    }
    apply()
    if (moving || Math.abs(pointerX - smoothX) > 0.001 || Math.abs(pointerY - smoothY) > 0.001)
      frame = requestAnimationFrame(tick)
  }
  const wake = () => {
    if (!frame) frame = requestAnimationFrame(tick)
  }
  const resize = () => {
    target = targetPose(room)
    wake()
  }
  const pointer = (event: PointerEvent) => {
    if (room || reduce.matches) return
    pointerX = Math.max(-1, Math.min(1, (event.clientX / innerWidth - 0.5) * 2))
    pointerY = Math.max(-1, Math.min(1, (event.clientY / innerHeight - 0.5) * 2))
    wake()
  }
  const leave = () => {
    pointerX = 0
    pointerY = 0
    wake()
  }
  const visibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(frame)
      frame = 0
    } else resize()
  }
  elements.stage.addEventListener("pointermove", pointer)
  elements.stage.addEventListener("pointerleave", leave)
  window.addEventListener("resize", resize)
  document.addEventListener("visibilitychange", visibility)
  reduce.addEventListener("change", resize)
  apply()
  return {
    focus(next) {
      room = next
      target = targetPose(next)
      pointerX = 0
      pointerY = 0
      wake()
    },
    stop() {
      cancelAnimationFrame(frame)
      elements.stage.removeEventListener("pointermove", pointer)
      elements.stage.removeEventListener("pointerleave", leave)
      window.removeEventListener("resize", resize)
      document.removeEventListener("visibilitychange", visibility)
      reduce.removeEventListener("change", resize)
    },
  }
}
