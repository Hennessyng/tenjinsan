import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { PDFDocument, PDFName } from "pdf-lib"
import { expect, it } from "vitest"
import { DOCUMENT_LIMITS } from "../src/document-policy.ts"
import { runPdfProcess } from "../src/pdf-subprocess.ts"
import { pdfFixture } from "./document-fixtures.ts"

it("refuses the entire document when a near-zero remaining probe deadline expires", async () => {
  // Given: deterministic child clock, no sleep or change to the outer ten-second limit.
  const directory = await mkdtemp(join(tmpdir(), "pdf-deadline-"))
  try {
    const document = await PDFDocument.load(pdfFixture(["Opening", ""]))
    document
      .getPage(1)
      .node.set(
        PDFName.of("Contents"),
        document.context.register(
          document.context.flateStream(
            "BT /F1 12 Tf 14 TL 72 700 Td (Alpha) Tj ( ) Tj T* (Beta) Tj ET",
          ),
        ),
      )
    const script = join(directory, "deadline.mjs")
    const worker = new URL("../src/pdf/worker.ts", import.meta.url).href
    await writeFile(
      script,
      `import { runPdfWorker } from ${JSON.stringify(worker)}; const real = performance.now.bind(performance); let first = true; Object.defineProperty(performance, "now", { value: () => first ? (first = false, real() - 7999.999) : real() }); await runPdfWorker(JSON.parse(process.argv[2]));`,
    )
    // When
    const output = JSON.parse(
      await runPdfProcess(
        Buffer.from(await document.save({ useObjectStreams: false })),
        pathToFileURL(script),
      ),
    )
    // Then
    expect(output).toEqual({ error: "limit-exceeded" })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
it("retains deterministic count-cap page omissions without rejecting other pages", async () => {
  // Given
  const document = await PDFDocument.load(pdfFixture(["Opening", ""]))
  const rows = Array.from({ length: 257 }, () => "(A) Tj ( ) Tj T*").join("\n")
  document
    .getPage(1)
    .node.set(
      PDFName.of("Contents"),
      document.context.register(
        document.context.flateStream(`BT /F1 1 Tf 2.5 TL 72 760 Td ${rows} ET`),
      ),
    )
  // When
  const output = JSON.parse(
    await runPdfProcess(
      Buffer.from(await document.save({ useObjectStreams: false })),
      new URL("../src/pdf-process.mjs", import.meta.url),
      DOCUMENT_LIMITS.pdf,
    ),
  )
  // Then
  expect(output.pages).toEqual(["Opening", ""])
  expect(output.omissions[0]).toMatchObject({
    page: 2,
    reason: "unsupported-pdf-text",
    details: expect.arrayContaining(["probe-limit"]),
  })
})
