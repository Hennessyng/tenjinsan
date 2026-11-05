import { PDFDocument, PDFName } from "pdf-lib"
import { expect, it } from "vitest"
import { normalizePdf } from "../src/normalize-pdf.ts"
import { pdfFixture } from "./document-fixtures.ts"

it.each([
  { pages: 1, lines: 40 },
  { pages: 2, lines: 20 },
])(
  "keeps $pages prose pages complete beyond the former document probe cap",
  async ({ pages, lines }) => {
    // Given
    const document = await PDFDocument.load(pdfFixture(Array.from({ length: pages }, () => "")))
    const text = Array.from(
      { length: lines },
      (_, index) => `Line ${index}: ordinary canal records.`,
    )
    const content = `BT /F1 11 Tf 14 TL 72 760 Td ${text.map((line) => `(${line}) Tj ( ) Tj T*`).join("\n")} ET`
    for (const page of document.getPages())
      page.node.set(
        PDFName.of("Contents"),
        document.context.register(document.context.flateStream(content)),
      )
    // When
    const result = await normalizePdf(Buffer.from(await document.save({ useObjectStreams: false })))
    // Then
    expect(result.coverage).toBe("complete")
    expect(result.skipped).toEqual([])
    expect(
      result.chapters.map((chapter) => chapter.blocks.map((block) => block.text).join("")),
    ).toEqual(Array.from({ length: pages }, () => text.join("\n")))
  },
)
