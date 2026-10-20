// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { LibraryDesk } from "./LibraryDesk.tsx"
import { libraryRooms } from "./room-map.ts"

afterEach(cleanup)
it("lets a direct interview route explain readiness even when the shell has no selected study", async () => {
  // Given
  window.history.replaceState(null, "", "/interviews/missing-study")
  const room = libraryRooms.find((room) => room.id === "reference")
  if (!room) throw new TypeError("Missing reference room")
  // When
  render(
    <LanguageProvider>
      <LibraryDesk
        room={room}
        study={null}
        selection={null}
        onOpen={() => undefined}
        onHall={() => undefined}
        contextReady
        nativeContent
      >
        <h1>Interview-owned readiness</h1>
      </LibraryDesk>
    </LanguageProvider>,
  )
  // Then
  expect(await screen.findByRole("heading", { name: "Interview-owned readiness" })).toBeTruthy()
  expect(screen.queryByText("Choose a study to continue.")).toBeNull()
})
