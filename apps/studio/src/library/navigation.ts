import type { LibraryStudy } from "./client.ts"
import { type RoomId, roomHref } from "./room-map.ts"

export function navigateRoom(room: RoomId | null, study: LibraryStudy | null): void {
  const current = new URL(window.location.href)
  const target = new URL(room === null ? "/" : roomHref(room, study), current)
  const keys =
    room === "stacks"
      ? ["chapter", "citation"]
      : room === "reference" || room === "review"
        ? ["lang", "step"]
        : ["lang"]
  if (current.pathname === target.pathname) {
    for (const key of keys) {
      const value = current.searchParams.get(key)
      if (value !== null) target.searchParams.set(key, value)
    }
    target.hash = current.hash
  }
  window.history.pushState(null, "", target)
  window.dispatchEvent(new PopStateEvent("popstate"))
}
