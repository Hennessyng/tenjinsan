import { mkdtemp, open, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NormalizationRevision } from "@reading-studio/contracts"
import { expect, it } from "vitest"
import { DOCUMENT_LIMITS } from "../src/document-policy.ts"
import { prepareSourceDocument } from "../src/source-document.ts"
import { docxEntries, pdfFixture, WORD } from "./document-fixtures.ts"
import { zipFixture } from "./fixtures.ts"

async function prepare(bytes: Uint8Array, format: string) {
  const directory = await mkdtemp(join(tmpdir(), "document-safety-"))
  try {
    const path = join(directory, "original")
    await writeFile(path, bytes)
    await using file = await open(path, "r")
    return await prepareSourceDocument(file, { title: "Safety fixture", format })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

it("rejects protected PDFs without requesting a password", async () => {
  // Given
  const encrypted = `/Encrypt << /Filter /Standard /V 1 /R 2 /O <${"00".repeat(32)}> /U <${"00".repeat(32)}> /P -4 >> /ID [<00112233><00112233>]`
  // When / Then
  await expect(prepare(pdfFixture(["Encrypted"], encrypted), "pdf")).rejects.toMatchObject({
    code: "protected-document",
  })
})
it("rejects DOCX editing protection instead of bypassing it", async () => {
  // Given
  const bytes = zipFixture([
    ...docxEntries,
    {
      name: "word/settings.xml",
      text: `<w:settings xmlns:w="${WORD}"><w:documentProtection w:enforcement="1"/></w:settings>`,
    },
  ])
  // When / Then
  await expect(prepare(bytes, "docx")).rejects.toMatchObject({ code: "protected-document" })
})
it("rejects corrupt PDF as a safe normalization failure", async () => {
  // Given / When / Then
  await expect(prepare(Buffer.from("%PDF-1.7\nnot a PDF"), "pdf")).rejects.toMatchObject({
    code: "invalid-pdf",
  })
})
it("enforces PDF page bounds before extracting beyond the policy", async () => {
  // Given / When / Then
  await expect(
    prepare(pdfFixture(Array.from({ length: DOCUMENT_LIMITS.pdf.pages + 1 }, () => "x")), "pdf"),
  ).rejects.toMatchObject({ code: "limit-exceeded" })
})
it("accepts the exact TXT byte boundary and refuses one byte more", async () => {
  // Given / When
  const result = await prepare(Buffer.alloc(DOCUMENT_LIMITS.txt.bytes, 120), "txt")
  // Then
  expect(
    result.normalization.resources
      .flatMap((r) => (r.status === "included" ? r.blocks : []))
      .reduce((sum, b) => sum + b.text.length, 0),
  ).toBe(DOCUMENT_LIMITS.txt.bytes)
  await expect(
    prepare(Buffer.alloc(DOCUMENT_LIMITS.txt.bytes + 1, 120), "txt"),
  ).rejects.toMatchObject({ code: "limit-exceeded" })
})
it("retains XML resource ceilings for DOCX parts", async () => {
  // Given
  const bytes = zipFixture(
    docxEntries.map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            text: `<w:document xmlns:w="${WORD}">${"<w:p/>".repeat(100_000)}</w:document>`,
          }
        : entry,
    ),
  )
  // When / Then
  await expect(prepare(bytes, "docx")).rejects.toMatchObject({ code: "unsafe-xml" })
})

it("reports text-bearing custom DOCX parts outside word instead of silently counting them", async () => {
  // Given
  const bytes = zipFixture([
    ...docxEntries,
    { name: "customXml/item1.xml", text: "<custom>Unextracted custom prose</custom>" },
  ])
  // When
  const document = await prepare(bytes, "docx")
  // Then
  expect(document.normalization.omissions).toContainEqual({
    path: "customXml/item1.xml",
    reason: "unsupported-part",
  })
})

it("rejects a complete extraction claim when its persisted inventory contains omissions", () => {
  // Given / When
  const result = NormalizationRevision.safeParse({
    id: "normalization-test",
    editionId: "edition-test",
    editionHash: "a".repeat(64),
    parserVersion: "2",
    normalizerVersion: "2",
    coverage: "complete",
    resources: [
      {
        path: "document.txt",
        role: "main-chapter",
        status: "included",
        blocks: [{ id: "block-test", text: "Retained" }],
      },
    ],
    omissions: [{ path: "omitted", reason: "unsupported-part" }],
  })
  // Then
  expect(result.success).toBe(false)
})
