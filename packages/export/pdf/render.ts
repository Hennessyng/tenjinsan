import { homedir, tmpdir } from "node:os"
import type { PublicationRevision } from "@reading-studio/contracts"
import { PDFDocument } from "pdf-lib"
import { chromium } from "playwright"
import { PdfExportError, pdfLimits } from "./policy.ts"
import { waitForPrintReady } from "./readiness.ts"

export async function renderPdf(
  revision: PublicationRevision,
  html: string,
  options: { readonly signal: AbortSignal; readonly executablePath?: string },
) {
  const { signal, executablePath } = options
  signal.throwIfAborted()
  if (Buffer.byteLength(html) > pdfLimits.htmlBytes) throw new PdfExportError("limit")
  const server = await chromium.launchServer({
    ...(executablePath ? { executablePath } : {}),
    headless: true,
    chromiumSandbox: true,
    env: {
      HOME: homedir(),
      TMPDIR: tmpdir(),
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      LANG: "C.UTF-8",
    },
    timeout: pdfLimits.timeoutMs,
    args: [
      "--disable-gpu",
      "--disable-webgl",
      "--disable-background-networking",
      "--host-resolver-rules=MAP * ~NOTFOUND",
      "--renderer-process-limit=1",
      "--js-flags=--max-old-space-size=128",
    ],
  })
  const terminate = () => {
    server.process().kill("SIGKILL")
  }
  signal.addEventListener("abort", terminate, { once: true })
  try {
    signal.throwIfAborted()
    const browser = await chromium.connect(server.wsEndpoint())
    const context = await browser.newContext({
      javaScriptEnabled: false,
      offline: true,
      serviceWorkers: "block",
      acceptDownloads: false,
      viewport: { width: 681, height: 1002 },
      locale: "ja-JP",
      timezoneId: "UTC",
    })
    let networkAttempted = false
    await context.route("**/*", async (route) => {
      networkAttempted = true
      await route.abort("blockedbyclient")
    })
    await context.routeWebSocket("**/*", (socket) => {
      networkAttempted = true
      socket.close()
    })
    const page = await context.newPage()
    await page.emulateMedia({ media: "print", reducedMotion: "reduce", colorScheme: "light" })
    await page.setContent(html, { waitUntil: "load", timeout: pdfLimits.timeoutMs })
    await waitForPrintReady(page, revision)
    if (networkAttempted) throw new PdfExportError("network")
    signal.throwIfAborted()
    const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true })
    if (bytes.byteLength > pdfLimits.pdfBytes) throw new PdfExportError("limit")
    const pdf = await PDFDocument.load(bytes)
    if (pdf.getPageCount() > pdfLimits.pages) throw new PdfExportError("limit")
    return bytes
  } finally {
    try {
      await server.close()
    } finally {
      signal.removeEventListener("abort", terminate)
    }
  }
}
