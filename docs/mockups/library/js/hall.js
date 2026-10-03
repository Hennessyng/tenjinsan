// Builds the 2.5D hall and drives the camera (overview, focus on a desk, arrival).
;(() => {
  window.TJ = window.TJ || {}
  const TJ = window.TJ
  const W = TJ.W
  const D = TJ.D
  const H = TJ.WALL_H
  const PERSPECTIVE = 2600

  const world = document.getElementById("world")
  const camera = document.getElementById("camera")
  const stage = document.getElementById("stage")
  const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)")

  // ---------------------------------------------------------------- build
  const pinFor = (r) => {
    const b = TJ.el("button", "pin")
    b.type = "button"
    b.dataset.state = r.state
    b.style.setProperty("--ph", r.h)
    const s = r.badge || TJ.stateText[r.state]
    b.innerHTML =
      `<span class="pin-n">${r.n}</span><span class="pin-t"><b>${r.en}</b>` +
      `<small lang="ja">${r.ja}</small><em>${s.en} / <span lang="ja">${s.ja}</span></em></span>`
    b.setAttribute("aria-label", `${r.n}. ${r.en}, ${r.ja}. ${s.en}. ${r.doEn}.`)
    return b
  }

  const leftWall = () => {
    const wrap = TJ.el("div")
    wrap.style.cssText = "position:relative;width:100%;height:100%"
    wrap.append(TJ.shelves({ rows: 5, width: D - 24, rowH: 58, seed: 7 }))
    const ladder = TJ.el("i", "ladder")
    ladder.style.left = "330px"
    wrap.append(ladder)
    return wrap
  }

  const rightWall = () => {
    const wall = TJ.el("div", "wall-r")
    wall.append(TJ.el("i", "ledge"), TJ.el("i", "wain"))
    for (const wx of [120, 360, 600, 740]) {
      const a = TJ.el("i", "arch")
      a.style.left = `${W - wx - 46}px`
      wall.append(a)
    }
    for (const x of [278, 518, 572]) {
      const ema = TJ.el(
        "div",
        "ema",
        '<svg viewBox="0 0 48 56"><path d="M2 16 L24 3 L46 16 V53 H2 Z" fill="var(--lib-oak)" stroke="var(--lib-brass)" stroke-width="2"/><circle cx="24" cy="12" r="2" fill="var(--shrine-wood)"/><use href="#crest" x="10" y="22" width="28" height="28" fill="none" stroke="var(--shrine-wood)" stroke-width="4"/></svg>',
      )
      ema.style.left = `${x}px`
      ema.setAttribute("aria-hidden", "true")
      wall.append(ema)
    }
    return wall
  }

  const runnerPath = () => {
    const pts = TJ.runnerPoints()
    let d = `M${pts[0][0]} ${pts[0][1]}`
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]
      const [x1, y1] = pts[i]
      const my = (y0 + y1) / 2
      d += ` C${x0} ${my} ${x1} ${my} ${x1} ${y1}`
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("class", "runner")
    svg.setAttribute("viewBox", `0 0 ${W} ${D}`)
    svg.setAttribute("aria-hidden", "true")
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
    path.setAttribute("d", d)
    svg.append(path)
    return svg
  }

  const build = () => {
    world.textContent = ""
    const floor = TJ.el("div", "floor")
    floor.append(TJ.el("i", "slab-s"), TJ.el("i", "slab-e"), TJ.flat("doormat", 660, 700, 120, 90))
    floor.append(runnerPath())
    world.append(floor)
    const ox = TJ.el(
      "div",
      "hall-ox",
      '<svg viewBox="0 0 120 72" aria-hidden="true"><use href="#ox" width="120" height="72"/></svg>',
    )
    ox.setAttribute("aria-hidden", "true")
    world.append(
      TJ.box({ x: 536, y: 722, w: 96, d: 48, h: 24, c: "var(--shrine-stone-deep)" }),
      TJ.box({ x: 532, y: 718, z: 24, w: 104, d: 56, h: 4, c: "var(--shrine-stone)" }),
      ox,
    )

    world.append(
      TJ.box({ x: -14, y: 0, w: 14, d: D, h: H, c: "var(--lib-wall)", east: leftWall() }),
      TJ.box({ x: 0, y: -14, w: W, d: 14, h: H, c: "var(--lib-wall)", south: rightWall() }),
    )

    for (const r of TJ.rooms) {
      const st = TJ.el("div", "station")
      st.dataset.room = r.id
      st.dataset.state = r.state
      for (const k of ["x", "y", "w", "d"]) st.style.setProperty(`--${k}`, r[k])
      st.append(TJ.el("i", "ring"), TJ.flat("shadow", 8, 8, r.w + 8, r.d + 8))
      const parts = TJ.el("div", "parts")
      TJ.furniture[r.id](parts, r)
      st.append(parts, pinFor(r))
      st.addEventListener("click", () =>
        document.dispatchEvent(new CustomEvent("room:open", { detail: r.id })),
      )
      world.append(st)
    }
  }

  // --------------------------------------------------------------- camera
  const cam = {
    cur: { rx: 60, rz: 45, s: 1, tx: 0, ty: 0 },
    tgt: { rx: 60, rz: 45, s: 1, tx: 0, ty: 0 },
    pointer: { x: 0, y: 0, sx: 0, sy: 0 },
    mode: "hall",
    room: null,
    running: false,
    last: 0,
  }

  const project = (x, y, z, rx, rz, vw, vh) => {
    const a = (rz * Math.PI) / 180
    const b = (rx * Math.PI) / 180
    const px = x - W / 2
    const py = y - D / 2
    const x1 = px * Math.cos(a) - py * Math.sin(a)
    const y1 = px * Math.sin(a) + py * Math.cos(a)
    const y2 = y1 * Math.cos(b) - z * Math.sin(b)
    const z2 = y1 * Math.sin(b) + z * Math.cos(b)
    const f = PERSPECTIVE / (PERSPECTIVE - z2)
    return [vw / 2 + x1 * f, vh / 2 + y2 * f]
  }

  const area = (mode) => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (vw < 960) {
      return mode === "desk"
        ? { l: 8, t: 62, r: vw - 8, b: vh * 0.38 - 4 }
        : { l: 8, t: 64, r: vw - 8, b: vh - 76 }
    }
    if (mode === "desk") {
      const pw = Math.min(780, vw * 0.56)
      return { l: 72, t: 64, r: vw - pw - 12, b: vh - 16 }
    }
    return { l: 288, t: 64, r: vw - 12, b: vh - 16 }
  }

  const overviewTarget = (rx, rz) => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const a = area("hall")
    const pts = [
      [0, 0, 0],
      [W, 0, 0],
      [0, D, 0],
      [W, D, 0],
      [0, 0, H],
      [W, 0, H],
      [0, D, H],
      [W, D, -26],
    ].map(([x, y, z]) => project(x, y, z, rx, rz, vw, vh))
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const bw = Math.max(...xs) - Math.min(...xs)
    const bh = Math.max(...ys) - Math.min(...ys)
    const s = Math.min((a.r - a.l) / bw, (a.b - a.t) / bh) * (vw < 700 ? 1.3 : 0.97)
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2
    return {
      rx,
      rz,
      s,
      tx: (a.l + a.r) / 2 - s * cx,
      ty: (a.t + a.b) / 2 - s * cy,
    }
  }

  const focusTarget = (room, rx, rz) => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const a = area("desk")
    const cx = room.x + room.w / 2
    const cy = room.y + room.d / 2
    const [px, py] = project(cx, cy, room.h * 0.4, rx, rz, vw, vh)
    const size = Math.max(room.w, room.d) * 0.9 + room.h * 0.6
    const s = Math.max(0.9, Math.min(2.1, (Math.min(a.r - a.l, a.b - a.t) * 0.64) / size))
    return {
      rx,
      rz,
      s,
      tx: (a.l + a.r) / 2 - s * px,
      ty: (a.t + a.b) / 2 - s * py,
    }
  }

  const apply = () => {
    const c = cam.cur
    world.style.setProperty("--rx", `${c.rx}deg`)
    world.style.setProperty("--rz", `${c.rz}deg`)
    camera.style.transform = `translate(${c.tx}px, ${c.ty}px) scale(${c.s})`
  }

  const goal = () => {
    const t = cam.tgt
    const par = cam.mode === "hall" && !reduceQuery.matches
    return {
      rx: t.rx - (par ? cam.pointer.sy * 2.4 : 0),
      rz: t.rz + (par ? cam.pointer.sx * 5 : 0),
      s: t.s,
      tx: t.tx,
      ty: t.ty,
    }
  }

  const tick = (now) => {
    const dt = Math.min(0.05, (now - cam.last) / 1000 || 0.016)
    cam.last = now
    const k = reduceQuery.matches ? 1 : 1 - Math.exp(-dt * 4.4)
    const kp = reduceQuery.matches ? 1 : 1 - Math.exp(-dt * 6)
    cam.pointer.sx += (cam.pointer.x - cam.pointer.sx) * kp
    cam.pointer.sy += (cam.pointer.y - cam.pointer.sy) * kp
    const g = goal()
    let moving = false
    for (const key of ["rx", "rz", "s", "tx", "ty"]) {
      const diff = g[key] - cam.cur[key]
      const eps = key === "s" ? 0.0005 : 0.02
      if (Math.abs(diff) > eps) {
        cam.cur[key] += diff * k
        moving = true
      } else {
        cam.cur[key] = g[key]
      }
    }
    apply()
    if (moving || Math.abs(cam.pointer.x - cam.pointer.sx) > 0.002) {
      requestAnimationFrame(tick)
    } else {
      cam.running = false
    }
  }

  const kick = () => {
    if (cam.running) return
    cam.running = true
    cam.last = performance.now()
    requestAnimationFrame(tick)
  }

  const retarget = () => {
    if (cam.mode === "desk" && cam.room) {
      cam.tgt = focusTarget(TJ.roomById(cam.room), 52, 38)
    } else {
      cam.tgt = overviewTarget(60, 45)
    }
    kick()
  }

  TJ.hall = {
    build,
    overview() {
      cam.mode = "hall"
      cam.room = null
      retarget()
    },
    focus(id) {
      cam.mode = "desk"
      cam.room = id
      cam.pointer.x = 0
      cam.pointer.y = 0
      retarget()
    },
    snap() {
      cam.mode = "hall"
      cam.room = null
      cam.tgt = overviewTarget(60, 45)
      cam.cur = { ...cam.tgt }
      apply()
    },
    // Arrival: start close to the entrance corner, then pull back to the overview.
    intro() {
      cam.mode = "hall"
      cam.room = null
      cam.tgt = overviewTarget(60, 45)
      const vw = window.innerWidth
      const vh = window.innerHeight
      const a = area("hall")
      const s = cam.tgt.s * 2.6
      const [px, py] = project(W - 90, D - 90, 0, 66, 45, vw, vh)
      cam.cur = {
        rx: 66,
        rz: 45,
        s,
        tx: (a.l + a.r) / 2 - s * px,
        ty: (a.t + a.b) / 2 - s * py - 60,
      }
      apply()
      kick()
    },
    hot(id) {
      for (const el of world.querySelectorAll(".station")) {
        el.classList.toggle("is-hot", el.dataset.room === id)
      }
    },
    focusPin(id) {
      const pin = world.querySelector(`.station[data-room="${id}"] .pin`)
      if (pin) pin.focus({ preventScroll: true })
    },
    resize: retarget,
  }

  stage.addEventListener("pointermove", (e) => {
    if (cam.mode !== "hall") return
    cam.pointer.x = (e.clientX / window.innerWidth - 0.5) * 2
    cam.pointer.y = (e.clientY / window.innerHeight - 0.5) * 2
    kick()
  })
  window.addEventListener("resize", retarget)
})()
