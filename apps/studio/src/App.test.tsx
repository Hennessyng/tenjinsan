// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { App } from "./App"

describe("studio shell", () => {
  it("names the private library and pairs its reading route with Japanese", () => {
    render(<App />)

    expect(
      screen.getByRole("link", { name: "Back to the hall / ホールへ戻る" }).textContent,
    ).toContain("TENJINSAN")
    expect(screen.getByRole("navigation", { name: "Reading route / 読書ルート" })).toBeDefined()
    expect(screen.getAllByText(/読書ルート/, { selector: "[lang='ja']" }).length).toBeGreaterThan(0)
    expect(
      screen
        .getByRole("navigation", { name: "Reading route / 読書ルート" })
        .querySelectorAll("button").length,
    ).toBe(10)
  })
})
