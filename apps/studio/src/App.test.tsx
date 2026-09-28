// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { App } from "./App"

describe("studio shell", () => {
  it("names the reading studio and pairs English with Japanese", () => {
    render(<App />)

    expect(screen.getByRole("heading", { level: 1, name: /reading studio/i })).toBeDefined()
    expect(screen.getAllByText(/読書スタジオ/, { selector: "[lang='ja']" }).length).toBeGreaterThan(
      0,
    )
  })
})
