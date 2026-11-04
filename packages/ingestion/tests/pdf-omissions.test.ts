import { PDFDocument, PDFName } from "pdf-lib"
import { expect, it } from "vitest"
import { normalizePdf } from "../src/normalize-pdf.ts"
import { runPdfProcess } from "../src/pdf-subprocess.ts"
import { pdfFixture } from "./document-fixtures.ts"

it("maps a native middle-page mapping failure to the existing partial omission contract", async () => {
  // Given
  const document = await PDFDocument.load(pdfFixture(["Opening", "", "Late"]))
  const page = document.getPage(1)
  const glyph = document.context.register(
    document.context.flateStream("500 0 0 0 500 700 d1 0 0 500 700 re f"),
  )
  const font = document.context.register(
    document.context.obj({
      Type: "Font",
      Subtype: "Type3",
      FontBBox: [0, 0, 500, 700],
      FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
      CharProcs: { UnmappedGlyph: glyph },
      Encoding: { Type: "Encoding", Differences: [65, PDFName.of("UnmappedGlyph")] },
      FirstChar: 65,
      LastChar: 65,
      Widths: [500],
      Resources: {},
    }),
  )
  page.node.set(PDFName.of("Resources"), document.context.obj({ Font: { F1: font } }))
  page.node.set(
    PDFName.of("Contents"),
    document.context.register(document.context.flateStream("BT /F1 12 Tf 72 700 Td (A) Tj ET")),
  )
  const bytes = Buffer.from(await document.save({ useObjectStreams: false }))
  // When
  const result = await normalizePdf(bytes)
  // Then
  expect(result.coverage).toBe("partial")
  expect(result.skipped).toEqual([
    { path: "pdf/page-2", role: "main-chapter", reason: "unicode-map-error" },
  ])
  expect(
    result.chapters.map((chapter) => chapter.blocks.map((block) => block.text).join("")),
  ).toEqual(["Opening", "", "Late"])
})
it("retains safe specific probe/invariant codes in omission receipts without source or pointer dumps", async () => {
  // Given
  const document = await PDFDocument.load(pdfFixture([""]))
  document
    .getPage(0)
    .node.set(
      PDFName.of("Contents"),
      document.context.register(
        document.context.flateStream(
          "BT /F1 12 Tf 72 700 Td (Same) Tj ET BT /F1 12 Tf 72 700 Td (Same) Tj ET",
        ),
      ),
    )
  // When
  const output = JSON.parse(
    await runPdfProcess(
      Buffer.from(await document.save({ useObjectStreams: false })),
      new URL("../src/pdf-process.mjs", import.meta.url),
    ),
  )
  // Then
  expect(output).toEqual({
    pages: [""],
    omissions: [
      {
        page: 1,
        reason: "unsupported-pdf-text",
        details: ["unexplained-text-object", "batched-object-not-whitespace"],
      },
    ],
  })
})
