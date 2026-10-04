// The desk panel (one frame for every screen) and the design-notes dialog.
;(() => {
  window.TJ = window.TJ || {}
  const TJ = window.TJ

  const panel = document.getElementById("desk")
  const body = document.getElementById("desk-body")
  const stage = document.getElementById("stage")
  const state = { id: null, opener: null }

  const status = (en, ja) => {
    const el = body.querySelector(".status")
    if (el) el.innerHTML = `${en} <span lang="ja">${ja}</span>`
  }

  const render = (id) => {
    const r = TJ.roomById(id)
    const s = TJ.screens[id]()
    const i = TJ.rooms.indexOf(r)
    const prev = TJ.rooms[i - 1]
    const next = TJ.rooms[i + 1]
    const pager = (room, cls, en, ja) =>
      room
        ? `<button type="button" class="btn ${cls}" data-go="${room.id}">${en} <span lang="ja">${ja}</span></button>`
        : ""
    body.innerHTML = `
      <header class="desk-head">
        <p class="room-plate"><span class="rn">${r.n}</span><span>${r.en}</span><span lang="ja">${r.ja}</span></p>
        <h2 id="desk-title" tabindex="-1">${r.doEn}<span lang="ja">${r.doJa}</span></h2>
        <div class="head-row">${s.stamp}<span class="route-ref">Replaces <code>${TJ.esc(r.route)}</code></span></div>
      </header>
      <div class="desk-main">
        <div class="sheet">${s.sheet}</div>
        <aside class="note" aria-label="Margin note / 余白のメモ">${s.note}</aside>
      </div>
      <footer class="desk-foot">
        <p class="status route-ref" role="status">Mockup only: nothing is sent. <span lang="ja">モックのため、何も送信されません。</span></p>
        <div class="pager">
          ${pager(prev, "btn-quiet", "Previous", "前へ")}
          ${pager(next, "btn-primary", "Next room", "次の部屋へ")}
        </div>
      </footer>`
  }

  TJ.desk = {
    get id() {
      return state.id
    },
    open(id, opener) {
      const wasOpen = Boolean(state.id)
      state.id = id
      if (opener) state.opener = opener
      render(id)
      panel.hidden = false
      stage.inert = true
      if (!wasOpen) panel.getBoundingClientRect() // commit the start state for the slide
      panel.classList.add("is-open")
      body.querySelector("#desk-title").focus({ preventScroll: true })
    },
    close() {
      if (!state.id) return
      state.id = null
      panel.classList.remove("is-open")
      stage.inert = false
      const done = () => {
        if (!state.id) panel.hidden = true
      }
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) done()
      else panel.addEventListener("transitionend", done, { once: true })
      const back = state.opener
      state.opener = null
      if (back?.isConnected) back.focus({ preventScroll: true })
    },
  }

  panel.addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]")
    if (go) {
      document.dispatchEvent(new CustomEvent("room:open", { detail: go.dataset.go }))
      return
    }
    const act = e.target.closest("[data-act]")
    if (!act) return
    const key = act.dataset.act
    if (key.startsWith("go:")) {
      document.dispatchEvent(new CustomEvent("room:open", { detail: key.slice(3) }))
    } else if (key === "spine") {
      for (const b of act.parentElement.children) b.setAttribute("aria-pressed", String(b === act))
      status(`Selected "${act.textContent}".`, "選択しました。")
    } else {
      status(`"${act.firstChild.textContent.trim()}" is a mockup button.`, "モック用のボタンです。")
    }
  })

  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") document.dispatchEvent(new CustomEvent("room:close"))
  })

  // ------------------------------------------------------------ notes
  const MAP = TJ.rooms
    .map(
      (r) =>
        `<tr><td>${r.n}</td><td>${r.en}<br /><span lang="ja">${r.ja}</span></td><td><code>${TJ.esc(r.route)}</code></td><td>${TJ.esc(r.old)}</td></tr>`,
    )
    .join("")

  const SW = [
    ["--lib-night", "#0d1c18"],
    ["--lib-wall", "#254a40"],
    ["--lib-wall-deep", "#1a3730"],
    ["--lib-floor-a", "#e8dcc4"],
    ["--lib-floor-b", "#dfd0b0"],
    ["--lib-oak", "#b08358"],
    ["--lib-oak-dark", "#7d5a39"],
    ["--lib-brass", "#c9a45c"],
    ["--lib-lamp", "#ffd98a"],
    ["--shrine-stone", "#e4dfd1"],
    ["--shrine-wood", "#43301f"],
    ["--shrine-verdigris", "#5f8071"],
    ["--shrine-plum", "#b8456a"],
    ["--shrine-vermilion", "#bf3a28"],
  ]
    .map(
      ([n, c]) =>
        `<span class="sw"><i style="display:inline-block;width:12px;height:12px;margin-right:6px;vertical-align:-1px;background:${c};border:1px solid #0003"></i><code>${n}</code> ${c}</span>`,
    )
    .join("")

  const dlg = document.getElementById("notes")
  dlg.innerHTML = `
    <h2 id="notes-title">Design notes <span lang="ja">設計メモ</span></h2>
    <p>One metaphor, one navigation, one component kit. Everything below is a proposal.</p>
    <h3 class="shrine-heading">Inspired by Kitano Tenmangū <span lang="ja">北野天満宮に着想を得て</span></h3>
    <p>The shrine dedicated to Sugawara no Michizane connects literature and learning with plum blossoms and sacred oxen. Its 北野文庫 also offers a direct library connection: Kyoto booksellers dedicated books there during the Edo period.</p>
    <p lang="ja">学問の神さまを祀る北野天満宮。梅、臥牛、石の鳥居、灯籠、絵馬が、図書室の入口と広間のモチーフです。</p>
    <p>The entrance is an illustrated ema, not a reconstruction of the actual buildings. The plum crest is a simplified study, not official artwork. This independent mockup has no shrine affiliation. Reference: <a class="shrine-link" href="https://ja.wikipedia.org/wiki/北野天満宮" lang="ja">北野天満宮</a>.</p>
    <h3>Room to route <span lang="ja">部屋と画面の対応</span></h3>
    <table><thead><tr><th>#</th><th>Room</th><th>Route</th><th>Replaces</th></tr></thead><tbody>${MAP}</tbody></table>
    <p><code>/login</code> becomes the entrance. Log out becomes "Leave". The ribbon on the left is the only navigation.</p>
    <h3>Proposed tokens, on top of the Studio tokens <span lang="ja">追加トークン案</span></h3>
    <div class="swatches">${SW}</div>
    <h3>Where this departs from DESIGN.md <span lang="ja">DESIGN.md との差分</span></h3>
    <ul>
      <li>It adds depth, shadow, gradients and 3D motion, which the current rules avoid.</li>
      <li>It adds the extra colour tokens above. Existing Studio tokens are unchanged.</li>
      <li>Mitigations: every state is written in words, motion stops under reduced-motion, and all controls are native.</li>
    </ul>
    <h3>Open decisions <span lang="ja">未決事項</span></h3>
    <ul>
      <li>Keep the 3D hall as the home screen, or use it only as a first-visit tour?</li>
      <li>Should the route ribbon also exist on the narrow-screen layout as a list?</li>
      <li>English-first, Japanese-first, or a language switch?</li>
    </ul>
    <form method="dialog"><button class="btn btn-primary">Close <span lang="ja">閉じる</span></button></form>`

  TJ.notes = {
    open() {
      if (!dlg.open) dlg.showModal()
    },
  }
})()
