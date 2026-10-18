import { z } from "zod"
import { ArchiveError, DEFAULT_ARCHIVE_LIMITS } from "./archive-policy.ts"

export const DocumentFormat = z.enum(["epub", "docx", "txt", "pdf"])
export type DocumentFormat = z.infer<typeof DocumentFormat>
export const DOCUMENT_MEDIA = {
  epub: "application/epub+zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  pdf: "application/pdf",
} as const
export function formatForMedia(media: string): DocumentFormat | undefined {
  return DocumentFormat.options.find((format) => DOCUMENT_MEDIA[format] === media)
}
export const DOCUMENT_LIMITS = {
  txt: { bytes: 4 * 1024 * 1024, characters: 4 * 1024 * 1024 },
  docx: {
    compressedBytes: 10 * 1024 * 1024,
    decompressedBytes: 40 * 1024 * 1024,
    entries: 2000,
    entryBytes: 8 * 1024 * 1024,
  },
  pdf: {
    bytes: 10 * 1024 * 1024,
    pages: 500,
    characters: 1_000_000,
    milliseconds: 10_000,
    outputBytes: 8 * 1024 * 1024,
  },
  textCharacters: 8 * 1024 * 1024,
  blocks: 20_000,
} as const
export function inputByteLimit(format: DocumentFormat): number {
  switch (format) {
    case "epub":
      return DEFAULT_ARCHIVE_LIMITS.compressedBytes
    case "docx":
      return DOCUMENT_LIMITS.docx.compressedBytes
    case "pdf":
      return DOCUMENT_LIMITS.pdf.bytes
    case "txt":
      return DOCUMENT_LIMITS.txt.bytes
    default:
      return assertNever(format)
  }
}
export function assertNever(value: never): never {
  throw new TypeError(`Unexpected format: ${value}`)
}
export function checkTextLimit(characters: number, blocks: number): void {
  if (characters > DOCUMENT_LIMITS.textCharacters || blocks > DOCUMENT_LIMITS.blocks)
    throw new ArchiveError("limit-exceeded")
}
