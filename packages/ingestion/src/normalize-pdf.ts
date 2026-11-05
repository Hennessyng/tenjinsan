import { ArchiveError } from "./archive-policy.ts"
import type { ExtractedDocument } from "./document-model.ts"
import { NormalizationError } from "./normalize-xml.ts"
import { PdfResult } from "./pdf/result.ts"
import { runPdfProcess } from "./pdf-subprocess.ts"

export async function normalizePdf(bytes: Buffer): Promise<ExtractedDocument> {
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
    throw new NormalizationError("invalid-pdf")
  const output = await runPdfProcess(bytes, new URL("./pdf-process.mjs", import.meta.url))
  const result = PdfResult.parse(JSON.parse(output))
  if ("error" in result) {
    if (result.error === "limit-exceeded") throw new ArchiveError("limit-exceeded")
    throw new NormalizationError(result.error)
  }
  const omissionReasons = new Map<string, string>(
    result.omissions?.map(
      (omission) =>
        [`pdf/page-${omission.page}`, [omission.reason, ...omission.details].join(":")] as const,
    ),
  )
  const chapters = result.pages.map((text, index) => ({
    path: `pdf/page-${index + 1}`,
    role: "main-chapter" as const,
    blocks: text.trim()
      ? [{ text, locator: { kind: "pdf" as const, page: index + 1 }, pageLabel: String(index + 1) }]
      : [],
  }))
  const skipped = chapters
    .filter((chapter) => !chapter.blocks.length)
    .map((chapter) => ({
      path: chapter.path,
      role: "main-chapter" as const,
      reason: omissionReasons.get(chapter.path) ?? "no-selectable-text",
    }))
  return { chapters, skipped, pages: [], coverage: skipped.length ? "partial" : "complete" }
}
