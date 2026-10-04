// Room model: each existing Studio route group becomes one room in the library.
;(() => {
  window.TJ = window.TJ || {}
  const TJ = window.TJ

  TJ.W = 800
  TJ.D = 800
  TJ.WALL_H = 300

  // x,y,w,d = footprint on the 800x800 floor; h = pin height above the floor.
  TJ.rooms = [
    {
      id: "accession",
      n: 1,
      en: "Accession desk",
      ja: "受入カウンター",
      doEn: "Bring a book in",
      doJa: "本を受け入れる",
      route: "/imports",
      old: "Home hero + ImportBook form",
      state: "done",
      x: 595,
      y: 593,
      w: 190,
      d: 74,
      h: 90,
    },
    {
      id: "stacks",
      n: 2,
      en: "The stacks",
      ja: "書庫",
      doEn: "Read the source",
      doJa: "資料を読む",
      route: "/sources, /sources/:id",
      old: "Source reader (SourceRoutes)",
      state: "done",
      x: 110,
      y: 470,
      w: 164,
      d: 270,
      h: 215,
    },
    {
      id: "lending",
      n: 3,
      en: "Lending desk",
      ja: "貸出カウンター",
      doEn: "Decide what leaves the library",
      doJa: "外に出す範囲を決める",
      route: "/sources/:id/setup",
      old: "Study setup + transmission review",
      state: "done",
      x: 300,
      y: 690,
      w: 170,
      d: 70,
      h: 115,
    },
    {
      id: "reference",
      n: 4,
      en: "Reference desk",
      ja: "レファレンス",
      doEn: "Answer a few questions",
      doJa: "いくつかの問いに答える",
      route: "/interviews, /interviews/:id",
      old: "Saved interview",
      state: "now",
      x: 270,
      y: 330,
      w: 130,
      d: 130,
      h: 135,
    },
    {
      id: "reading",
      n: 5,
      en: "Reading table",
      ja: "閲覧席",
      doEn: "Review your reading brief",
      doJa: "読書の方針を確認する",
      route: "/briefs/:id",
      old: "Reading brief approval",
      state: "next",
      x: 440,
      y: 350,
      w: 190,
      d: 110,
      h: 110,
    },
    {
      id: "catalogue",
      n: 6,
      en: "Card catalogue",
      ja: "目録",
      doEn: "Review the outline",
      doJa: "構成案を確認する",
      route: "/outlines/:id",
      old: "Themed outline review",
      state: "next",
      x: 360,
      y: 14,
      w: 230,
      d: 72,
      h: 155,
    },
    {
      id: "bindery",
      n: 7,
      en: "Bindery",
      ja: "製本室",
      doEn: "Watch the lesson being made",
      doJa: "制作の進行を見る",
      route: "/jobs",
      old: "Owner job ledger",
      state: "next",
      badge: { en: "1 job running", ja: "実行中 1件" },
      x: 660,
      y: 200,
      w: 120,
      d: 120,
      h: 150,
    },
    {
      id: "review",
      n: 8,
      en: "Review room",
      ja: "校閲室",
      doEn: "Check evidence and privacy",
      doJa: "根拠とプライバシーを確認する",
      route: "/evidence/:id",
      old: "Evidence and privacy review",
      state: "next",
      x: 640,
      y: 380,
      w: 140,
      d: 110,
      h: 110,
    },
    {
      id: "ledger",
      n: 9,
      en: "Revision ledger",
      ja: "改訂台帳",
      doEn: "Compare versions",
      doJa: "版を見比べる",
      route: "/revisions/:id",
      old: "Revision history",
      state: "next",
      x: 230,
      y: 40,
      w: 90,
      d: 70,
      h: 130,
    },
    {
      id: "display",
      n: 10,
      en: "Display case",
      ja: "展示ケース",
      doEn: "Approve and download",
      doJa: "承認してファイルを保存する",
      route: "/publications/:id",
      old: "Publication approval + versioned files",
      state: "next",
      x: 60,
      y: 60,
      w: 130,
      d: 130,
      h: 150,
    },
  ]

  TJ.stateText = {
    done: { en: "Done", ja: "完了" },
    now: { en: "You are here", ja: "現在地" },
    next: { en: "Not yet", ja: "これから" },
  }

  TJ.roomById = (id) => TJ.rooms.find((r) => r.id === id)

  // Entrance on the floor, then every room in order (the carpet runner).
  TJ.runnerPoints = () => [[785, 785], ...TJ.rooms.map((r) => [r.x + r.w / 2, r.y + r.d + 26])]

  TJ.esc = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    )

  // Paired English / Japanese helpers (DESIGN.md: paired text, explicit lang).
  TJ.p = (en, ja) => `<p lang="en">${en}</p><p lang="ja">${ja}</p>`
  TJ.bi = (en, ja) => `${en} <span lang="ja">${ja}</span>`
  TJ.stamp = (cls, en, ja) =>
    `<span class="stamp stamp-${cls}"><span lang="en">${en}</span><span lang="ja">${ja}</span></span>`
})()
