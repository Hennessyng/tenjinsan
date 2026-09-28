import { z } from "zod"

export const DEFAULT_ARCHIVE_LIMITS = {
  compressedBytes: 50 * 1024 * 1024,
  decompressedBytes: 200 * 1024 * 1024,
  entries: 5000,
  entryBytes: 20 * 1024 * 1024,
} as const

export const archiveLimitsSchema = z
  .object({
    compressedBytes: z.number().int().positive().max(DEFAULT_ARCHIVE_LIMITS.compressedBytes),
    decompressedBytes: z.number().int().positive().max(DEFAULT_ARCHIVE_LIMITS.decompressedBytes),
    entries: z.number().int().positive().max(DEFAULT_ARCHIVE_LIMITS.entries),
    entryBytes: z.number().int().positive().max(DEFAULT_ARCHIVE_LIMITS.entryBytes),
  })
  .readonly()
export type ArchiveLimits = z.infer<typeof archiveLimitsSchema>

export class ArchiveError extends Error {
  override readonly name = "ArchiveError"
  constructor(
    readonly code:
      | "limit-exceeded"
      | "unsafe-path"
      | "unsafe-root"
      | "invalid-archive"
      | "invalid-epub"
      | "encrypted-content"
      | "invalid-encryption",
    options?: ErrorOptions,
  ) {
    super(code, options)
  }
}

export function safeEntryPath(name: string): string {
  const path = name.endsWith("/") ? name.slice(0, -1) : name
  if (
    !path ||
    /[\\:%?#]/u.test(path) ||
    [...path].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new ArchiveError("unsafe-path")
  }
  return path
}
