import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { BookEdition, NormalizationRevision } from "@reading-studio/contracts"
import {
  docxFixture,
  epubEntries,
  pdfFixture,
  zipFixture,
} from "@reading-studio/ingestion/test-support"
import { afterAll, beforeAll, expect, it } from "vitest"
import { z } from "zod"
import { uploadHarness } from "./testing/upload-harness.ts"

let harness: Awaited<ReturnType<typeof uploadHarness>>
beforeAll(async () => {
  harness = await uploadHarness()
})
afterAll(async () => {
  await harness?.close()
})
const cases = [
  { format: "epub", media: "application/epub+zip", bytes: zipFixture(epubEntries) },
  {
    format: "docx",
    media: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: docxFixture(),
  },
  { format: "txt", media: "text/plain", bytes: Buffer.from("Early 日本語\r\n\r\nMiddle\nFinal") },
  { format: "pdf", media: "application/pdf", bytes: pdfFixture(["Early", "", "Final"]) },
] as const

it.each(cases)(
  "imports $format through production intake and exposes persisted locators to the reader",
  async ({ format, media, bytes }) => {
    // Given / When
    const response = await fetch(`${harness.origin}/api/imports/upload`, {
      method: "POST",
      headers: { ...harness.headers, "content-type": media },
      body: bytes,
    })
    // Then
    expect(response.status).toBe(202)
    const receipt = z
      .object({
        id: z.string(),
        sha256: z.string(),
        format: z.string(),
        state: z.literal("queued"),
      })
      .parse(await response.json())
    expect(await readFile(join(harness.root, receipt.id, `original.${format}`))).toEqual(bytes)
    const library = await fetch(`${harness.origin}/api/source-library`)
    const documents = z
      .object({
        documents: z.array(
          z.object({ edition: BookEdition, normalization: NormalizationRevision }),
        ),
      })
      .parse(await library.json()).documents
    const document = documents.find((item) => item.edition.originalHash === receipt.sha256)
    expect(document?.edition.format).toBe(format)
    const reader = await fetch(`${harness.origin}/api/source-reader/${document?.normalization.id}`)
    expect(reader.status).toBe(200)
    expect(
      document?.normalization.resources.some(
        (r) => r.status === "included" && r.blocks.some((b) => b.text),
      ),
    ).toBe(true)
  },
)

it.each([
  {
    media: "application/epub+zip",
    bytes: zipFixture(
      epubEntries.map((entry) =>
        entry.name.endsWith("package.opf") ? { ...entry, text: "<package/>" } : entry,
      ),
    ),
    code: "invalid-package",
  },
  {
    media: "application/epub+zip",
    bytes: zipFixture(
      epubEntries.map((entry) =>
        entry.name.endsWith("package.opf")
          ? {
              ...entry,
              text: entry.text.replace(
                'href="chapter.xhtml"',
                'href="https://example.invalid/private"',
              ),
            }
          : entry,
      ),
    ),
    code: "unsafe-reference",
  },
  { media: "text/plain", bytes: Buffer.from([0xc3, 0x28]), code: "invalid-encoding" },
  { media: "text/plain", bytes: Buffer.from(" \n"), code: "empty-text" },
  { media: "application/pdf", bytes: pdfFixture([""]), code: "empty-text" },
  {
    media: "application/epub+zip",
    bytes: zipFixture(
      epubEntries.map((entry) =>
        entry.name.endsWith("chapter.xhtml")
          ? { ...entry, text: '<!DOCTYPE html SYSTEM "file:///private/TEN18"><html/>' }
          : entry,
      ),
    ),
    code: "unsafe-xml",
  },
  {
    media: "application/epub+zip",
    bytes: zipFixture(
      epubEntries.map((entry) =>
        entry.name.endsWith("chapter.xhtml") ? { ...entry, text: "<broken>" } : entry,
      ),
    ),
    code: "invalid-xml",
  },
])("returns safe 422 $code without creating a source or study", async ({ media, bytes, code }) => {
  // Given
  const before = harness.sourceStorage.counts()
  // When
  const response = await fetch(`${harness.origin}/api/imports/upload`, {
    method: "POST",
    headers: { ...harness.headers, "content-type": media },
    body: bytes,
  })
  // Then
  expect(response.status).toBe(422)
  expect(await response.json()).toEqual({ error: code })
  expect(harness.sourceStorage.counts()).toEqual(before)
})

it("preserves a server-error classification for an unexpected intake infrastructure failure", async () => {
  // Given
  const failing = await uploadHarness({
    onAccepted: async () => {
      throw new TypeError("synthetic-infrastructure-failure")
    },
  })
  try {
    // When
    const response = await fetch(`${failing.origin}/api/imports/upload`, {
      method: "POST",
      headers: failing.headers,
      body: zipFixture(epubEntries),
    })
    // Then
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain("synthetic-infrastructure-failure")
    expect(failing.sourceStorage.counts()).toMatchObject({ editions: 0, studies: 0 })
  } finally {
    await failing.close()
  }
})
