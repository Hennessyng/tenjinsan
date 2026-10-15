import { box, element, flat } from "./boxes.ts"

const OAK = "var(--lib-oak)"
const DARK = "var(--lib-oak-dark)"
const GREEN = "var(--color-green)"
const CORAL = "var(--color-coral)"
const INK = "var(--color-ink)"
const BRASS = "var(--lib-brass)"
const PAPER = "var(--color-paper-raised)"

export const furnitureB = {
  catalogue(parts: HTMLElement): void {
    const drawers = element("div", "drawers")
    for (let index = 0; index < 24; index++) drawers.append(element("i"))
    parts.append(
      box({ w: 230, d: 72, h: 118, c: DARK, south: drawers }),
      box({ x: -4, y: -4, z: 118, w: 238, d: 80, h: 6, c: OAK }),
      box({ x: 20, y: 18, z: 124, w: 54, d: 30, h: 10, c: PAPER }),
      box({ x: 100, y: 22, z: 124, w: 6, d: 30, h: 16, c: PAPER, rot: 8 }),
      box({ x: 108, y: 22, z: 124, w: 6, d: 30, h: 14, c: CORAL, rot: 8 }),
      box({ x: 88, y: 72, z: 52, w: 28, d: 22, h: 28, c: OAK }),
      box({ x: 94, y: 74, z: 80, w: 16, d: 16, h: 1.5, c: PAPER }),
    )
  },
  bindery(parts: HTMLElement): void {
    parts.append(
      box({ w: 120, d: 120, h: 50, c: DARK }),
      box({ x: -4, y: -4, z: 50, w: 128, d: 128, h: 6, c: OAK }),
      box({ x: 30, y: 30, z: 56, w: 60, d: 60, h: 18, c: CORAL }),
      box({ x: 32, y: 32, z: 74, w: 56, d: 56, h: 14, c: GREEN }),
    )
    for (const [x, y] of [
      [14, 14],
      [96, 14],
      [14, 96],
      [96, 96],
    ] as const)
      parts.append(box({ x, y, z: 56, w: 10, d: 10, h: 66, c: INK }))
    parts.append(
      box({ x: 10, y: 10, z: 122, w: 100, d: 100, h: 8, c: INK }),
      box({ x: 54, y: 54, z: 130, w: 12, d: 12, h: 24, c: BRASS }),
      box({ x: 28, y: 58, z: 152, w: 64, d: 4, h: 4, c: BRASS }),
      box({ x: 4, y: 104, z: 56, w: 10, d: 10, h: 8, c: "var(--lib-lamp)" }),
      flat({ cls: "glow", x: -30, y: 70, w: 90, d: 90 }),
    )
  },
  review(parts: HTMLElement): void {
    const ring = element("div")
    ring.style.cssText =
      "width:100%;height:100%;border:5px solid #c9a45c;border-radius:50%;background:rgba(190,226,214,.55)"
    for (const [x, y] of [
      [6, 6],
      [124, 6],
      [6, 94],
      [124, 94],
    ] as const)
      parts.append(box({ x, y, w: 10, d: 10, h: 46, c: DARK }))
    parts.append(
      box({ w: 140, d: 110, z: 46, h: 4, glass: true }),
      box({ x: 18, y: 18, z: 51, w: 44, d: 32, h: 4, c: GREEN, rot: 6 }),
      box({ x: 22, y: 56, z: 51, w: 40, d: 30, h: 1.5, c: PAPER, rot: -5 }),
      box({ x: 78, y: 22, z: 51, w: 40, d: 40, h: 1, c: "transparent", top: ring }),
      box({ x: 104, y: 62, z: 51, w: 30, d: 5, h: 3, c: BRASS, rot: 38 }),
    )
  },
  ledger(parts: HTMLElement): void {
    parts.append(
      box({ x: 20, y: 16, w: 50, d: 38, h: 74, c: DARK }),
      box({ x: 6, y: 8, z: 74, w: 78, d: 56, h: 5, c: OAK, tilt: -18 }),
      box({ x: 14, y: 14, z: 80, w: 62, d: 44, h: 2, c: PAPER, tilt: -18 }),
      box({ x: 44, y: 14, z: 82, w: 3, d: 44, h: 1, c: CORAL, tilt: -18 }),
    )
  },
  display(parts: HTMLElement): void {
    parts.append(
      box({ w: 130, d: 130, h: 38, c: DARK }),
      box({ x: -4, y: -4, z: 38, w: 138, d: 138, h: 5, c: OAK }),
      box({ x: 34, y: 40, z: 43, w: 60, d: 46, h: 8, c: CORAL, rot: -8 }),
      box({ x: 36, y: 42, z: 51, w: 56, d: 42, h: 4, c: PAPER, rot: -8 }),
      box({ x: 12, y: 12, z: 43, w: 106, d: 106, h: 92, glass: true }),
      box({ x: 34, y: 129, z: 14, w: 62, d: 3, h: 12, c: BRASS }),
      flat({ cls: "glow", x: 20, y: 20, w: 90, d: 90 }),
    )
  },
}
