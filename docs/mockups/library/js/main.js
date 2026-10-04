// Wires the entrance, the hall, the route ribbon and the desk together.
;(() => {
  const TJ = window.TJ
  const $ = (id) => document.getElementById(id)
  const gate = $("gate")
  const library = $("library")
  const where = $("where")
  const list = $("route-list")
  const zoomOut = $("zoom-out")
  const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const wait = (ms) => (reduce() ? 0 : ms)

  let built = false
  let current = null
  const timers = new Set()
  const schedule = (callback, delay) => {
    const timer = window.setTimeout(() => {
      timers.delete(timer)
      callback()
    }, wait(delay))
    timers.add(timer)
  }
  const cancelTransitions = () => {
    for (const timer of timers) window.clearTimeout(timer)
    timers.clear()
  }

  // ----------------------------------------------------------- route ribbon
  const buildRoute = () => {
    list.innerHTML = TJ.rooms
      .map((r) => {
        const s = r.badge || TJ.stateText[r.state]
        return `<li><button type="button" data-room="${r.id}" data-state="${r.state}"><span class="rn">${r.n}</span><span class="rt"><b>${r.en}</b><small lang="ja">${r.ja}</small><em>${s.en} / <span lang="ja">${s.ja}</span></em></span></button></li>`
      })
      .join("")
  }

  const mark = () => {
    const target = current || TJ.rooms.find((r) => r.state === "now").id
    for (const b of list.querySelectorAll("button")) {
      if (b.dataset.room === target) b.setAttribute("aria-current", "step")
      else b.removeAttribute("aria-current")
    }
  }

  const say = () => {
    if (!current) {
      where.innerHTML = 'The hall. Choose a desk. <span lang="ja">広間：机を選んでください。</span>'
      return
    }
    const r = TJ.roomById(current)
    where.innerHTML = `Room ${r.n}: ${r.en} <span lang="ja">${r.ja}</span>`
  }

  // ------------------------------------------------------------ navigation
  const pinOf = (id) => document.querySelector(`.station[data-room="${id}"] .pin`)

  const go = (id) => {
    current = id
    document.body.dataset.mode = "desk"
    zoomOut.hidden = false
    TJ.hall.focus(id)
    TJ.desk.open(id, pinOf(id))
    mark()
    say()
  }

  const home = () => {
    current = null
    document.body.dataset.mode = "hall"
    zoomOut.hidden = true
    TJ.desk.close()
    TJ.hall.overview()
    mark()
    say()
  }

  document.addEventListener("room:open", (e) => go(e.detail))
  document.addEventListener("room:close", home)
  list.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-room]")
    if (b) go(b.dataset.room)
  })
  for (const ev of ["mouseover", "focusin"]) {
    list.addEventListener(ev, (e) => {
      const b = e.target.closest("button[data-room]")
      if (b) TJ.hall.hot(b.dataset.room)
    })
  }
  for (const ev of ["mouseleave", "focusout"]) list.addEventListener(ev, () => TJ.hall.hot(null))

  zoomOut.addEventListener("click", home)
  $("brand-home").addEventListener("click", (e) => {
    e.preventDefault()
    home()
  })
  $("open-notes").addEventListener("click", () => TJ.notes.open())

  // ------------------------------------------------------- enter and leave
  const show = () => {
    if (!built) {
      buildRoute()
      TJ.hall.build()
      built = true
    }
    library.hidden = false
    document.body.dataset.view = "library"
    current = null
    document.body.dataset.mode = "hall"
    zoomOut.hidden = true
    mark()
    say()
  }

  const setOrigin = () => {
    const scene = $("gate-scene")
    const sr = scene.getBoundingClientRect()
    const dr = $("doorway").getBoundingClientRect()
    const gs = sr.width / scene.offsetWidth || 1
    scene.style.setProperty("--ox", `${(dr.left + dr.width / 2 - sr.left) / gs}px`)
    scene.style.setProperty("--oy", `${(dr.top + dr.height * 0.55 - sr.top) / gs}px`)
  }

  const enter = (instant) => {
    cancelTransitions()
    show()
    gate.inert = true
    library.inert = false
    if (instant) {
      gate.style.transition = "none"
      gate.classList.add("is-leaving")
      TJ.hall.snap()
      $("route").querySelector("[aria-current]")?.focus()
      return
    }
    gate.scrollTop = 0
    setOrigin()
    gate.classList.add("is-entering", "is-leaving")
    schedule(() => TJ.hall.intro(), 600)
    schedule(() => $("route").querySelector("[aria-current]")?.focus(), 1500)
  }

  const leave = () => {
    cancelTransitions()
    TJ.desk.close()
    library.inert = true
    gate.inert = false
    gate.style.transition = ""
    gate.classList.remove("is-entering", "is-leaving")
    document.body.dataset.view = "gate"
    schedule(() => {
      library.hidden = true
    }, 1300)
    $("login").querySelector("button[type='submit']").focus()
  }

  $("login").addEventListener("submit", (e) => {
    e.preventDefault()
    enter(false)
  })
  $("leave").addEventListener("click", leave)

  // Deep links for review: ?hall skips the gate, ?room=<id> opens a desk.
  const q = new URLSearchParams(window.location.search)
  if (q.has("hall") || q.has("room")) {
    enter(true)
    const id = q.get("room")
    if (id && TJ.roomById(id)) schedule(() => go(id), 50)
  }
})()
