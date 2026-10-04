// Tiny CSS-3D toolkit: cuboids, shelves of book spines, flat floor decals.
;(() => {
  window.TJ = window.TJ || {}
  const TJ = window.TJ

  TJ.el = (tag, cls, html) => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (html !== undefined) e.innerHTML = html
    return e
  }

  TJ.rng = (seed) => {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const SPINES = [
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

  // o: x,y,z (position), w,d,h (size), c (colour), rot/tilt (deg), glass,
  //    east/south/top (elements placed on that face), cls
  TJ.box = (o) => {
    const el = TJ.el("div", `box${o.glass ? " glass" : ""}${o.cls ? ` ${o.cls}` : ""}`)
    const set = (k, v) => el.style.setProperty(k, v)
    set("--x", o.x || 0)
    set("--y", o.y || 0)
    set("--z", o.z || 0)
    set("--w", o.w)
    set("--d", o.d)
    set("--h", o.h)
    set("--c", o.c || "var(--lib-oak)")
    if (o.rot) set("--rot", `${o.rot}deg`)
    if (o.tilt) set("--tilt", `${o.tilt}deg`)
    const names = o.glass ? ["top", "south", "east", "north", "west"] : ["top", "south", "east"]
    const faces = {}
    for (const n of names) {
      faces[n] = TJ.el("i", `f ${n}`)
      el.append(faces[n])
    }
    if (o.east) {
      const wrap = TJ.el("div", "fc-east")
      wrap.append(o.east)
      faces.east.append(wrap)
    }
    if (o.south) {
      const wrap = TJ.el("div", "fc-south")
      wrap.append(o.south)
      faces.south.append(wrap)
    }
    if (o.top) faces.top.append(o.top)
    return el
  }

  // Rows of book spines that fill (width x height) and look hand-shelved.
  TJ.shelves = ({ rows, width, rowH, seed }) => {
    const rnd = TJ.rng(seed)
    const wrap = TJ.el("div", "shelves")
    for (let r = 0; r < rows; r++) {
      const row = TJ.el("div", "shelf")
      row.style.height = `${rowH}px`
      let used = 0
      while (used < width) {
        const sw = 8 + Math.floor(rnd() * 11)
        const sh = Math.floor((rowH - 10) * (0.62 + rnd() * 0.34))
        const s = TJ.el("i", "spine")
        s.style.setProperty("--sw", sw)
        s.style.setProperty("--sh", sh)
        s.style.setProperty("--sc", SPINES[Math.floor(rnd() * SPINES.length)])
        row.append(s)
        used += sw
      }
      wrap.append(row)
    }
    return wrap
  }

  // Flat decal on the floor (shadow, glow, rug). Coordinates are floor units.
  TJ.flat = (cls, x, y, w, d) => {
    const f = TJ.el("div", `flat ${cls}`)
    f.style.left = `${x}px`
    f.style.top = `${y}px`
    f.style.width = `${w}px`
    f.style.height = `${d}px`
    return f
  }

  // Page-like thin slab (paper on a desk).
  TJ.paper = (x, y, z, w, d, rot, c) =>
    TJ.box({ x, y, z, w, d, h: 1.5, c: c || "var(--color-paper-raised)", rot })
})()
