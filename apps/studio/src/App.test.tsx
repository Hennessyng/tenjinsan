// @vitest-environment happy-dom

import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { App } from "./App"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ studies: [], selectedStudyId: null })),
  )
})

describe("studio shell", () => {
  it("names the private library and pairs its reading route with Japanese", () => {
    const root = document.createElement("div")
    root.id = "root"
    document.body.append(root)
    render(<App />, { container: root })

    expect(screen.getByRole("link", { name: "Back to the hall" }).textContent).toContain(
      "TENJINSAN",
    )
    expect(screen.getByRole("navigation", { name: "Reading route" })).toBeDefined()
    expect(screen.queryByText(/読書ルート/)).toBeNull()
    expect(
      screen.getByRole("navigation", { name: "Reading route" }).querySelectorAll("button").length,
    ).toBe(9)
  })

  it("opens the library without login, logout or session-expiry gates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ studies: [], selectedStudyId: null })),
    )
    const root = document.createElement("div")
    root.id = "root"
    document.body.replaceChildren(root)
    render(<App />, { container: root })
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull()
    expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull()
    await act(async () => {
      window.dispatchEvent(new Event("studio-authentication-required"))
    })
    expect(screen.getByRole("navigation", { name: "Reading route" })).toBeDefined()
    expect(screen.queryByText(/owner session expired/i)).toBeNull()
  })
})
