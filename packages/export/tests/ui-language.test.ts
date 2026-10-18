import { Window } from "happy-dom"
import { expect, it } from "vitest"
import { exportHtml } from "../html/index.ts"
import { exportPrint, printReadiness } from "../print/index.ts"
import { approved } from "./fixture.ts"

it.each(["en", "ja", "en+ja"] as const)(
  "fixes HTML and print chrome to %s without changing approved content",
  async (ui) => {
    // Given
    const revision = approved()
    const window = new Window({ settings: { disableJavaScriptEvaluation: true } })
    try {
      // When
      const html = await exportHtml(revision, undefined, ui)
      const print = await exportPrint(revision, undefined, ui)
      // Then
      window.document.write(html)
      const legend = window.document.querySelector(".language-controls legend")
      const locales = [...(legend?.querySelectorAll("[data-ui-copy]") ?? [])].map((node) =>
        node.getAttribute("lang"),
      )
      expect(locales).toEqual(ui === "en+ja" ? ["en", "ja"] : [ui])
      expect(
        JSON.parse(window.document.getElementById("publication-data")?.textContent ?? "null"),
      ).toEqual(revision.projection)
      expect(window.document.querySelector('select[name="exportUi"]')).toBeNull()
      expect(
        window.document.querySelector("[data-private-language-runtime],#private-language-controls"),
      ).toBeNull()
      expect(html).not.toContain("tenjinsan.ui-language")
      window.document.open()
      window.document.write(print)
      expect(window.document.querySelector("#print-sources > h2")?.textContent).toBe(
        ui === "en" ? "Sources appendix" : ui === "ja" ? "出典付録" : "Sources appendix / 出典付録",
      )
      expect(printReadiness(revision, window.document).ready).toBe(true)
      expect(window.document.querySelectorAll("script,input,textarea,canvas")).toHaveLength(0)
    } finally {
      await window.happyDOM.close()
    }
  },
)

it("defaults a new HTML export to English independently of any reader preference", async () => {
  // Given / When
  const window = new Window({ settings: { disableJavaScriptEvaluation: true } })
  try {
    window.document.write(await exportHtml(approved()))
    // Then
    expect(window.document.querySelector(".language-controls legend")?.textContent).toBe(
      "Reading language",
    )
  } finally {
    await window.happyDOM.close()
  }
})
