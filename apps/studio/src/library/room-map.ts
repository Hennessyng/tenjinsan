import type { CatalogKey } from "@reading-studio/contracts/i18n"
import type { LibraryStudy } from "./client.ts"

export const libraryRooms = [
  {
    id: "accession",
    n: 1,
    x: 595,
    y: 593,
    w: 190,
    d: 74,
    h: 90,
  },
  {
    id: "stacks",
    n: 2,
    x: 110,
    y: 470,
    w: 164,
    d: 270,
    h: 215,
  },
  {
    id: "lending",
    n: 3,
    x: 300,
    y: 690,
    w: 170,
    d: 70,
    h: 115,
  },
  {
    id: "reference",
    n: 4,
    x: 270,
    y: 330,
    w: 130,
    d: 130,
    h: 135,
  },
  {
    id: "reading",
    n: 5,
    x: 440,
    y: 350,
    w: 190,
    d: 110,
    h: 110,
  },
  {
    id: "catalogue",
    n: 6,
    x: 360,
    y: 14,
    w: 230,
    d: 72,
    h: 155,
  },
  {
    id: "bindery",
    n: 7,
    x: 660,
    y: 200,
    w: 120,
    d: 120,
    h: 150,
  },
  {
    id: "review",
    n: 8,
    x: 640,
    y: 380,
    w: 140,
    d: 110,
    h: 110,
  },
  {
    id: "ledger",
    n: 9,
    x: 230,
    y: 40,
    w: 90,
    d: 70,
    h: 130,
  },
  {
    id: "display",
    n: 10,
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
  lending: { next: "stacks", message: "room.lending.requires" },
  reference: { next: "lending", message: "room.reference.requires" },
  reading: { next: "reference", message: "room.reading.requires" },
  catalogue: { next: "reading", message: "room.catalogue.requires" },
  review: { next: "catalogue", message: "room.review.requires" },
  ledger: { next: "lending", message: "room.ledger.requires" },
  display: { next: "review", message: "room.display.requires" },
} as const satisfies Readonly<
  Record<RoomId, { readonly next: RoomId; readonly message: CatalogKey } | null>
>

export const roomText = {
  accession: { name: "room.accession.name", action: "room.accession.action" },
  stacks: { name: "room.stacks.name", action: "room.stacks.action" },
  lending: { name: "room.lending.name", action: "room.lending.action" },
  reference: { name: "room.reference.name", action: "room.reference.action" },
  reading: { name: "room.reading.name", action: "room.reading.action" },
  catalogue: { name: "room.catalogue.name", action: "room.catalogue.action" },
  bindery: { name: "room.bindery.name", action: "room.bindery.action" },
  review: { name: "room.review.name", action: "room.review.action" },
  ledger: { name: "room.ledger.name", action: "room.ledger.action" },
  display: { name: "room.display.name", action: "room.display.action" },
} as const satisfies Readonly<
  Record<RoomId, { readonly name: CatalogKey; readonly action: CatalogKey }>
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
