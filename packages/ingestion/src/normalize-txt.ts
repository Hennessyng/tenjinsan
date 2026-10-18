import type { ExtractedDocument } from "./document-model.ts"
import { NormalizationError } from "./normalize-xml.ts"

export function normalizeTxt(bytes: Uint8Array): ExtractedDocument {
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch (error) {
    if (error instanceof TypeError) throw new NormalizationError("invalid-encoding")
    throw error
  }
  if (text.includes("\0")) throw new NormalizationError("invalid-encoding")
  return {
    chapters: [
      {
        path: "document.txt",
        role: "main-chapter",
        blocks: [{ text, locator: { kind: "txt", startLine: 1, start: 0 } }],
      },
    ],
    skipped: [],
    coverage: "complete",
    pages: [],
  }
}
