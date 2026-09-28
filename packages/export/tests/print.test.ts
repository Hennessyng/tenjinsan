import { Window } from "happy-dom"
import { describe, expect, it } from "vitest"
import { exportPrint, printReadiness } from "../print/index.ts"
import { approved } from "./fixture.ts"

describe("approved print composition", () => {
  it("renders separate static content when given an approved revision", async () => {
    // Given
    const window = new Window()
    // When
    window.document.write(await exportPrint(approved()))
    // Then
    expect(window.document.querySelector("[data-print-document]")).not.toBeNull()
    expect(window.document.querySelectorAll("[data-state]")).toHaveLength(28)
    expect(
      window.document.querySelectorAll("script, canvas, input, textarea, button"),
    ).toHaveLength(0)
    expect(window.document.querySelectorAll("[data-static-view]")).toHaveLength(4)
    expect(printReadiness(approved(), window.document).ready).toBe(true)
    await window.happyDOM.close()
  })

  for (const selector of [
    '[data-state="perspective:viewpoint:second"]',
    '[data-static-view="spatial:viewpoint:second"]',
    '[data-state="compare:variant:second"]',
    "#scene-compare [data-scene-mark]",
    '[data-static-view="spatial:viewpoint:second"] [data-static-object="1"]',
    "#scene-process [data-loop-arrow]",
    '[data-state="attention:practice:reflect:guess"] .pair [lang="ja"]',
  ]) {
    it(`blocks readiness when a complete manifest conceals missing ${selector}`, async () => {
      // Given: keep declared inventory metadata; damage only the actual print DOM.
      const window = new Window()
      window.document.write(await exportPrint(approved()))
      const target = window.document.querySelector(selector)
      expect(target).not.toBeNull()
      target?.remove()
      // When
      const result = printReadiness(approved(), window.document)
      // Then
      expect(result.ready).toBe(false)
      expect(result.issues.length).toBeGreaterThan(0)
      await window.happyDOM.close()
    })
  }

  it("rejects a projection without approval", async () => {
    // Given
    const projection = approved().projection
    // When / Then
    await expect(exportPrint(projection)).rejects.toThrow()
  })

  it("rejects an approval manifest that omits a trusted viewpoint requirement", async () => {
    const revision = approved()
    await expect(
      exportPrint({
        ...revision,
        approval: {
          ...revision.approval,
          requiredStateIds: revision.approval.requiredStateIds.filter(
            (id) => id !== "perspective:viewpoint:second",
          ),
        },
      }),
    ).rejects.toThrow()
  })

  for (const change of ["replace", "hide", "duplicate", "move-outside-print"] as const) {
    it(`blocks readiness when approved rationale is ${change}`, async () => {
      const window = new Window()
      window.document.write(await exportPrint(approved()))
      const state = window.document.querySelector('[data-state="compare:variant:second"]')
      const rationale = state?.querySelector('.pair > [lang="en"]')
      if (!state || !rationale) throw new TypeError("Missing test target")
      switch (change) {
        case "replace":
          rationale.textContent = "Incorrect rationale"
          break
        case "hide":
          rationale.setAttribute("hidden", "")
          break
        case "duplicate":
          rationale.parentElement?.append(rationale.cloneNode(true))
          break
        case "move-outside-print":
          window.document.body.append(state)
          break
      }
      expect(printReadiness(approved(), window.document).ready).toBe(false)
      await window.happyDOM.close()
    })
  }
})
