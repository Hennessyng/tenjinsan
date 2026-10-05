import type { LibraryStudy } from "./client.ts"

export const libraryRooms = [
  {
    id: "accession",
    n: 1,
    en: "Accession desk",
    ja: "受入カウンター",
    doEn: "Bring a book in",
    doJa: "本を受け入れる",
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
    x: 60,
    y: 60,
    w: 130,
    d: 130,
    h: 150,
  },
] as const
export type LibraryRoom = (typeof libraryRooms)[number]
export type RoomId = LibraryRoom["id"]

export const roomPrerequisites = {
  accession: null,
  stacks: null,
  bindery: null,
  lending: {
    next: "stacks",
    en: "A readable normalization is required.",
    ja: "読める資料が必要です。",
  },
  reference: {
    next: "lending",
    en: "No saved question bank is available. Review and send the study setup first.",
    ja: "質問が未準備です。先に読書設定と送信を確認してください。",
  },
  reading: {
    next: "reference",
    en: "A current setup and saved interview are required.",
    ja: "現在の設定と保存済みの回答が必要です。",
  },
  catalogue: {
    next: "reading",
    en: "Approve the current reading brief before generating an outline.",
    ja: "先に現在の読書方針を承認してください。",
  },
  review: {
    next: "catalogue",
    en: "An approved outline and current generated lesson are required.",
    ja: "承認済みの構成案と現在の本文が必要です。",
  },
  ledger: {
    next: "lending",
    en: "A saved study setup is required to inspect revisions.",
    ja: "版を確認するには読書設定を保存してください。",
  },
  display: {
    next: "review",
    en: "Review the current lesson's evidence and privacy before publication.",
    ja: "公開前に現在の本文の根拠とプライバシーを確認してください。",
  },
} as const satisfies Readonly<
  Record<RoomId, { readonly next: RoomId; readonly en: string; readonly ja: string } | null>
>

export function roomHref(room: RoomId, study: LibraryStudy | null): string {
  const inspect = `/?room=${room}`
  switch (room) {
    case "accession":
      return "/imports"
    case "stacks":
      return study?.normalizationId ? `/sources/${study.normalizationId}` : "/sources"
    case "lending":
      return study?.normalizationId ? `/sources/${study.normalizationId}/setup` : inspect
    case "reference":
      return study ? `/interviews/${study.id}` : inspect
    case "reading":
      return study ? `/briefs/${study.id}` : inspect
    case "catalogue":
      return study ? `/outlines/${study.id}` : inspect
    case "bindery":
      return "/jobs"
    case "review":
      return study ? `/evidence/${study.id}` : inspect
    case "ledger":
      return study ? `/revisions/${study.id}` : inspect
    case "display":
      return study ? `/publications/${study.id}` : inspect
  }
}

export function roomAt(url: URL): LibraryRoom | null {
  const inspect = libraryRooms.find((room) => room.id === url.searchParams.get("room"))
  if (url.pathname === "/") return inspect ?? null
  const prefix = url.pathname.split("/")[1]
  const routes: Readonly<Record<string, RoomId>> = {
    imports: "accession",
    sources: url.pathname.includes("/setup") ? "lending" : "stacks",
    interviews: "reference",
    briefs: "reading",
    outlines: "catalogue",
    jobs: "bindery",
    evidence: "review",
    revisions: "ledger",
    publications: "display",
  }
  const id = routes[prefix ?? ""]
  return libraryRooms.find((room) => room.id === id) ?? null
}
