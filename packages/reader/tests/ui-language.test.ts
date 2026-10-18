import { Window } from "happy-dom"
import { expect, it } from "vitest"
import { readerDocument } from "../src/index.ts"
import { lessons } from "./fixtures.ts"

it.each([
  ["en", "Reading language", false],
  ["ja", "本文の表示言語", false],
  ["en+ja", "Reading language", true],
] as const)(
  "fixes lesson-control labels independently of lesson content in %s UI",
  async (ui, legend, paired) => {
    // Given
    const window = new Window({ settings: { disableJavaScriptEvaluation: true } })
    try {
      // When
      window.document.write(String(await readerDocument(lessons[0], { ui })))
      // Then
      const controls = window.document.querySelector(".language-controls")
      expect(controls?.querySelector("legend")?.textContent).toContain(legend)
      expect(controls?.querySelectorAll('input[name="reader-language"]')).toHaveLength(3)
      expect(controls?.querySelector('input[value="paired"]')?.hasAttribute("checked")).toBe(true)
      const text = controls?.querySelector("legend")?.textContent ?? ""
      if (ui === "en") expect(text).not.toContain("本文の表示言語")
      if (ui === "ja") expect(text).not.toContain("Reading language")
      if (paired) expect(text).toContain("本文の表示言語")
      const description =
        window.document.querySelector('meta[name="description"]')?.getAttribute("content") ?? ""
      if (ui === "ja") {
        expect(description).toBe("対訳の本文、すべての学習解説と出典ノートを含む読書用コピー。")
        expect(description).not.toContain("A bilingual reading copy")
      }
      if (paired) expect(description).toContain("対訳の本文")
      expect(window.document.querySelectorAll("[data-ui-copy]").length).toBeGreaterThan(0)
      const skip = window.document.querySelector('a[href="#reading"]')?.textContent ?? ""
      if (ui === "ja") {
        expect(skip).toBe("本文へ")
        expect(window.document.querySelector(".contents")?.getAttribute("aria-label")).toBe("目次")
      }
      if (ui === "en") expect(skip).toBe("Skip to lesson")
      expect(window.document.body.textContent).toContain(lessons[0]?.title.en)
      expect(window.document.body.textContent).toContain(lessons[0]?.title.ja)
    } finally {
      await window.happyDOM.close()
    }
  },
)
