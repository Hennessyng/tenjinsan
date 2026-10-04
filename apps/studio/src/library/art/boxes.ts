export type Cuboid = {
  readonly x?: number
  readonly y?: number
  readonly z?: number
  readonly w: number
  readonly d: number
  readonly h: number
  readonly c?: string
  readonly rot?: number
  readonly tilt?: number
  readonly glass?: boolean
  readonly cls?: string
  readonly east?: Node
  readonly south?: Node
  readonly top?: Node
}

export function element(tag: "div" | "i" | "span", cls = ""): HTMLElement {
  const result = document.createElement(tag)
  result.className = cls
  return result
}

export function randomSource(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

export function box(shape: Cuboid): HTMLElement {
  const result = element(
    "div",
    `box${shape.glass ? " glass" : ""}${shape.cls ? ` ${shape.cls}` : ""}`,
  )
  for (const key of ["x", "y", "z", "w", "d", "h"] as const) {
    result.style.setProperty(`--${key}`, String(shape[key] ?? 0))
  }
  result.style.setProperty("--c", shape.c ?? "var(--lib-oak)")
  if (shape.rot !== undefined) result.style.setProperty("--rot", `${shape.rot}deg`)
  if (shape.tilt !== undefined) result.style.setProperty("--tilt", `${shape.tilt}deg`)
  const faces = {
    top: element("i", "f top"),
    south: element("i", "f south"),
    east: element("i", "f east"),
  }
  result.append(faces.top, faces.south, faces.east)
  if (shape.glass) result.append(element("i", "f north"), element("i", "f west"))
  if (shape.east) {
    const wrap = element("div", "fc-east")
    wrap.append(shape.east)
    faces.east.append(wrap)
  }
  if (shape.south) {
    const wrap = element("div", "fc-south")
    wrap.append(shape.south)
    faces.south.append(wrap)
  }
  if (shape.top) faces.top.append(shape.top)
  return result
}

export function shelves(layout: {
  readonly rows: number
  readonly width: number
  readonly rowH: number
  readonly seed: number
}): HTMLElement {
  const colors = [
    "#27634f",
    "#d88869",
    "#f5f1e9",
    "#d6e7b8",
    "#8a3d27",
    "#b08358",
    "#3f7f68",
    "#e7c9a0",
    "#c9a45c",
    "#4b6f8a",
  ]
  const random = randomSource(layout.seed)
  const wrap = element("div", "shelves")
  for (let rowIndex = 0; rowIndex < layout.rows; rowIndex++) {
    const row = element("div", "shelf")
    row.style.height = `${layout.rowH}px`
    let used = 0
    while (used < layout.width) {
      const width = 8 + Math.floor(random() * 11)
      const height = Math.floor((layout.rowH - 10) * (0.62 + random() * 0.34))
      const spine = element("i", "spine")
      spine.style.setProperty("--sw", String(width))
      spine.style.setProperty("--sh", String(height))
      spine.style.setProperty("--sc", `${colors[Math.floor(random() * colors.length)]}`)
      row.append(spine)
      used += width
    }
    wrap.append(row)
  }
  return wrap
}

export function flat(shape: {
  readonly cls: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly d: number
}): HTMLElement {
  const result = element("div", `flat ${shape.cls}`)
  result.style.left = `${shape.x}px`
  result.style.top = `${shape.y}px`
  result.style.width = `${shape.w}px`
  result.style.height = `${shape.d}px`
  return result
}
