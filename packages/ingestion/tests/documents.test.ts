import { mkdtemp, open, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { prepareSourceDocument } from "../src/source-document.ts"
import { docxEntries, docxFixture, pdfFixture } from "./document-fixtures.ts"
import { epubEntries, zipFixture } from "./fixtures.ts"

async function prepare(bytes: Uint8Array, format: string, position = 0) {
  const directory = await mkdtemp(join(tmpdir(), "documents-"))
  try {
    const path = join(directory, "original")
    await writeFile(path, bytes)
    await using file = await open(path, "r")
    if (position) await file.read(Buffer.alloc(position), 0, position, null)
    return await prepareSourceDocument(file, { title: "Synthetic", format })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

it.each([
  { format: "txt", bytes: Buffer.from("Early\nMiddle\nFinal") },
  { format: "pdf", bytes: pdfFixture(["Early", "Final"]) },
])(
  "reads the entire $format independently of the caller's file cursor",
  async ({ format, bytes }) => {
    // Given
    const expected = await prepare(bytes, format)
    // When
    const actual = await prepare(bytes, format, 3)
    // Then
    expect(actual).toEqual(expected)
  },
)

it("preserves exact UTF-8 text and line ordering when a long TXT is imported", async () => {
  // Given
  const text = "Early 日本語\r\n\r\n" + "middle ".repeat(15_000) + "\nFinal\n"
  // When
  const result = await prepare(Buffer.from(text), "txt")
  const blocks = result.normalization.resources.flatMap((r) =>
    r.status === "included" ? r.blocks : [],
  )
  // Then
  expect(blocks.map((b) => b.text).join("")).toBe(text)
  expect(blocks.every((b) => b.text.length <= 100_000)).toBe(true)
  expect(blocks[0]).toMatchObject({ locator: { kind: "txt", startLine: 1, start: 0 } })
})

it.each([Buffer.from([0xff, 0xfe, 0x61, 0]), Buffer.from([0xc3, 0x28])])(
  "rejects unsupported TXT encoding",
  async (bytes) => {
    // Given / When / Then
    await expect(prepare(bytes, "txt")).rejects.toMatchObject({ code: "invalid-encoding" })
  },
)

it("retains DOCX headings, lists, tables and additional parts with visible omissions", async () => {
  // Given / When
  const result = await prepare(docxFixture(), "docx")
  const resources = result.normalization.resources
  const body = resources[0]
  // Then
  expect(body?.status === "included" && body.blocks.map((b) => b.text)).toEqual([
    "Early heading",
    "Middle list",
    "Final cell",
  ])
  expect(body?.status === "included" && body.blocks[0]).toMatchObject({
    heading: 1,
    locator: { kind: "docx", part: "word/document.xml", paragraph: 1 },
  })
  expect(body?.status === "included" && body.blocks[1]).toMatchObject({ structure: "list-item" })
  expect(body?.status === "included" && body.blocks[2]).toMatchObject({ structure: "table-cell" })
  expect(resources[1]?.status === "included" && resources[1].blocks[0]?.text).toBe("Header text")
  expect(result.normalization).toMatchObject({
    coverage: "partial",
    omissions: [{ path: "word/unsupported.xml", reason: "unsupported-part" }],
  })
})

it("retains actual PDF page indices and reports textless pages without OCR", async () => {
  // Given / When
  const result = await prepare(pdfFixture(["Early", "", "Final"]), "pdf")
  // Then
  expect(result.normalization.coverage).toBe("partial")
  expect(
    result.normalization.resources.map((r) =>
      r.status === "included" ? r.blocks[0]?.locator : r.reason,
    ),
  ).toEqual([{ kind: "pdf", page: 1 }, "no-selectable-text", { kind: "pdf", page: 3 }])
})

it.each([
  ["txt", Buffer.from(" \n\t")],
  ["pdf", pdfFixture([""])],
])("rejects unusable %s instead of persisting an empty source", async (format, bytes) => {
  // Given / When / Then
  await expect(prepare(bytes, format)).rejects.toMatchObject({ code: "empty-text" })
})

it("rejects DOCX external relationships before any document-directed I/O", async () => {
  // Given
  const bytes = zipFixture([
    ...docxEntries,
    {
      name: "word/_rels/document.xml.rels",
      text: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="evil" TargetMode="External" Target="http://127.0.0.1:1/x"/></Relationships>',
    },
  ])
  // When / Then
  await expect(prepare(bytes, "docx")).rejects.toMatchObject({ code: "unsafe-reference" })
})

it("retains EPUB structure and included-resource omissions in persisted normalization", async () => {
  // Given
  const bytes = zipFixture(
    epubEntries.map((entry) =>
      entry.name === "book/chapter.xhtml"
        ? { ...entry, text: entry.text.replace("</body>", "<object>Omitted</object></body>") }
        : entry,
    ),
  )
  // When
  const result = await prepare(bytes, "epub")
  // Then
  expect(result.normalization).toMatchObject({
    coverage: "partial",
    omissions: [{ path: "book/chapter.xhtml", reason: "removed:object" }],
  })
  const first = result.normalization.resources[0]
  expect(first?.status === "included" && first.blocks[0]?.heading).toBe(1)
})
