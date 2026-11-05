import { PDFDict, PDFDocument, PDFName } from "pdf-lib"
import { pdfFixture } from "./document-fixtures.ts"

export const actualTextHex = (text: string) =>
  `FEFF${Buffer.from(text, "utf16le").swap16().toString("hex")}`
export async function contentPdf(content: string) {
  const document = await PDFDocument.load(pdfFixture([""]))
  document
    .getPage(0)
    .node.set(
      PDFName.of("Contents"),
      document.context.register(document.context.flateStream(content)),
    )
  return Buffer.from(await document.save({ useObjectStreams: false }))
}
export async function rtlPdf() {
  const document = await PDFDocument.load(pdfFixture(["ABCD"]))
  const page = document.getPage(0)
  const resources = document.context.lookup(page.node.get(PDFName.of("Resources")))
  if (!(resources instanceof PDFDict)) throw new TypeError("Missing resources")
  const fonts = document.context.lookup(resources.get(PDFName.of("Font")))
  if (!(fonts instanceof PDFDict)) throw new TypeError("Missing fonts")
  const font = document.context.lookup(fonts.get(PDFName.of("F1")))
  if (!(font instanceof PDFDict)) throw new TypeError("Missing font")
  font.set(
    PDFName.of("ToUnicode"),
    document.context.register(
      document.context.flateStream(
        "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Test) /Ordering (Unicode) /Supplement 0 >> def /CMapName /RTLTest def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 4 beginbfchar <41> <05D0> <42> <0028> <43> <05D1> <44> <0029> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end",
      ),
    ),
  )
  return Buffer.from(await document.save({ useObjectStreams: false }))
}
export async function softHyphenPdf() {
  const document = await PDFDocument.load(
    await contentPdf("BT /F1 12 Tf 14 TL 72 700 Td (well-) Tj T* (known) Tj ET"),
  )
  const page = document.getPage(0)
  const resources = document.context.lookup(page.node.get(PDFName.of("Resources")))
  if (!(resources instanceof PDFDict)) throw new TypeError("Missing resources")
  const fonts = document.context.lookup(resources.get(PDFName.of("Font")))
  if (!(fonts instanceof PDFDict)) throw new TypeError("Missing fonts")
  const font = document.context.lookup(fonts.get(PDFName.of("F1")))
  if (!(font instanceof PDFDict)) throw new TypeError("Missing font")
  font.set(
    PDFName.of("ToUnicode"),
    document.context.register(
      document.context.flateStream(
        "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Test) /Ordering (Unicode) /Supplement 0 >> def /CMapName /SoftHyphenTest def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <2D> <00AD> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end",
      ),
    ),
  )
  return Buffer.from(await document.save({ useObjectStreams: false }))
}
