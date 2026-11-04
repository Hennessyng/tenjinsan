import { expect, it } from "vitest"
import { normalizePdf } from "../src/normalize-pdf.ts"
import { actualTextHex, contentPdf, rtlPdf, softHyphenPdf } from "./pdf-native-fixtures.ts"

it("qualifies unmarked RTL whose public text order/mirroring is not verified", async () => {
  // Given
  const bytes = await rtlPdf()
  // When
  const result = await normalizePdf(bytes)
  // Then
  expect(
    result.chapters.flatMap((chapter) => chapter.blocks.map((block) => block.text)).join(""),
  ).toBe("")
  expect(result.coverage).toBe("partial")
  expect(result.skipped[0]?.reason).toBe("unsupported-pdf-text:unverified-rtl-transformation")
})
it("preserves an observed drawn line-end hyphen and layout break without dehyphenating", async () => {
  // Given
  const bytes = await contentPdf("BT /F1 12 Tf 14 TL 72 700 Td (well-) Tj T* (known) Tj ET")
  // When
  const result = await normalizePdf(bytes)
  // Then
  expect(result.chapters[0]?.blocks[0]?.text).toBe("well-\nknown")
  expect(result.coverage).toBe("complete")
})
it("preserves an intentional soft hyphen from the source mapping, not a guessed ASCII dash", async () => {
  const result = await normalizePdf(await softHyphenPdf())
  expect(result.chapters[0]?.blocks[0]?.text).toBe("well\u00ad\nknown")
  expect(result.coverage).toBe("complete")
})
it("preserves separately proved hyphens across two successive source lines", async () => {
  const bytes = await contentPdf(
    "BT /F1 12 Tf 14 TL 72 700 Td (co-) Tj T* (operate well-) Tj T* (known) Tj ET",
  )
  const result = await normalizePdf(bytes)
  expect(result.chapters[0]?.blocks[0]?.text).toBe("co-\noperate well-\nknown")
  expect(result.coverage).toBe("complete")
})
it("preserves an already-literal fragmented hyphen without assuming it needs repair", async () => {
  const bytes = await contentPdf("BT /F1 12 Tf 14 TL 72 700 Td (well) Tj (-) Tj T* (known) Tj ET")
  const result = await normalizePdf(bytes)
  expect(result.coverage).toBe("complete")
  expect(result.chapters[0]?.blocks[0]?.text).toBe("well-\nknown")
})
it("explicitly drops the whole page when the deterministic hyphen probe cap is exceeded", async () => {
  const content = `BT /F1 12 Tf 14 TL 72 700 Td ${"(word-) Tj T* ".repeat(17)}(known) Tj ET`
  const result = await normalizePdf(await contentPdf(content))
  expect(result.coverage).toBe("partial")
  expect(result.chapters[0]?.blocks).toEqual([])
  expect(result.skipped[0]?.reason).toBe("unsupported-pdf-text:hyphen-probe-limit")
})
it("retains an ordinary same-line hyphen without normalization", async () => {
  // Given / When
  const result = await normalizePdf(await contentPdf("BT /F1 12 Tf 72 700 Td (well-known) Tj ET"))
  // Then
  expect(result.chapters[0]?.blocks[0]?.text).toBe("well-known")
  expect(result.coverage).toBe("complete")
})
it("uses authoritative RTL ActualText without mirroring its literal parentheses", async () => {
  // Given
  const text = "שלום (אב)"
  const bytes = await contentPdf(
    `BT /F1 12 Tf 72 700 Td /Span << /ActualText <${actualTextHex(text)}> >> BDC (X) Tj EMC ET`,
  )
  // When
  const result = await normalizePdf(bytes)
  // Then
  expect(result.chapters[0]?.blocks[0]?.text).toBe(text)
})
