import { BookEdition, NormalizationRevision } from "@reading-studio/contracts/source"
import { Window } from "happy-dom"
import { expect, it } from "vitest"
import { missingSource, sourceReader } from "./page.ts"

it("renders Japanese server source navigation without translating source text", async () => {
  // Given
  const edition = BookEdition.parse({
    id: "edition-1",
    title: "Original title",
    originalHash: "a".repeat(64),
    originalBlobHash: "a".repeat(64),
    format: "txt",
  })
  const normalization = NormalizationRevision.parse({
    id: "revision-1",
    editionId: "edition-1",
    editionHash: "a".repeat(64),
    parserVersion: "2",
    normalizerVersion: "2",
    coverage: "complete",
    resources: [
      {
        path: "source.txt",
        role: "main-chapter",
        status: "included",
        blocks: [{ id: "block-1", text: "Original source sentence" }],
      },
    ],
  })
  const window = new Window({ settings: { disableJavaScriptEvaluation: true } })
  try {
    // When
    window.document.write(
      String(await sourceReader({ edition, normalization, chapter: 0, span: null, locale: "ja" })),
    )
    // Then
    expect(window.document.querySelector(".reader nav h2")?.textContent).toBe("目次")
    expect(window.document.querySelector("h1")?.textContent).toBe("Original title")
    expect(window.document.getElementById("block-1")?.textContent).toContain(
      "Original source sentence",
    )
    expect(window.document.querySelector(".reader nav a")?.textContent).toBe("第1章")
  } finally {
    await window.happyDOM.close()
  }
})

it("renders Japanese missing-source recovery", async () => {
  // Given / When
  const result = String(await missingSource("ja"))
  // Then
  expect(result).toContain("参照が見つかりません")
  expect(result).toContain("資料一覧に戻る")
  expect(result).not.toContain("Missing reference")
})
