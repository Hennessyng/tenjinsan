import { z } from "zod"
import { ArchiveError } from "./archive-policy.ts"
import type { ExtractedDocument } from "./document-model.ts"
import { DOCUMENT_LIMITS } from "./document-policy.ts"
import { NormalizationError } from "./normalize-xml.ts"
import { runPdfProcess } from "./pdf-subprocess.ts"

const Result = z.union([
  z.strictObject({ pages: z.array(z.string()).max(DOCUMENT_LIMITS.pdf.pages) }),
  z.strictObject({ error: z.enum(["limit-exceeded", "protected-document", "invalid-pdf"]) }),
])
export async function normalizePdf(bytes: Buffer): Promise<ExtractedDocument> {
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
    throw new NormalizationError("invalid-pdf")
  const output = await runPdfProcess(bytes, new URL("./pdf-process.mjs", import.meta.url))
  const result = Result.parse(JSON.parse(output))
  if ("error" in result) {
    if (result.error === "limit-exceeded") throw new ArchiveError("limit-exceeded")
    throw new NormalizationError(result.error)
  }
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
      reason: "no-selectable-text",
    }))
  return { chapters, skipped, pages: [], coverage: skipped.length ? "partial" : "complete" }
}
