export class PdfExportError extends Error {
  override readonly name = "PdfExportError"
  constructor(readonly reason: "timeout" | "busy" | "limit" | "font" | "readiness" | "network") {
    super(`PDF export failed: ${reason}`)
  }
}

export const pdfLimits = Object.freeze({
  timeoutMs: 60_000,
  assetBytes: 8 * 1024 * 1024,
  htmlBytes: 24 * 1024 * 1024,
  pdfBytes: 24 * 1024 * 1024,
  nodes: 20_000,
  pages: 200,
})

export async function withPdfDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = pdfLimits.timeoutMs,
): Promise<T> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > pdfLimits.timeoutMs)
    throw new PdfExportError("limit")
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new PdfExportError("timeout")
      controller.abort(error)
      reject(error)
    }, timeoutMs)
  })
  try {
    return await Promise.race([run(controller.signal), deadline])
  } finally {
    clearTimeout(timer)
  }
}
