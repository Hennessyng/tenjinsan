import { zipFixture } from "./fixtures.ts"

export const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
export const docxEntries = [
  {
    name: "[Content_Types].xml",
    text: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  },
  {
    name: "_rels/.rels",
    text: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  },
  {
    name: "word/document.xml",
    text: `<w:document xmlns:w="${WORD}"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Early heading</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Middle list</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Final cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
  },
  {
    name: "word/header1.xml",
    text: `<w:hdr xmlns:w="${WORD}"><w:p><w:r><w:t>Header text</w:t></w:r></w:p></w:hdr>`,
  },
  {
    name: "word/unsupported.xml",
    text: `<w:custom xmlns:w="${WORD}"><w:t>Omitted custom text</w:t></w:custom>`,
  },
] as const
export const docxFixture = () => zipFixture(docxEntries)

export function pdfFixture(pages: readonly string[], trailer = ""): Buffer<ArrayBuffer> {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...pages.flatMap((text, index) => {
      const content = text ? `BT /F1 12 Tf 72 700 Td (${text}) Tj ET` : ""
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
        `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
      ]
    }),
  ]
  let text = "%PDF-1.7\n"
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text))
    text += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(text)
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`
  text += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")
  text += `trailer\n<< /Size ${offsets.length} /Root 1 0 R ${trailer} >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(text)
}
