// Furniture for rooms 01-05. Coordinates are relative to the room's footprint corner.
;(() => {
  window.TJ = window.TJ || {}
  const TJ = window.TJ
  TJ.furniture = TJ.furniture || {}
  const B = TJ.box
  const OAK = "var(--lib-oak)"
  const DARK = "var(--lib-oak-dark)"
  const GREEN = "var(--color-green)"
  const CORAL = "var(--color-coral)"
  const INK = "var(--color-ink)"
  const BRASS = "var(--lib-brass)"
  const PAPER = "var(--color-paper-raised)"

  const lamp = (parts, x, y, z, glowAt) => {
    parts.append(
      B({ x, y, z, w: 14, d: 14, h: 3, c: INK }),
      B({ x: x + 5, y: y + 5, z: z + 3, w: 4, d: 4, h: 28, c: INK }),
      B({ x: x - 3, y: y - 3, z: z + 30, w: 20, d: 20, h: 9, c: GREEN }),
    )
    if (glowAt) parts.append(TJ.flat("glow", glowAt[0], glowAt[1], 90, 90))
  }

  TJ.furniture.accession = (parts) => {
    parts.append(
      B({ w: 190, d: 74, h: 58, c: DARK }),
      B({ x: -6, y: -6, z: 58, w: 202, d: 86, h: 6, c: OAK }),
      B({ x: 24, y: 18, z: 64, w: 44, d: 32, h: 9, c: GREEN, rot: -6 }),
      B({ x: 28, y: 20, z: 73, w: 40, d: 28, h: 8, c: CORAL, rot: 4 }),
      B({ x: 26, y: 19, z: 81, w: 42, d: 30, h: 8, c: PAPER, rot: -2 }),
      B({ x: 100, y: 26, z: 64, w: 26, d: 20, h: 5, c: INK }),
      B({ x: 110, y: 32, z: 69, w: 8, d: 8, h: 14, c: BRASS }),
      B({ x: 142, y: 16, z: 64, w: 34, d: 42, h: 4, c: PAPER, rot: 3 }),
    )
  }

  TJ.furniture.stacks = (parts, r) => {
    const mk = (x, seed) =>
      B({
        x,
        w: 64,
        d: r.d,
        h: 190,
        c: DARK,
        east: TJ.shelves({ rows: 4, width: r.d - 24, rowH: 46, seed }),
      })
    parts.append(mk(0, 11), mk(100, 12))
    parts.append(
      B({ x: 66, y: 120, w: 30, d: 30, h: 26, c: GREEN }),
      B({ x: 64, y: 118, z: 26, w: 34, d: 34, h: 4, c: CORAL }),
    )
  }

  TJ.furniture.lending = (parts) => {
    parts.append(
      B({ w: 170, d: 70, h: 56, c: DARK }),
      B({ x: -5, y: -5, z: 56, w: 180, d: 80, h: 6, c: OAK }),
      B({ x: 56, y: 2, z: 62, w: 58, d: 4, h: 30, c: BRASS }),
      B({ x: 20, y: 22, z: 62, w: 42, d: 30, h: 1.5, c: PAPER, rot: -8 }),
      B({ x: 28, y: 30, z: 63.5, w: 42, d: 30, h: 1.5, c: PAPER, rot: 5 }),
      B({ x: 100, y: 30, z: 62, w: 14, d: 14, h: 6, c: CORAL }),
      B({ x: 128, y: 28, z: 62, w: 16, d: 16, h: 8, c: BRASS }),
      B({ x: 132, y: 32, z: 70, w: 8, d: 8, h: 5, c: BRASS }),
    )
  }

  TJ.furniture.reference = (parts) => {
    const q = TJ.el("span", "", "?")
    q.style.cssText =
      "display:grid;place-items:center;width:100%;height:100%;font:700 34px var(--font-display-en);color:#d88869"
    parts.append(
      B({ w: 130, d: 78, h: 50, c: DARK }),
      B({ x: -4, y: -4, z: 50, w: 138, d: 86, h: 6, c: OAK }),
      B({ x: 20, y: 98, w: 30, d: 30, h: 34, c: GREEN }),
      B({ x: 18, y: 96, z: 34, w: 34, d: 34, h: 5, c: CORAL }),
      B({ x: 80, y: 98, w: 30, d: 30, h: 34, c: GREEN }),
      B({ x: 78, y: 96, z: 34, w: 34, d: 34, h: 5, c: CORAL }),
      B({ x: 62, y: 20, z: 56, w: 50, d: 36, h: 1.5, c: PAPER, rot: -4, top: q }),
    )
    lamp(parts, 14, 14, 56, [-12, -12])
  }

  TJ.furniture.reading = (parts) => {
    parts.append(
      B({ x: 20, y: 14, w: 150, d: 82, h: 48, c: DARK }),
      B({ w: 190, d: 110, z: 48, h: 8, c: OAK }),
      B({ x: 56, y: 26, z: 56, w: 70, d: 48, h: 3, c: CORAL, rot: -4 }),
      B({ x: 58, y: 28, z: 59, w: 30, d: 44, h: 2, c: PAPER, rot: -6 }),
      B({ x: 92, y: 28, z: 59, w: 30, d: 44, h: 2, c: PAPER, rot: -2 }),
      B({ x: 40, y: 122, w: 44, d: 40, h: 28, c: GREEN }),
      B({ x: 40, y: 158, w: 44, d: 6, h: 60, c: GREEN }),
      B({ x: 110, y: 122, w: 44, d: 40, h: 28, c: GREEN }),
      B({ x: 110, y: 158, w: 44, d: 6, h: 60, c: GREEN }),
    )
    lamp(parts, 150, 18, 56, [128, -8])
  }
})()
