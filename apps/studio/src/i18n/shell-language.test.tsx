// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { App } from "../App.tsx"
import { LANGUAGE_STORAGE_KEY } from "./preference.ts"

function mount(url: string): void {
  history.replaceState(null, "", url)
  const root = document.createElement("div")
  root.id = "root"
  document.body.replaceChildren(root)
  render(<App />, { container: root })
}

function dirtyField(): HTMLTextAreaElement {
  const sheet = document.querySelector("#desk .sheet")
  if (sheet === null) throw new TypeError("desk sheet missing")
  const field = document.createElement("textarea")
  sheet.append(field)
  return field
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ studies: [], selectedStudyId: null })),
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("Given the studio shell", () => {
  it("When nothing is remembered Then English is used and the document says so", () => {
    mount("/")
    expect(screen.getByRole("navigation", { name: "Reading route" })).toBeDefined()
    expect(document.documentElement.lang).toBe("en")
    expect(screen.queryByText(/読書ルート/)).toBeNull()
  })

  it("When Japanese was remembered Then the shell is Japanese only", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "ja")
    mount("/")
    expect(screen.getByRole("navigation", { name: "読書ルート" })).toBeDefined()
    expect(document.documentElement.lang).toBe("ja")
    expect(document.title).toBe("問いからひらく読書スタジオ")
    expect(screen.queryByText("Reading route")).toBeNull()
  })

  it("When an accepted explicit lang is visited Then it beats and replaces the remembered choice", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "en")
    mount("/?lang=ja")
    expect(screen.getByRole("navigation", { name: "読書ルート" })).toBeDefined()
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("ja")
  })

  it("When an unsupported lang is visited Then it is ignored and never stored", () => {
    mount("/?lang=fr")
    expect(screen.getByRole("navigation", { name: "Reading route" })).toBeDefined()
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull()
  })
})

describe("Given the language switch", () => {
  it("When Japanese is chosen Then the shell switches, the choice is remembered and announced", async () => {
    mount("/")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "日本語" }))
    })
    expect(screen.getByRole("navigation", { name: "読書ルート" })).toBeDefined()
    expect(screen.getByRole("button", { name: "日本語" }).getAttribute("aria-pressed")).toBe("true")
    expect(document.documentElement.lang).toBe("ja")
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("ja")
  })

  it("When saving the choice throws Then the language still applies with an honest notice", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError")
      },
    })
    mount("/")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "日本語" }))
    })
    expect(screen.getByRole("navigation", { name: "読書ルート" })).toBeDefined()
    expect(screen.getByRole("status").textContent).toContain("開き直す")
  })

  it("When reading the remembered choice throws Then English is used", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new DOMException("denied", "SecurityError")
      },
      setItem: () => undefined,
    })
    mount("/")
    expect(screen.getByRole("navigation", { name: "Reading route" })).toBeDefined()
  })
})

describe("Given unsaved edits in the open room", () => {
  it("When the switch is used Then a warning appears first and nothing changes until leaving", async () => {
    mount("/imports")
    const field = dirtyField()
    await act(async () => {})
    await act(async () => {
      field.value = "half-typed note"
      fireEvent.input(field)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "日本語" }))
    })
    const dialog = document.querySelector("dialog")
    expect(dialog?.hasAttribute("open")).toBe(true)
    expect(document.documentElement.lang).toBe("en")
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull()
    expect(location.search).toBe("")

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stay" }))
    })
    expect(document.documentElement.lang).toBe("en")
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull()
    expect(field.value).toBe("half-typed note")

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "日本語" }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Leave and discard" }))
    })
    expect(document.documentElement.lang).toBe("ja")
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("ja")
  })
})
