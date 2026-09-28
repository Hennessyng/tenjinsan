import { PublicationRevision } from "@reading-studio/contracts"
import type { AssetResolver } from "../html/assets.ts"
import { pdfDocument } from "./document.ts"
import { PdfExportError, pdfLimits, withPdfDeadline } from "./policy.ts"
import { renderPdf } from "./render.ts"

export { PdfExportError } from "./policy.ts"

let active = false

export async function exportPdf(
  input: unknown,
  options: {
    readonly timeoutMs?: number
    readonly resolveAsset?: AssetResolver
    readonly chromiumExecutablePath?: string
  } = {},
): Promise<Uint8Array> {
  if (active) throw new PdfExportError("busy")
  if (Buffer.byteLength(JSON.stringify(input)) > pdfLimits.htmlBytes)
    throw new PdfExportError("limit")
  const revision = PublicationRevision.parse(input)
  active = true
  try {
    return await withPdfDeadline(async (signal) => {
      const html = await pdfDocument(revision, options.resolveAsset)
      signal.throwIfAborted()
      return renderPdf(revision, html, {
        signal,
        ...(options.chromiumExecutablePath
          ? { executablePath: options.chromiumExecutablePath }
          : {}),
      })
    }, options.timeoutMs)
  } finally {
    active = false
  }
}
