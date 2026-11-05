import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { getDocument } from "@reading-studio/ingestion/pdf-test-support"
import { expect, it } from "vitest"
import { corpus, render } from "../acceptance/ten29/corpus-support.ts"
import { evidenceDirectory } from "../acceptance/ten29/evidence.ts"

it("records the installed public marked-content/structure APIs without accepting changed text", async () => {
  const family = corpus.find((item) => item.id === "mixed")
  if (!family) throw new TypeError("Missing frozen mixed family")
  const bytes = await render(family, "pdf")
  const directory = await evidenceDirectory("pdf-api")
  const task = getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
    maxImageSize: 0,
    verbosity: 0,
  })
  try {
    const document = await task.promise
    const page = await document.getPage(2)
    const raw = await page.getTextContent({
      disableNormalization: true,
      includeMarkedContent: true,
    })
    const normalized = await page.getTextContent({
      disableNormalization: false,
      includeMarkedContent: true,
    })
    const tree = await page.getStructTree()
    const operators = await page.getOperatorList()
    await writeFile(
      join(directory, "public-api.json"),
      JSON.stringify({ raw, normalized, tree, operators }, null, 2),
      { mode: 0o600, flag: "wx" },
    )
    expect(document.numPages).toBe(4)
    console.info(`PDF_API_EVIDENCE=${directory}`)
  } finally {
    await task.destroy()
  }
})
