import { createServer } from "node:http"
import { expect, test } from "@playwright/test"
import {
  pdfDocument,
  pdfLimits,
  renderPdf,
  waitForPrintReady,
  withPdfDeadline,
} from "@reading-studio/export/testing/pdf"
import { printRevision } from "@reading-studio/export/testing/print"

let printHtml: string
test.beforeAll(async () => {
  printHtml = await pdfDocument(printRevision)
})

test("pdf: paper stays white beyond the end of the content", async ({ page }) => {
  await page.emulateMedia({ media: "print" })
  await page.setContent(printHtml)
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
  ).toBe("rgb(255, 255, 255)")
})

test("pdf: forged complete manifest cannot hide a deleted explanation", async ({ page }) => {
  // Given
  await page.setContent(printHtml)
  const manifest = await page
    .locator("[data-print-states]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-print-states")))
  await page
    .locator('[data-state="spatial:viewpoint:second"] > .pair > [lang="ja"]')
    .evaluate((node) => node.remove())
  expect(
    await page
      .locator("[data-print-states]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-print-states"))),
  ).toEqual(manifest)
  const damaged = await page.content()
  // When / Then
  await expect(
    withPdfDeadline((signal) => renderPdf(printRevision, damaged, { signal })),
  ).rejects.toMatchObject({ reason: "readiness" })
})

test("pdf: missing bundled font fails instead of using system fallback", async () => {
  // Given
  const damaged = printHtml.replaceAll(/@font-face\s*\{[^}]*\}/g, "")
  // When / Then
  await expect(
    withPdfDeadline((signal) => renderPdf(printRevision, damaged, { signal })),
  ).rejects.toMatchObject({ reason: "font" })
})

test("pdf: corrupt font fails instead of printing blank Japanese", async () => {
  // Given
  const damaged = printHtml.replaceAll(
    /data:font\/woff2;base64,[A-Za-z0-9+/=]+/g,
    "data:font/woff2;base64,d09GMgAAAA==",
  )
  // When / Then
  await expect(
    withPdfDeadline((signal) => renderPdf(printRevision, damaged, { signal })),
  ).rejects.toMatchObject({ reason: "font" })
})

test("pdf: unused declared font must also decode successfully", async () => {
  const damaged = printHtml.replace(
    "</head>",
    `<style>@font-face { font-family: Unused; src: url("data:font/woff2;base64,d09GMgAAAA=="); }</style></head>`,
  )
  await expect(
    withPdfDeadline((signal) => renderPdf(printRevision, damaged, { signal })),
  ).rejects.toMatchObject({ reason: "font" })
})

test("pdf: font readiness deadline fails instead of returning a PDF", async ({ page }) => {
  // Given
  await page.setContent(printHtml)
  await page.evaluate(() =>
    Object.defineProperty(document.fonts, "ready", { value: new Promise(() => {}) }),
  )
  // When / Then
  await expect(
    withPdfDeadline(() => waitForPrintReady(page, printRevision), 50),
  ).rejects.toMatchObject({ reason: "timeout" })
})

test("pdf: print job refuses external resources without reaching the server", async () => {
  // Given
  let requests = 0
  const server = createServer((_, response) => {
    requests++
    response.end("private")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("missing fixture port")
    const damaged = printHtml
      .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "")
      .replace("</main>", `<img src="http://127.0.0.1:${address.port}/canary"></main>`)
    // When / Then
    await expect(
      withPdfDeadline((signal) => renderPdf(printRevision, damaged, { signal })),
    ).rejects.toThrow()
    expect(requests).toBe(0)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

test("pdf: oversized input fails before launching Chromium", async () => {
  // Given
  const oversized = "x".repeat(pdfLimits.htmlBytes + 1)
  // When / Then
  await expect(
    withPdfDeadline((signal) => renderPdf(printRevision, oversized, { signal })),
  ).rejects.toMatchObject({ reason: "limit" })
})

test("pdf: excessive DOM fails before rendering pages", async () => {
  const oversized = printHtml.replace(
    "</main>",
    `${"<span></span>".repeat(pdfLimits.nodes)}</main>`,
  )
  await expect(
    withPdfDeadline((signal) => renderPdf(printRevision, oversized, { signal })),
  ).rejects.toMatchObject({ reason: "limit" })
})

test("pdf: page budget rejects the whole PDF instead of silently truncating", async () => {
  const oversized = printHtml.replace(
    "</main>",
    `${'<p style="break-before:page">Budget</p>'.repeat(pdfLimits.pages)}</main>`,
  )
  await expect(
    withPdfDeadline((signal) => renderPdf(printRevision, oversized, { signal })),
  ).rejects.toMatchObject({ reason: "limit" })
})
